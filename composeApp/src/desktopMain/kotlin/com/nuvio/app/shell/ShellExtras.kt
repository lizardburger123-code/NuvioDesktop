package com.nuvio.app.shell

import co.touchlab.kermit.Logger
import com.nuvio.app.core.storage.DesktopStorage
import com.nuvio.app.features.addons.AddonManifest
import com.nuvio.app.features.addons.AddonManifestParser
import com.nuvio.app.features.addons.AddonRepository
import com.nuvio.app.features.addons.buildAddonResourceUrl
import com.nuvio.app.features.addons.enabledAddons
import com.nuvio.app.features.addons.fetchAddonResponseText
import com.nuvio.app.features.debrid.DebridDeviceAuthorizationTokenResult
import com.nuvio.app.features.debrid.DebridProviderApis
import com.nuvio.app.features.debrid.DebridProviders
import com.nuvio.app.features.debrid.DebridSettingsRepository
import com.nuvio.app.features.home.HomeCatalogParser
import com.nuvio.app.features.home.HomeCatalogSettingsRepository
import com.nuvio.app.features.home.HomeRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.net.URLEncoder
import java.util.Locale
import java.util.concurrent.TimeUnit

private val extrasJson = Json { ignoreUnknownKeys = true }
private val extrasHttp by lazy {
    OkHttpClient.Builder().connectTimeout(12, TimeUnit.SECONDS).readTimeout(25, TimeUnit.SECONDS).build()
}
private fun JsonElement?.obj(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

// ---- TorBox library --------------------------------------------------------------------------

/**
 * Empties the TorBox cloud (what the "TorBox - Library" catalog lists). Uses the TorBox key the
 * app already has, or a sign-in made here with TorBox's device code (kept for this shell only,
 * so Nuvio's own debrid features don't switch on by surprise).
 */
internal object ShellTorbox {
    private val log = Logger.withTag("ShellTorbox")
    private const val Base = "https://api.torbox.app/v1/api"
    private val store by lazy { DesktopStorage.store("nuvio_shell") }

    private fun key(): String? =
        DebridSettingsRepository.snapshot().apiKeyFor(DebridProviders.TORBOX_ID).trim().takeIf { it.isNotEmpty() }
            ?: store.getString("torbox_token")?.trim()?.takeIf { it.isNotEmpty() }

    fun connected(): Boolean = key() != null

    suspend fun connectStart(): JsonElement {
        val auth = DebridProviderApis.apiFor(DebridProviders.TORBOX_ID)?.startDeviceAuthorization("Nuvio")
            ?: error("TorBox didn't start a sign-in. Try again in a moment.")
        return buildJsonObject {
            put("deviceCode", auth.deviceCode)
            put("code", auth.userCode)
            put("url", auth.friendlyVerificationUrl.ifBlank { auth.verificationUrl })
            put("interval", auth.intervalSeconds)
        }
    }

    suspend fun connectPoll(deviceCode: String): JsonElement {
        val result = DebridProviderApis.apiFor(DebridProviders.TORBOX_ID)?.redeemDeviceAuthorization(deviceCode)
            ?: DebridDeviceAuthorizationTokenResult.Unsupported
        val status = when (result) {
            is DebridDeviceAuthorizationTokenResult.Authorized -> {
                store.putString("torbox_token", result.accessToken)
                "connected"
            }
            DebridDeviceAuthorizationTokenResult.Pending -> "pending"
            DebridDeviceAuthorizationTokenResult.Expired -> "expired"
            else -> "failed"
        }
        return buildJsonObject { put("status", status) }
    }

    private data class Entry(val kind: String, val id: Long, val name: String, val size: Long)

    private fun list(apiKey: String): List<Entry> = listOf("torrents", "usenet", "webdl").flatMap { kind ->
        runCatching {
            val request = Request.Builder().url("$Base/$kind/mylist?bypass_cache=true&limit=1000")
                .header("Authorization", "Bearer $apiKey").get().build()
            extrasHttp.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (response.code == 401 || response.code == 403) error("TorBox rejected the sign-in. Connect TorBox again.")
                val data = extrasJson.parseToJsonElement(body).obj()["data"] as? JsonArray ?: return@use emptyList()
                data.mapNotNull { element ->
                    val item = element.obj()
                    val id = item.str("id")?.toLongOrNull() ?: return@mapNotNull null
                    Entry(kind, id, item.str("name").orEmpty(), item.str("size")?.toDoubleOrNull()?.toLong() ?: 0)
                }
            }
        }.getOrElse { error -> if (error is IllegalStateException) throw error else emptyList() }
    }

    suspend fun summary(): JsonElement = withContext(Dispatchers.IO) {
        val apiKey = key() ?: return@withContext buildJsonObject { put("connected", false) }
        val entries = list(apiKey)
        buildJsonObject {
            put("connected", true)
            put("count", entries.size)
            put("size", entries.sumOf { it.size })
        }
    }

    /** Deletes everything in the TorBox cloud. Returns how many items went. */
    suspend fun clear(): JsonElement = withContext(Dispatchers.IO) {
        val apiKey = key() ?: error("Connect TorBox first.")
        val entries = list(apiKey)
        var removed = 0
        var failed = 0
        entries.forEach { entry ->
            val (path, idField) = when (entry.kind) {
                "torrents" -> "torrents/controltorrent" to "torrent_id"
                "usenet" -> "usenet/controlusenetdownload" to "usenet_id"
                else -> "webdl/controlwebdownload" to "webdl_id"
            }
            val ok = runCatching {
                val body = """{"$idField":${entry.id},"operation":"delete"}""".toRequestBody("application/json".toMediaType())
                val request = Request.Builder().url("$Base/$path").header("Authorization", "Bearer $apiKey").post(body).build()
                extrasHttp.newCall(request).execute().use { it.isSuccessful }
            }.getOrDefault(false)
            if (ok) removed++ else failed++
            delay(120) // stay well inside TorBox's rate limit
        }
        log.i { "cleared TorBox: $removed removed, $failed failed" }
        // The library catalog (AIOStreams) reads TorBox: refresh so the rows empty out.
        runCatching { HomeRepository.refresh(AddonRepository.uiState.value.addons.enabledAddons(), force = true) }
        buildJsonObject {
            put("removed", removed)
            put("failed", failed)
        }
    }
}

// ---- Home rows ---------------------------------------------------------------------------------

internal object ShellHomeRows {
    private val store by lazy { DesktopStorage.store("nuvio_shell") }
    private val torboxLibrary = Regex("torbox.*library|library.*torbox", RegexOption.IGNORE_CASE)

    fun list(): JsonElement {
        HomeCatalogSettingsRepository.snapshot()
        val items = HomeCatalogSettingsRepository.uiState.value.items
        return buildJsonArray {
            items.filterNot { it.isCollection }.forEach { item ->
                add(buildJsonObject {
                    put("key", item.key)
                    put("title", item.displayTitle)
                    put("addon", item.addonName)
                    put("enabled", item.enabled)
                })
            }
        }
    }

    fun setEnabled(key: String, enabled: Boolean) {
        HomeCatalogSettingsRepository.setEnabled(key, enabled)
    }

    /** Once: the TorBox library catalog stays off Home (it's still in Library › TorBox). */
    fun applyDefaults() {
        if (store.getBoolean("hid_torbox_library_v1") == true) return
        HomeCatalogSettingsRepository.snapshot()
        val items = HomeCatalogSettingsRepository.uiState.value.items
        if (items.isEmpty()) return
        items.filter { torboxLibrary.containsMatchIn(it.defaultTitle) || torboxLibrary.containsMatchIn(it.displayTitle) }
            .forEach { HomeCatalogSettingsRepository.setEnabled(it.key, false) }
        store.putBoolean("hid_torbox_library_v1", true)
    }
}

// ---- Discover ----------------------------------------------------------------------------------

/**
 * Browse any addon catalog with its own filters (genre, year, rating... whatever the catalog
 * offers), page after page. Works the same for movies, series and anime.
 */
internal object ShellDiscover {
    private val animeHints = listOf("kitsu", "anime", "myanimelist", "anilist", "mal_", "mal.")

    private fun kindOf(manifest: AddonManifest, type: String, catalogId: String, catalogName: String): String {
        val haystack = listOf(manifest.id, manifest.name, type, catalogId, catalogName).joinToString(" ").lowercase(Locale.ROOT)
        return when {
            animeHints.any { it in haystack } -> "anime"
            type == "movie" -> "movie"
            type == "series" -> "series"
            else -> type
        }
    }

    private fun sourceId(manifestUrl: String, type: String, catalogId: String) = "$manifestUrl|$type|$catalogId"

    fun sources(kind: String): JsonElement = buildJsonArray {
        AddonRepository.uiState.value.addons.enabledAddons().forEach { addon ->
            val manifest = addon.manifest ?: return@forEach
            manifest.catalogs.forEach catalogs@{ catalog ->
                if (kindOf(manifest, catalog.type, catalog.id, catalog.name) != kind) return@catalogs
                // Search-only catalogs need a query; required filters need options to choose from.
                if (catalog.extra.any { it.isRequired && (it.name == "search" || it.options.isEmpty()) }) return@catalogs
                add(buildJsonObject {
                    put("id", sourceId(addon.manifestUrl, catalog.type, catalog.id))
                    put("name", catalog.name.ifBlank { catalog.id })
                    put("addon", addon.displayTitle)
                    put("type", catalog.type)
                    put("paged", catalog.extra.any { it.name == "skip" })
                    put("filters", buildJsonArray {
                        catalog.extra.filter { it.name != "skip" && it.name != "search" && it.options.isNotEmpty() }.forEach { extra ->
                            add(buildJsonObject {
                                put("name", extra.name)
                                put("required", extra.isRequired)
                                put("options", ShellJson.strings(extra.options))
                            })
                        }
                    })
                })
            }
        }
    }

    private fun encode(value: String) = URLEncoder.encode(value, Charsets.UTF_8).replace("+", "%20")

    /** What the debrid "Library" catalogs list (e.g. TorBox - Library), even when hidden from Home. */
    suspend fun libraryItems(): JsonElement = coroutineScope {
        val sources = AddonRepository.uiState.value.addons.enabledAddons().flatMap { addon ->
            val manifest = addon.manifest ?: return@flatMap emptyList()
            manifest.catalogs
                .filter { catalog -> "library" in "${catalog.name} ${catalog.id}".lowercase(Locale.ROOT) && catalog.extra.none { it.isRequired } }
                .map { catalog -> sourceId(addon.manifestUrl, catalog.type, catalog.id) }
        }
        val items = sources.map { source ->
            async { withTimeoutOrNull(15_000) { runCatching { page(source, emptyMap(), 0) }.getOrNull() } }
        }.awaitAll().filterNotNull().flatMap { (it.obj()["items"] as? JsonArray).orEmpty() }
        buildJsonObject {
            put("sources", sources.size)
            put("items", buildJsonArray {
                val seen = mutableSetOf<String>()
                items.forEach { item ->
                    val key = "${item.obj().str("type")}:${item.obj().str("id")}"
                    if (seen.add(key)) add(item)
                }
            })
        }
    }

    suspend fun page(source: String, filters: Map<String, String>, skip: Int): JsonElement {
        val parts = source.split("|")
        require(parts.size >= 3) { "Unknown catalog." }
        val catalogId = parts.last()
        val type = parts[parts.size - 2]
        val manifestUrl = parts.dropLast(2).joinToString("|")
        val extras = buildList {
            filters.filterValues { it.isNotBlank() }.toSortedMap().forEach { (name, value) -> add("${encode(name)}=${encode(value)}") }
            if (skip > 0) add("skip=$skip")
        }
        val url = buildAddonResourceUrl(manifestUrl, "catalog", type, catalogId, extras.joinToString("&").ifBlank { null })
        val payload = withContext(Dispatchers.IO) { fetchAddonResponseText(url) }
        val parsed = HomeCatalogParser.parseCatalogResponse(payload)
        return buildJsonObject {
            put("items", buildJsonArray { parsed.items.forEach { add(ShellJson.preview(it)) } })
            put("next", if (parsed.rawItemCount > 0) skip + parsed.rawItemCount else -1)
        }
    }
}

// ---- Addon store -------------------------------------------------------------------------------

/**
 * Suggested addons, checked live: each install link is fetched when the store opens, so a dead
 * addon shows as unavailable instead of failing on install. Addons that need settings first open
 * their configure page; the link it gives is pasted into Install.
 */
internal object ShellAddonStore {
    private data class Pick(
        val category: String,
        val name: String,
        val blurb: String,
        val manifest: String? = null,
        val configure: String? = null,
        val adult: Boolean = false,
    )

    private val picks = listOf(
        Pick("Catalogs", "Cinemeta", "The official catalog and metadata: popular, top rated and new movies and series.", manifest = "https://v3-cinemeta.strem.io/manifest.json"),
        Pick("Catalogs", "The Movie Database", "TMDB catalogs, trending lists and rich metadata in your language.", manifest = "https://94c8cb9f702d-tmdb-addon.baby-beamup.club/manifest.json", configure = "https://94c8cb9f702d-tmdb-addon.baby-beamup.club/configure"),
        Pick("Catalogs", "Streaming Catalogs", "What's on Netflix, Disney+, Max, Prime Video, Apple TV+ and more.", manifest = "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/manifest.json", configure = "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/configure"),
        Pick("Catalogs", "AIOMetadata", "One addon for TMDB, TVDB, MAL and Trakt catalogs with full control over metadata.", configure = "https://aiometadata.elfhosted.com/configure/"),
        Pick("Catalogs", "Trakt", "Your Trakt watchlist, lists and recommendations as catalogs.", configure = "https://2ecbbd610840-trakt.baby-beamup.club/configure/"),
        Pick("Catalogs", "More Like This", "Similar titles on every details page.", configure = "https://bbab4a35b833-more-like-this.baby-beamup.club/configure"),
        Pick("Anime", "Anime Kitsu", "Anime catalogs and metadata from Kitsu: trending, airing, top rated.", manifest = "https://anime-kitsu.strem.fun/manifest.json"),
        Pick("Anime", "Animeo", "Anime catalogs from MyAnimeList and AniList.", configure = "https://7a625ac658ec-animeo.baby-beamup.club/configure"),
        Pick("Streams", "Torrentio", "The classic torrent source with debrid support.", manifest = "https://torrentio.strem.fun/manifest.json", configure = "https://torrentio.strem.fun/configure"),
        Pick("Streams", "Comet", "Fast debrid streams from many trackers.", configure = "https://comet.elfhosted.com/configure"),
        Pick("Streams", "MediaFusion", "Streams for movies, series, sports and live TV.", configure = "https://mediafusion.elfhosted.com/configure"),
        Pick("Streams", "ThePirateBay+", "Torrent streams from The Pirate Bay.", manifest = "https://thepiratebay-plus.strem.fun/manifest.json"),
        Pick("Live TV", "USA TV", "Free live US TV channels.", manifest = "https://848b3516657c-usatv.baby-beamup.club/manifest.json"),
        Pick("Live TV", "Pluto TV", "Free live channels and on-demand from Pluto TV.", manifest = "https://dev.nebulawp.org/stremio/pluto-tv-addon/manifest.json"),
        Pick("Live TV", "Music Concerts", "Full concerts and live performances.", manifest = "https://7a82163c306e-stremio-concerts.baby-beamup.club/manifest.json"),
        Pick("Subtitles", "OpenSubtitles v3", "The official OpenSubtitles addon.", manifest = "https://opensubtitles-v3.strem.io/manifest.json"),
        Pick("Subtitles", "OpenSubtitles PRO", "OpenSubtitles with language choices and AI translation.", configure = "https://opensubtitlesv3-pro.dexter21767.com/configure/"),
        Pick("Adult", "OnlyPorn", "Adult videos from several sites, as catalogs and streams.", manifest = "https://07b88951aaab-jaxxx-v2.baby-beamup.club/manifest.json", adult = true),
        Pick("Adult", "4K Porn TPB", "4K and 1080p adult torrents, with debrid support.", configure = "https://tpb-adult-addon.click/configure", adult = true),
        Pick("Adult", "Hanime.TV", "Uncensored adult anime.", manifest = "https://94c8cb9f702d-hanime-tv-addon.baby-beamup.club/manifest.json", adult = true),
    )

    private val store by lazy { DesktopStorage.store("nuvio_shell") }
    private val adultIds = mutableSetOf<String>()

    fun showAdult(): Boolean = store.getBoolean("store_show_adult") ?: true

    private fun hostOf(url: String) = url.substringAfter("://").substringBefore("/").lowercase(Locale.ROOT)

    private fun isAdult(manifestUrl: String, manifest: AddonManifest?): Boolean =
        manifest?.behaviorHints?.adult == true || manifest?.id in adultIds ||
            picks.any { it.adult && (it.manifest ?: it.configure)?.let(::hostOf) == hostOf(manifestUrl) }

    suspend fun list(): JsonElement = coroutineScope {
        val installed = AddonRepository.uiState.value.addons
        val checked = picks.map { pick ->
            async {
                val manifest = pick.manifest?.let { url ->
                    withTimeoutOrNull(9_000) {
                        runCatching { AddonManifestParser.parse(manifestUrl = url, payload = withContext(Dispatchers.IO) { fetchAddonResponseText(url) }) }.getOrNull()
                    }
                }
                pick to manifest
            }
        }.awaitAll()
        checked.forEach { (pick, manifest) -> if (pick.adult && manifest != null) adultIds += manifest.id }
        buildJsonObject {
            put("showAdult", showAdult())
            put("items", buildJsonArray {
                checked.forEach { (pick, manifest) ->
                    val host = hostOf(pick.manifest ?: pick.configure.orEmpty())
                    val match = installed.firstOrNull { addon ->
                        (manifest != null && addon.manifest?.id == manifest.id) || hostOf(addon.manifestUrl) == host
                    }
                    add(buildJsonObject {
                        put("key", pick.name)
                        put("category", pick.category)
                        put("name", manifest?.name?.takeIf { it.isNotBlank() } ?: pick.name)
                        put("blurb", pick.blurb)
                        manifest?.logoUrl?.let { put("logo", it) }
                        manifest?.version?.let { put("version", it) }
                        put("adult", pick.adult || manifest?.behaviorHints?.adult == true)
                        pick.manifest?.let { put("manifest", it) }
                        pick.configure?.let { put("configure", it) }
                        put("available", manifest != null)
                        put("needsSetup", pick.manifest == null)
                        match?.let { put("installed", it.manifestUrl); put("enabled", it.enabled) }
                    })
                }
            })
        }
    }

    /** Adult content on or off in one go: every adult addon is enabled or disabled with it. */
    fun setShowAdult(show: Boolean): JsonElement {
        store.putBoolean("store_show_adult", show)
        var changed = 0
        AddonRepository.uiState.value.addons.forEach { addon ->
            if (isAdult(addon.manifestUrl, addon.manifest) && addon.enabled != show) {
                AddonRepository.setAddonEnabled(addon.manifestUrl, show)
                changed++
            }
        }
        return buildJsonObject {
            put("showAdult", show)
            put("changed", changed)
        }
    }

    fun adultFlag(manifestUrl: String, manifest: AddonManifest?): Boolean = isAdult(manifestUrl, manifest)
}

// ---- Housekeeping ------------------------------------------------------------------------------

internal object ShellHousekeeping {
    /** mpv's seek cache is a temporary file; anything left by a crash goes on the next start. */
    fun cleanStreamCache() {
        val base = System.getenv("LOCALAPPDATA") ?: return
        val dir = File(base, "Nuvio\\Cache\\stream")
        if (!dir.isDirectory) return
        val cutoff = System.currentTimeMillis() - 10 * 60_000L
        dir.listFiles()?.forEach { file -> if (file.isFile && file.lastModified() < cutoff) runCatching { file.delete() } }
    }
}

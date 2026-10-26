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
        cacheJobs.clear()
        // The library catalog (AIOStreams) reads TorBox: refresh so the rows empty out.
        runCatching { HomeRepository.refresh(AddonRepository.uiState.value.addons.enabledAddons(), force = true) }
        buildJsonObject {
            put("removed", removed)
            put("failed", failed)
        }
    }

    // ---- Cache on TorBox: send a torrent that isn't cached yet, watch it download, play it ----

    private val hashPattern = Regex("(?<![0-9a-fA-F])[0-9a-fA-F]{40}(?![0-9a-fA-F])")
    private val cacheJobs = java.util.concurrent.ConcurrentHashMap<String, Long>() // hash -> torrent id

    /** The torrent behind a source, when it has one (P2P sources, or a debrid link with the hash in it). */
    fun hashOf(stream: com.nuvio.app.features.streams.StreamItem): String? =
        (stream.infoHash ?: stream.clientResolve?.infoHash)?.trim()?.lowercase()?.takeIf { it.length == 40 }
            ?: stream.url?.let { hashPattern.find(it)?.value?.lowercase() }

    private fun authed(url: String, apiKey: String) = Request.Builder().url(url).header("Authorization", "Bearer $apiKey")

    private fun call(request: Request): JsonObject = extrasHttp.newCall(request).execute().use { response ->
        val text = response.body?.string().orEmpty()
        if (response.code == 401 || response.code == 403) error("TorBox rejected the sign-in. Connect TorBox again.")
        runCatching { extrasJson.parseToJsonElement(text).obj() }.getOrElse { JsonObject(emptyMap()) }.also { root ->
            if (!response.isSuccessful && root.str("success") != "true") {
                error(root.str("detail")?.takeIf { it.isNotBlank() } ?: "TorBox answered ${response.code}.")
            }
        }
    }

    suspend fun cache(hash: String, name: String?): JsonElement = withContext(Dispatchers.IO) {
        val apiKey = key() ?: error("Connect TorBox first.")
        val clean = hash.trim().lowercase()
        require(clean.length == 40) { "That source has no torrent to send." }
        val magnet = "magnet:?xt=urn:btih:$clean" + (name?.takeIf { it.isNotBlank() }?.let { "&dn=" + URLEncoder.encode(it, Charsets.UTF_8) } ?: "")
        val form = okhttp3.MultipartBody.Builder().setType(okhttp3.MultipartBody.FORM)
            .addFormDataPart("magnet", magnet)
            .addFormDataPart("allow_zip", "false")
            .build()
        val root = call(authed("$Base/torrents/createtorrent", apiKey).post(form).build())
        if (root.str("success") == "false") error(root.str("detail") ?: "TorBox didn't take it.")
        val data = root["data"].obj()
        data.str("torrent_id")?.toLongOrNull()?.let { cacheJobs[clean] = it }
        status(listOf(clean))
    }

    /** Progress for the given hashes: { hash: { state, progress, speed, eta, ready } }. */
    suspend fun status(hashes: List<String>): JsonElement = withContext(Dispatchers.IO) {
        val apiKey = key() ?: return@withContext buildJsonObject { put("connected", false) }
        val wanted = hashes.map { it.lowercase() }.toSet()
        val data = call(authed("$Base/torrents/mylist?bypass_cache=true&limit=1000", apiKey).get().build())["data"] as? JsonArray
        val found = data.orEmpty().map { it.obj() }.filter { it.str("hash")?.lowercase() in wanted }
        buildJsonObject {
            put("connected", true)
            put("items", buildJsonObject {
                found.forEach { item ->
                    val hash = item.str("hash")!!.lowercase()
                    item.str("id")?.toLongOrNull()?.let { cacheJobs[hash] = it }
                    val finished = item.str("download_finished") == "true" || item.str("download_present") == "true"
                    put(hash, buildJsonObject {
                        put("state", item.str("download_state") ?: if (finished) "cached" else "queued")
                        put("progress", item.str("progress")?.toDoubleOrNull() ?: if (finished) 1.0 else 0.0)
                        put("speed", item.str("download_speed")?.toDoubleOrNull()?.toLong() ?: 0L)
                        put("eta", item.str("eta")?.toDoubleOrNull()?.toLong() ?: 0L)
                        put("seeds", item.str("seeds")?.toIntOrNull() ?: 0)
                        put("ready", finished)
                    })
                }
            })
        }
    }

    private val videoExt = Regex("\\.(mkv|mp4|m4v|avi|webm|mov|wmv|ts|m2ts|mpg|mpeg|flv)$", RegexOption.IGNORE_CASE)

    /** A direct TorBox link for the right file of a finished torrent. */
    suspend fun link(hash: String, fileName: String?, season: Int?, episode: Int?): String = withContext(Dispatchers.IO) {
        val apiKey = key() ?: error("Connect TorBox first.")
        val clean = hash.lowercase()
        val list = call(authed("$Base/torrents/mylist?bypass_cache=true&limit=1000", apiKey).get().build())["data"] as? JsonArray
        val torrent = list.orEmpty().map { it.obj() }.firstOrNull { it.str("hash")?.lowercase() == clean }
            ?: error("TorBox doesn't have it yet. Cache it first.")
        if (torrent.str("download_finished") != "true" && torrent.str("download_present") != "true") error("Still downloading on TorBox.")
        val id = torrent.str("id") ?: error("TorBox didn't say which torrent it is.")
        val files = (torrent["files"] as? JsonArray).orEmpty().map { it.obj() }
        val videos = files.filter { (it.str("mimetype")?.startsWith("video") == true) || videoExt.containsMatchIn(it.str("name").orEmpty()) }
            .ifEmpty { files }
        val episodeMatch = if (season != null && episode != null) {
            val pattern = Regex("(?i)(s0*$season[ ._-]*e0*$episode(?!\\d))|(\\b0*$season" + "x0*$episode(?!\\d))")
            videos.firstOrNull { pattern.containsMatchIn(it.str("name").orEmpty()) }
        } else null
        val byName = fileName?.takeIf { it.isNotBlank() }?.let { name ->
            videos.firstOrNull { it.str("name").orEmpty().substringAfterLast('/').equals(name, ignoreCase = true) }
        }
        val file = episodeMatch ?: byName ?: videos.maxByOrNull { it.str("size")?.toDoubleOrNull() ?: 0.0 }
            ?: error("No video file in that torrent.")
        val fileId = file.str("id") ?: error("TorBox didn't list the file.")
        val url = "$Base/torrents/requestdl?token=${URLEncoder.encode(apiKey, Charsets.UTF_8)}&torrent_id=$id&file_id=$fileId&redirect=false"
        call(Request.Builder().url(url).get().build()).str("data")?.takeIf { it.startsWith("http") }
            ?: error("TorBox didn't give a link.")
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
        // Wait until the row exists (its addon may still be loading); once hidden, a manual
        // "show" in Settings sticks.
        val matches = items.filter { torboxLibrary.containsMatchIn(it.defaultTitle) || torboxLibrary.containsMatchIn(it.displayTitle) }
        if (matches.isEmpty()) return
        matches.forEach { HomeCatalogSettingsRepository.setEnabled(it.key, false) }
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
 * The addon store. "Featured" is a hand-picked shelf, checked live; "Browse" is the whole
 * community catalogue of stremio-addons.net (hundreds of addons, by category, searchable), read
 * live from the site. Install links come from the addon's own page there, so they stay current.
 */
internal object ShellAddonStore {
    private val log = Logger.withTag("ShellAddonStore")
    private const val Site = "https://stremio-addons.net"

    private data class Pick(
        val category: String,
        val name: String,
        val blurb: String,
        val manifest: String? = null,
        val configure: String? = null,
        val slug: String? = null,
        val adult: Boolean = false,
    )

    private val picks = listOf(
        Pick("Catalogs", "Cinemeta", "The official catalog and metadata: popular, top rated and new movies and series.", manifest = "https://v3-cinemeta.strem.io/manifest.json"),
        Pick("Catalogs", "The Movie Database", "TMDB catalogs, trending lists and rich metadata in your language.", manifest = "https://94c8cb9f702d-tmdb-addon.baby-beamup.club/manifest.json", configure = "https://94c8cb9f702d-tmdb-addon.baby-beamup.club/configure"),
        Pick("Catalogs", "Streaming Catalogs", "What's on Netflix, Disney+, Max, Prime Video, Apple TV+ and more.", manifest = "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/manifest.json", configure = "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/configure"),
        Pick("Catalogs", "AIOMetadata", "One addon for TMDB, TVDB, MAL and Trakt catalogs with full control over metadata.", configure = "https://aiometadata.elfhosted.com/configure/"),
        Pick("Catalogs", "Trakt", "Your Trakt watchlist, lists and recommendations as catalogs.", configure = "https://2ecbbd610840-trakt.baby-beamup.club/configure/"),
        Pick("Anime", "Anime Kitsu", "Anime catalogs and metadata from Kitsu: trending, airing, top rated.", manifest = "https://anime-kitsu.strem.fun/manifest.json"),
        Pick("Streams", "Torrentio", "The classic torrent source with debrid support.", manifest = "https://torrentio.strem.fun/manifest.json", configure = "https://torrentio.strem.fun/configure"),
        Pick("Streams", "Comet", "Fast debrid streams from many trackers.", configure = "https://comet.elfhosted.com/configure"),
        Pick("Live TV", "USA TV", "Free live US TV channels.", manifest = "https://848b3516657c-usatv.baby-beamup.club/manifest.json"),
        Pick("Subtitles", "OpenSubtitles v3", "The official OpenSubtitles addon.", manifest = "https://opensubtitles-v3.strem.io/manifest.json"),
        // Adult: metadata first (like TMDB, for adult titles), then sources.
        Pick("Adult", "Porn Tube", "ThePornDB metadata and catalogs (the TMDB of adult titles), 4K and VR torrents with TorBox, Real-Debrid and Easynews.", slug = "porn-tube", adult = true),
        Pick("Adult", "Adult Stremio Addon", "Adult catalogs with enhanced metadata and posters, lots of options.", slug = "adult-stremio-addon", adult = true),
        Pick("Adult", "Adult Video HD", "One always-on adult library: rows, search and streams up to 1080p.", slug = "adult-video-hd", adult = true),
        Pick("Adult", "TPB 4K Porn", "4K and 1080p adult torrents from many sites, with debrid support.", slug = "4k-adult", adult = true),
        Pick("Adult", "Midnight", "Catalogs and streams for adult films and hentai.", slug = "midnight", adult = true),
        Pick("Adult", "OnlyPorn", "Adult videos from several sites, as catalogs and streams.", manifest = "https://07b88951aaab-jaxxx-v2.baby-beamup.club/manifest.json", adult = true),
        Pick("Adult", "Hanime", "Hentai and adult anime collection.", slug = "hanime", adult = true),
    )

    private val store by lazy { DesktopStorage.store("nuvio_shell") }
    private val adultIds = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    private val manifestCache = java.util.concurrent.ConcurrentHashMap<String, Pair<Long, AddonManifest?>>()
    private val slugCache = java.util.concurrent.ConcurrentHashMap<String, Pair<Long, String?>>()
    private val pageCache = java.util.concurrent.ConcurrentHashMap<String, Pair<Long, JsonObject>>()
    private const val Fresh = 30 * 60_000L
    private val adultWords = Regex("""(?i)\b(porn\w*|xxx|adult|hentai|nsfw|18\+|jav|erotic\w*|sex\w*|onlyfans|camgirl|milf|hanime)\b""")

    fun showAdult(): Boolean = store.getBoolean("store_show_adult") ?: true

    private fun hostOf(url: String) = url.substringAfter("://").substringBefore("/").lowercase(Locale.ROOT)

    /** Adult if it says so, or its name, types or catalogs clearly are. */
    private fun isAdult(manifestUrl: String, manifest: AddonManifest?): Boolean {
        if (manifest?.behaviorHints?.adult == true || (manifest != null && manifest.id in adultIds)) return true
        if (picks.any { it.adult && (it.manifest ?: it.configure)?.let(::hostOf) == hostOf(manifestUrl) }) return true
        if (manifest == null) return adultWords.containsMatchIn(manifestUrl)
        val text = buildString {
            // Not the description: plenty of normal addons mention an "adult content" option.
            append(manifest.id).append(' ').append(manifest.name)
            manifest.types.forEach { append(' ').append(it) }
            manifest.catalogs.forEach { append(' ').append(it.name).append(' ').append(it.type) }
        }
        return adultWords.containsMatchIn(text)
    }

    private suspend fun manifestOf(url: String, force: Boolean): AddonManifest? {
        val now = System.currentTimeMillis()
        if (!force) manifestCache[url]?.let { (at, manifest) -> if (now - at < Fresh) return manifest }
        val manifest = withTimeoutOrNull(9_000) {
            runCatching { AddonManifestParser.parse(manifestUrl = url, payload = withContext(Dispatchers.IO) { fetchAddonResponseText(url) }) }.getOrNull()
        }
        manifestCache[url] = now to manifest
        return manifest
    }

    private fun site(path: String): String {
        val request = Request.Builder().url("$Site$path").header("User-Agent", ShellNet.BrowserAgent).header("Accept", "text/html").get().build()
        return extrasHttp.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("The addon site answered ${response.code}.")
            response.body?.string().orEmpty()
        }
    }

    /** The install link on an addon's page at stremio-addons.net. */
    private suspend fun manifestUrlFor(slug: String): String? {
        val now = System.currentTimeMillis()
        slugCache[slug]?.let { (at, url) -> if (now - at < Fresh && url != null) return url }
        val url = withContext(Dispatchers.IO) {
            runCatching {
                val page = site("/addons/" + URLEncoder.encode(slug, Charsets.UTF_8)).replace("\\\"", "\"")
                Regex("\"manifestUrl\":\"(https?://[^\"\\\\]+)\"").find(page)?.groupValues?.get(1)
            }.getOrNull()
        }
        slugCache[slug] = now to url
        return url
    }

    suspend fun list(force: Boolean = false): JsonElement = coroutineScope {
        val installed = AddonRepository.uiState.value.addons
        val checked = picks.map { pick ->
            async {
                val url = pick.manifest ?: pick.slug?.let { manifestUrlFor(it) }
                pick to (url to url?.let { manifestOf(it, force) })
            }
        }.awaitAll()
        checked.forEach { (pick, found) -> if (pick.adult) found.second?.let { adultIds += it.id } }
        buildJsonObject {
            put("showAdult", showAdult())
            put("items", buildJsonArray {
                checked.forEach { (pick, found) ->
                    val (url, manifest) = found
                    val host = hostOf(url ?: pick.configure.orEmpty())
                    val match = installed.firstOrNull { addon ->
                        (manifest != null && addon.manifest?.id == manifest.id) || (host.isNotEmpty() && hostOf(addon.manifestUrl) == host)
                    }
                    val needsSetup = manifest?.behaviorHints?.configurationRequired == true || url == null
                    add(buildJsonObject {
                        put("key", pick.name)
                        put("category", pick.category)
                        put("name", manifest?.name?.takeIf { it.isNotBlank() } ?: pick.name)
                        put("blurb", pick.blurb)
                        manifest?.logoUrl?.let { put("logo", it) }
                        manifest?.version?.let { put("version", it) }
                        put("adult", pick.adult || manifest?.behaviorHints?.adult == true)
                        if (!needsSetup) url?.let { put("manifest", it) }
                        (pick.configure ?: url?.takeIf { manifest?.behaviorHints?.configurable == true || needsSetup }?.let(::configureUrl))
                            ?.let { put("configure", it) }
                        put("available", manifest != null)
                        put("needsSetup", needsSetup && (pick.configure != null || url != null))
                        match?.let { put("installed", it.manifestUrl); put("enabled", it.enabled) }
                    })
                }
            })
        }
    }

    private fun configureUrl(manifestUrl: String) = manifestUrl.replace(Regex("manifest\\.json(\\?.*)?$"), "configure")

    /**
     * One page of the community catalogue: category is the site's own (movies, anime, nsfw…),
     * query searches names and descriptions there.
     */
    suspend fun community(category: String?, query: String?, page: Int): JsonElement = withContext(Dispatchers.IO) {
        val params = buildList {
            add("sort=popular")
            category?.takeIf { it.isNotBlank() && it != "all" }?.let { add("categories=" + URLEncoder.encode(it, Charsets.UTF_8).replace("+", "%20")) }
            query?.trim()?.takeIf { it.isNotEmpty() }?.let { add("query=" + URLEncoder.encode(it, Charsets.UTF_8).replace("+", "%20")) }
            if (page > 1) add("page=$page")
        }.joinToString("&")
        val now = System.currentTimeMillis()
        val parsed = pageCache[params]?.takeIf { now - it.first < Fresh }?.second ?: parseList(site("/addons?$params")).also { pageCache[params] = now to it }
        val installed = AddonRepository.uiState.value.addons
        val installedIds = installed.mapNotNull { addon -> addon.manifest?.id?.let { it to addon } }.toMap()
        val showAdult = showAdult()
        buildJsonObject {
            put("page", page)
            put("pageCount", parsed["pageCount"] ?: JsonPrimitive(1))
            put("items", buildJsonArray {
                (parsed["items"] as? JsonArray).orEmpty().forEach { element ->
                    val item = element.obj()
                    val adult = item.str("adult") == "true"
                    if (adult && !showAdult) return@forEach
                    val match = item.str("id")?.let { installedIds[it] }
                    add(buildJsonObject {
                        item.forEach { (k, v) -> put(k, v) }
                        match?.let { put("installed", it.manifestUrl); put("enabled", it.enabled) }
                    })
                }
            })
        }
    }

    /** Reads the cards out of the site's page data (each card carries the addon's manifest). */
    private fun parseList(html: String): JsonObject {
        val s = html.replace("\\\\", "\u0000").replace("\\\"", "\"").replace("\u0000", "\\")
        val items = mutableListOf<JsonObject>()
        val seen = mutableSetOf<String>()
        val card = Regex("\"href\":\"/addons/([^\"?]+)\",\"className\":\"block\"")
        card.findAll(s).forEach { m ->
            val slug = m.groupValues[1]
            if (!seen.add(slug)) return@forEach
            val at = s.indexOf("\"manifest\":{", m.range.last)
            if (at < 0) return@forEach
            val objectStart = at + "\"manifest\":".length
            val objectEnd = matchBrace(s, objectStart)
            if (objectEnd < 0) return@forEach
            val manifest = runCatching { extrasJson.parseToJsonElement(s.substring(objectStart, objectEnd + 1)).obj() }.getOrNull() ?: return@forEach
            val hints = manifest["behaviorHints"].obj()
            val types = (manifest["types"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
            val resources = (manifest["resources"] as? JsonArray).orEmpty().mapNotNull { r -> (r as? JsonPrimitive)?.contentOrNull ?: r.obj().str("name") }
            val catalogs = (manifest["catalogs"] as? JsonArray).orEmpty().map { it.obj() }
            val text = listOfNotNull(manifest.str("id"), manifest.str("name"), manifest.str("description")).joinToString(" ") +
                catalogs.joinToString(" ") { "${it.str("name")} ${it.str("type")}" }
            val certain = hints.str("adult") == "true" || adultWords.containsMatchIn("${manifest.str("id")} ${manifest.str("name")} ${types.joinToString(" ")}")
            val adult = certain || adultWords.containsMatchIn(text)
            val id = manifest.str("id")
            if (certain && id != null) adultIds += id
            items += buildJsonObject {
                put("slug", slug)
                id?.let { put("id", it) }
                put("name", manifest.str("name") ?: slug)
                put("blurb", manifest.str("description").orEmpty().replace(Regex("<[^>]+>"), " ").trim().take(220))
                manifest.str("logo")?.takeIf { it.startsWith("http") }?.let { put("logo", it) }
                manifest.str("version")?.let { put("version", it) }
                put("types", ShellJson.strings(types))
                put("resources", ShellJson.strings(resources))
                put("catalogs", catalogs.size)
                put("adult", adult)
                put("needsSetup", hints.str("configurationRequired") == "true")
                put("configurable", hints.str("configurable") == "true")
            }
        }
        val pageCount = Regex("\"pageCount\":(\\d+)").find(s)?.groupValues?.get(1)?.toIntOrNull() ?: 1
        return buildJsonObject {
            put("pageCount", pageCount)
            put("items", JsonArray(items))
        }
    }

    /** Index of the brace closing the object that opens at [start], skipping strings. */
    private fun matchBrace(s: String, start: Int): Int {
        if (start >= s.length || s[start] != '{') return -1
        var depth = 0
        var inString = false
        var i = start
        while (i < s.length) {
            val c = s[i]
            if (inString) {
                if (c == '\\') i++ else if (c == '"') inString = false
            } else when (c) {
                '"' -> inString = true
                '{' -> depth++
                '}' -> { depth--; if (depth == 0) return i }
            }
            i++
        }
        return -1
    }

    /** Install link (and setup page) for a community addon. */
    suspend fun resolve(slug: String): JsonElement {
        val url = manifestUrlFor(slug) ?: error("Couldn't read that addon's install link. Try again in a moment.")
        return buildJsonObject {
            put("manifest", url)
            put("configure", configureUrl(url))
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
        log.i { "adult content ${if (show) "on" else "off"}: $changed addons changed" }
        runCatching { HomeRepository.refresh(AddonRepository.uiState.value.addons.enabledAddons(), force = true) }
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

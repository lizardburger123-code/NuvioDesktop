package com.nuvio.app.shell

import co.touchlab.kermit.Logger
import com.nuvio.app.core.storage.DesktopStorage
import com.nuvio.app.features.autosync.DesktopSubtitleCharsetDetector
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayInputStream
import java.net.URLEncoder
import java.nio.file.Files
import java.nio.file.Path
import java.util.Locale
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream

/** What is playing, for subtitle search. */
internal data class SubtitleQuery(
    val title: String,
    val imdbId: String? = null,
    val year: Int? = null,
    val season: Int? = null,
    val episode: Int? = null,
    /** File or release name of the playing source; results closest to it rank first. */
    val releaseHint: String? = null,
    val languages: List<String> = listOf("ar", "en"),
)

internal data class SubtitleResult(
    val provider: String,
    val providerName: String,
    val id: String,
    val language: String,
    val release: String,
    val downloads: Long = 0,
    val hearingImpaired: Boolean = false,
    val score: Double = 0.0,
    /** 0..1: how closely the release name fits the playing file (see [SubtitleReleaseMatch]). */
    val match: Double = 0.0,
)

/**
 * Manual subtitle search across OpenSubtitles, SubDL, SubSource and Podnapisi (strong Arabic
 * coverage between them). Keys are the user's own and live in [ShellSubtitleStore].
 */
internal object SubtitleSearchService {
    private val log = Logger.withTag("SubtitleSearch")
    private val json = Json { ignoreUnknownKeys = true }
    private const val UserAgent = "Nuvio v1.0"
    private val http by lazy {
        OkHttpClient.Builder()
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .followRedirects(true)
            .build()
    }
    // Kept with the app data (not the cache) so a subtitle chosen for a title is still there on resume.
    private val cacheDir: Path by lazy { DesktopStorage.rootDir.resolve("subtitles").also { Files.createDirectories(it) } }

    @Volatile private var openSubtitlesToken: Pair<String, String>? = null // token to base url

    private val iso3 = mapOf(
        "ar" to "ara", "en" to "eng", "fr" to "fre", "tr" to "tur", "es" to "spa", "de" to "ger", "fa" to "per", "ur" to "urd",
    )
    private val names = mapOf(
        "ar" to "arabic", "en" to "english", "fr" to "french", "tr" to "turkish", "es" to "spanish", "de" to "german", "fa" to "farsi_persian", "ur" to "urdu",
    )

    // ---- Public API ----------------------------------------------------------------------------

    /** Sources with a saved key (Podnapisi needs none and isn't counted). */
    fun configuredSources(): Int {
        val keys = ShellSubtitleStore.prefs.value.keys
        return listOf(keys.opensubtitlesApiKey, keys.subdlApiKey, keys.subsourceApiKey).count { it.isNotBlank() }
    }

    suspend fun search(query: SubtitleQuery): List<SubtitleResult> = withContext(Dispatchers.IO) {
        val keys = ShellSubtitleStore.prefs.value.keys
        val jobs = coroutineScope {
            listOfNotNull(
                keys.opensubtitlesApiKey.takeIf { it.isNotBlank() }?.let { async { safe("opensubtitles") { openSubtitles(query, it) } } },
                keys.subdlApiKey.takeIf { it.isNotBlank() }?.let { async { safe("subdl") { subdl(query, it) } } },
                keys.subsourceApiKey.takeIf { it.isNotBlank() }?.let { async { safe("subsource") { subsource(query, it) } } },
                async { safe("podnapisi") { podnapisi(query) } },
            ).awaitAll()
        }
        val all = jobs.flatten()
        val wanted = query.languages.ifEmpty { listOf("ar", "en") }
        val file = SubtitleReleaseMatch.parse(query.releaseHint)
        all.map { result ->
            val match = if (query.releaseHint.isNullOrBlank()) 0.0 else SubtitleReleaseMatch.score(file, result.release, query.season, query.episode)
            result.copy(match = match, score = rank(result, wanted, match))
        }
            .sortedByDescending { it.score }
            .distinctBy { "${it.provider}:${it.id}" }
            .take(80)
    }

    /** Downloads, unpacks and re-encodes as UTF-8. Returns a local .srt/.ass/.vtt path. */
    suspend fun download(result: SubtitleResult): Path = withContext(Dispatchers.IO) {
        val keys = ShellSubtitleStore.prefs.value.keys
        val bytes = when (result.provider) {
            "opensubtitles" -> openSubtitlesDownload(result, keys)
            "subdl" -> get("https://dl.subdl.com${result.id}")
            "subsource" -> get("https://api.subsource.net/api/v1/subtitles/${result.id}/download", mapOf("X-API-Key" to keys.subsourceApiKey))
            "podnapisi" -> get("https://www.podnapisi.net/subtitles/${result.id}/download")
            else -> error("Unknown subtitle source.")
        }
        val (name, payload) = unpack(bytes)
        val text = DesktopSubtitleCharsetDetector.decode(payload, languageHint = result.language)
        val extension = name.substringAfterLast('.', "srt").lowercase(Locale.ROOT).takeIf { it in setOf("srt", "ass", "ssa", "vtt", "sub") } ?: "srt"
        val target = cacheDir.resolve("${result.provider}-${result.id.hashCode().toUInt()}.$extension")
        Files.writeString(target, text)
        target
    }

    suspend fun test(provider: String): JsonElement {
        val probe = SubtitleQuery(title = "Inception", imdbId = "tt1375666", year = 2010, languages = listOf("en"))
        val keys = ShellSubtitleStore.prefs.value.keys
        val result = withContext(Dispatchers.IO) {
            runCatching {
                when (provider) {
                    "opensubtitles" -> openSubtitles(probe, keys.opensubtitlesApiKey.ifBlank { error("Paste your OpenSubtitles API key first.") })
                    "subdl" -> subdl(probe, keys.subdlApiKey.ifBlank { error("Paste your SubDL API key first.") })
                    "subsource" -> subsource(probe, keys.subsourceApiKey.ifBlank { error("Paste your SubSource API key first.") })
                    "podnapisi" -> podnapisi(probe)
                    else -> error("Unknown source.")
                }
            }
        }
        return buildJsonObject {
            result.onSuccess { list ->
                put("ok", list.isNotEmpty())
                if (list.isEmpty()) put("message", "The key was accepted but the test search returned nothing.")
            }.onFailure { error ->
                put("ok", false)
                put("message", error.message ?: "That didn't work.")
            }
        }
    }

    // ---- Ranking -------------------------------------------------------------------------------

    /** Language order first, then how well the release fits the file, then popularity. */
    internal fun rank(result: SubtitleResult, wanted: List<String>, match: Double): Double {
        val languageIndex = wanted.indexOf(result.language).takeIf { it >= 0 } ?: wanted.size
        val languageScore = (wanted.size - languageIndex) * 100.0
        val popularity = kotlin.math.ln(1.0 + result.downloads) / 4.0
        val hiPenalty = if (result.hearingImpaired) 1.5 else 0.0
        return languageScore + match * 40.0 + popularity - hiPenalty
    }

    // ---- Providers -----------------------------------------------------------------------------

    private suspend fun safe(provider: String, block: suspend () -> List<SubtitleResult>): List<SubtitleResult> =
        withTimeoutOrNull(18_000) { runCatching { block() }.onFailure { log.w(it) { "$provider search failed" } }.getOrNull() }.orEmpty()

    private fun enc(value: String) = URLEncoder.encode(value, Charsets.UTF_8)
    private fun numericImdb(id: String?): String? = id?.removePrefix("tt")?.trimStart('0')?.takeIf { it.isNotEmpty() && it.all(Char::isDigit) }

    private fun openSubtitles(query: SubtitleQuery, apiKey: String): List<SubtitleResult> {
        val params = mutableListOf("languages=${enc(query.languages.sorted().joinToString(","))}", "order_by=download_count")
        val imdb = numericImdb(query.imdbId)
        if (query.season != null && query.episode != null) {
            if (imdb != null) params += "parent_imdb_id=$imdb" else params += "query=${enc(query.title)}"
            params += "season_number=${query.season}"
            params += "episode_number=${query.episode}"
        } else {
            if (imdb != null) params += "imdb_id=$imdb" else params += "query=${enc(query.title)}"
            query.year?.let { params += "year=$it" }
        }
        val body = getText("https://api.opensubtitles.com/api/v1/subtitles?${params.joinToString("&")}", mapOf("Api-Key" to apiKey))
        val data = json.parseToJsonElement(body).obj()["data"] as? JsonArray ?: return emptyList()
        return data.mapNotNull { element ->
            val attributes = element.obj()["attributes"]?.obj() ?: return@mapNotNull null
            val file = (attributes["files"] as? JsonArray)?.firstOrNull()?.obj() ?: return@mapNotNull null
            val fileId = file.str("file_id") ?: return@mapNotNull null
            SubtitleResult(
                provider = "opensubtitles",
                providerName = "OpenSubtitles",
                id = fileId,
                language = normalizeLanguage(attributes.str("language")),
                release = attributes.str("release") ?: file.str("file_name").orEmpty(),
                downloads = attributes.str("download_count")?.toLongOrNull() ?: 0,
                hearingImpaired = attributes.str("hearing_impaired") == "true",
            )
        }
    }

    private fun openSubtitlesDownload(result: SubtitleResult, keys: SubtitleProviderKeys): ByteArray {
        val headers = mutableMapOf("Api-Key" to keys.opensubtitlesApiKey)
        var base = "https://api.opensubtitles.com/api/v1"
        if (keys.opensubtitlesUsername.isNotBlank() && keys.opensubtitlesPassword.isNotBlank()) {
            val session = openSubtitlesToken ?: runCatching {
                val login = postJson(
                    "$base/login",
                    """{"username":${JsonPrimitive(keys.opensubtitlesUsername)},"password":${JsonPrimitive(keys.opensubtitlesPassword)}}""",
                    headers,
                )
                val obj = json.parseToJsonElement(login).obj()
                val token = obj.str("token") ?: error("OpenSubtitles login failed.")
                val baseUrl = obj.str("base_url")?.let { "https://$it/api/v1" } ?: base
                (token to baseUrl).also { openSubtitlesToken = it }
            }.getOrNull()
            if (session != null) {
                headers["Authorization"] = "Bearer ${session.first}"
                base = session.second
            }
        }
        val response = postJson("$base/download", """{"file_id":${result.id}}""", headers)
        val link = json.parseToJsonElement(response).obj().str("link")
            ?: error(json.parseToJsonElement(response).obj().str("message") ?: "OpenSubtitles didn't return a download link.")
        return get(link)
    }

    private fun subdl(query: SubtitleQuery, apiKey: String): List<SubtitleResult> {
        val params = mutableListOf(
            "api_key=${enc(apiKey)}",
            "languages=${enc(query.languages.joinToString(",") { it.uppercase(Locale.ROOT) })}",
            "subs_per_page=30",
        )
        if (query.imdbId?.startsWith("tt") == true) params += "imdb_id=${query.imdbId}" else params += "film_name=${enc(query.title)}"
        if (query.season != null && query.episode != null) {
            params += "type=tv"
            params += "season_number=${query.season}"
            params += "episode_number=${query.episode}"
        } else {
            params += "type=movie"
            query.year?.takeIf { query.imdbId == null }?.let { params += "year=$it" }
        }
        val body = getText("https://api.subdl.com/api/v1/subtitles?${params.joinToString("&")}")
        val root = json.parseToJsonElement(body).obj()
        if (root.str("status") == "false") error(root.str("error") ?: "SubDL rejected the request.")
        val list = root["subtitles"] as? JsonArray ?: return emptyList()
        return list.mapNotNull { element ->
            val sub = element.obj()
            val url = sub.str("url") ?: return@mapNotNull null
            SubtitleResult(
                provider = "subdl",
                providerName = "SubDL",
                id = url,
                language = normalizeLanguage(sub.str("lang") ?: sub.str("language")),
                release = sub.str("release_name") ?: sub.str("name").orEmpty(),
                hearingImpaired = sub.str("hi") == "true",
            )
        }
    }

    private fun subsource(query: SubtitleQuery, apiKey: String): List<SubtitleResult> {
        val headers = mapOf("X-API-Key" to apiKey)
        val searchParams = mutableListOf<String>()
        if (query.imdbId?.startsWith("tt") == true) {
            searchParams += "searchType=imdb"
            searchParams += "imdb=${query.imdbId}"
        } else {
            searchParams += "searchType=text"
            searchParams += "q=${enc(query.title)}"
            query.year?.let { searchParams += "year=$it" }
        }
        if (query.season != null) {
            searchParams += "type=series"
            searchParams += "season=${query.season}"
        } else {
            searchParams += "type=movie"
        }
        val movies = json.parseToJsonElement(getText("https://api.subsource.net/api/v1/movies/search?${searchParams.joinToString("&")}", headers))
            .obj()["data"] as? JsonArray ?: return emptyList()
        val movie = movies.firstOrNull { query.season == null || it.obj().str("season")?.toIntOrNull() == query.season }?.obj()
            ?: movies.firstOrNull()?.obj() ?: return emptyList()
        val movieId = movie.str("movieId") ?: return emptyList()
        return query.languages.flatMap { code ->
            val language = names[code] ?: return@flatMap emptyList()
            val subs = json.parseToJsonElement(
                getText("https://api.subsource.net/api/v1/subtitles?movieId=$movieId&language=$language&limit=40&sort=popular", headers),
            ).obj()["data"] as? JsonArray ?: return@flatMap emptyList()
            subs.mapNotNull { element ->
                val sub = element.obj()
                val id = sub.str("subtitleId") ?: return@mapNotNull null
                val releases = (sub["releaseInfo"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()
                val release = releases.joinToString(" / ")
                if (query.episode != null && !matchesEpisode(release, query.season, query.episode)) return@mapNotNull null
                SubtitleResult(
                    provider = "subsource",
                    providerName = "SubSource",
                    id = id,
                    language = code,
                    release = release,
                    downloads = sub.str("downloads")?.toLongOrNull() ?: 0,
                    hearingImpaired = sub.str("hearingImpaired") == "true",
                )
            }
        }
    }

    private fun podnapisi(query: SubtitleQuery): List<SubtitleResult> {
        return query.languages.flatMap { code ->
            val params = mutableListOf("keywords=${enc(query.title)}", "language=$code")
            query.year?.let { params += "year=$it" }
            if (query.season != null && query.episode != null) {
                params += "movie_type=tv-series"
                params += "seasons=${query.season}"
                params += "episodes=${query.episode}"
            } else {
                params += "movie_type=movie"
            }
            val body = getText(
                "https://www.podnapisi.net/subtitles/search/advanced?${params.joinToString("&")}",
                mapOf("Accept" to "application/json"),
            )
            val data = runCatching { json.parseToJsonElement(body).obj()["data"] as? JsonArray }.getOrNull() ?: return@flatMap emptyList()
            data.mapNotNull { element ->
                val sub = element.obj()
                val id = sub.str("id") ?: return@mapNotNull null
                val releases = (sub["custom_releases"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()
                SubtitleResult(
                    provider = "podnapisi",
                    providerName = "Podnapisi",
                    id = id,
                    language = code,
                    release = releases.firstOrNull() ?: (sub["movie"] as? JsonObject)?.str("title").orEmpty(),
                    downloads = sub.str("downloads")?.toLongOrNull() ?: 0,
                    hearingImpaired = (sub["flags"] as? JsonArray)?.any { (it as? JsonPrimitive)?.contentOrNull == "hearing_impaired" } == true,
                )
            }
        }
    }

    private fun matchesEpisode(release: String, season: Int?, episode: Int): Boolean {
        val text = release.lowercase(Locale.ROOT)
        val s = season ?: return true
        val patterns = listOf(
            Regex("s0*${s}e0*${episode}(?!\\d)"),
            Regex("${s}x0*${episode}(?!\\d)"),
            Regex("e0*${episode}(?!\\d)"),
        )
        // Season packs and releases without an episode code still count.
        return patterns.any { it.containsMatchIn(text) } || !Regex("e\\d{1,3}|\\d+x\\d+").containsMatchIn(text)
    }

    // ---- HTTP + unpacking --------------------------------------------------------------------

    private fun request(url: String, headers: Map<String, String>): Request.Builder =
        Request.Builder().url(url).header("User-Agent", UserAgent).apply { headers.forEach { (k, v) -> header(k, v) } }

    private fun getText(url: String, headers: Map<String, String> = emptyMap()): String =
        http.newCall(request(url, headers).get().build()).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) error(describeHttp(response.code, body))
            body
        }

    private fun get(url: String, headers: Map<String, String> = emptyMap()): ByteArray =
        http.newCall(request(url, headers).get().build()).execute().use { response ->
            if (!response.isSuccessful) error(describeHttp(response.code, response.body?.string().orEmpty()))
            val bytes = response.body?.bytes() ?: error("Empty download.")
            require(bytes.size < 20 * 1024 * 1024) { "That subtitle file is unexpectedly large." }
            bytes
        }

    private fun postJson(url: String, body: String, headers: Map<String, String>): String =
        http.newCall(request(url, headers).header("Accept", "application/json").post(body.toRequestBody("application/json".toMediaType())).build())
            .execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) error(describeHttp(response.code, text))
                text
            }

    private fun describeHttp(code: Int, body: String): String = when (code) {
        401, 403 -> "The site rejected the key (HTTP $code). Check it in Settings › Subtitles."
        406, 429 -> "Download limit reached for today on this site (HTTP $code)."
        else -> {
            val message = runCatching { json.parseToJsonElement(body).obj().let { it.str("message") ?: it.str("error") } }.getOrNull()
            message ?: "The site answered HTTP $code."
        }
    }

    /** Returns the best subtitle file inside a zip, or the bytes themselves when not zipped. */
    private fun unpack(bytes: ByteArray): Pair<String, ByteArray> {
        val isZip = bytes.size > 4 && bytes[0] == 'P'.code.toByte() && bytes[1] == 'K'.code.toByte()
        if (!isZip) return "subtitle.srt" to bytes
        val candidates = mutableListOf<Pair<String, ByteArray>>()
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val name = entry.name
                val ext = name.substringAfterLast('.', "").lowercase(Locale.ROOT)
                if (!entry.isDirectory && ext in setOf("srt", "ass", "ssa", "vtt", "sub")) {
                    candidates += name to zip.readBytes()
                }
            }
        }
        return candidates.sortedWith(compareBy({ !it.first.endsWith(".srt", true) }, { -it.second.size })).firstOrNull()
            ?: error("The download didn't contain a subtitle file.")
    }

    internal fun normalizeLanguage(value: String?): String {
        val v = value.orEmpty().trim().lowercase(Locale.ROOT)
        return when {
            v.isEmpty() -> "und"
            v.length == 2 -> v
            v == "arabic" || v == "ara" -> "ar"
            v == "english" || v == "eng" -> "en"
            else -> iso3.entries.firstOrNull { it.value == v }?.key ?: names.entries.firstOrNull { it.value == v }?.key ?: v.take(2)
        }
    }

    private fun JsonElement.obj(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
}

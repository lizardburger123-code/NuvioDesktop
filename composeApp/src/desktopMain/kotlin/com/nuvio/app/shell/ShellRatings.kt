package com.nuvio.app.shell

import co.touchlab.kermit.Logger
import com.nuvio.app.features.addons.httpGetText
import com.nuvio.app.features.addons.httpGetTextWithHeaders
import com.nuvio.app.features.details.MetaDetails
import com.nuvio.app.features.details.MetaExternalRating
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.net.URLEncoder
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.concurrent.ConcurrentHashMap

/**
 * Scores a title's own catalog didn't bring, filled in from open sources that need no key:
 *
 *  - episode scores and the IMDb score from Cinemeta (Stremio's catalog, indexed by IMDb id).
 *    Anime catalogs (Kitsu, MyAnimeList ids) carry neither;
 *  - Rotten Tomatoes and Metacritic from Wikidata, which records them for many films and series.
 *    They can lag the sites by a few points. With an MDBList key (Settings > Appearance >
 *    Ratings) the live numbers are used instead and these are not asked for.
 *
 * A title under another id scheme is matched to its IMDb id by exact name and year, and its
 * episodes by air date, so a wrong match fills in nothing rather than the wrong numbers.
 */
internal object ShellRatings {
    private val log = Logger.withTag("ShellRatings")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }
    private const val Cinemeta = "https://v3-cinemeta.strem.io"
    private val imdbRegex = Regex("tt\\d{5,}")
    private val siteSources = setOf("tomatoes", "audience", "metacritic")

    private data class Episode(val season: Int, val episode: Int, val date: LocalDate?, val rating: Double)
    private data class Extra(
        val imdbRating: String? = null,
        val sites: List<MetaExternalRating> = emptyList(),
        val episodes: List<Episode> = emptyList(),
    )

    private val cache = ConcurrentHashMap<String, Extra>()
    private val inFlight = ConcurrentHashMap.newKeySet<String>()
    private val _version = MutableStateFlow(0)
    /** Changes whenever scores for some title arrive. */
    val version: StateFlow<Int> = _version.asStateFlow()

    private fun needsEpisodes(meta: MetaDetails) =
        meta.videos.any { (it.season ?: 0) > 0 } && meta.videos.none { (it.rating ?: 0.0) > 0.0 }
    private fun needsImdb(meta: MetaDetails) = (meta.imdbRating?.toDoubleOrNull() ?: 0.0) <= 0.0
    private fun needsSites(meta: MetaDetails) = meta.externalRatings.none { it.source in siteSources }

    /** [meta] with whatever scores are known for it; asks for the missing ones in the background. */
    fun fill(meta: MetaDetails): MetaDetails {
        val episodes = needsEpisodes(meta)
        val imdb = needsImdb(meta)
        val sites = needsSites(meta)
        if (!episodes && !imdb && !sites) return meta
        val key = "${meta.type}:${meta.id}"
        val extra = cache[key]
        if (extra == null) {
            if (inFlight.add(key)) {
                scope.launch {
                    val found = runCatching { load(meta, episodes, imdb, sites) }
                        .onFailure { log.d { "No extra scores for ${meta.name}: ${it.message}" } }
                        .getOrDefault(Extra())
                    cache[key] = found
                    inFlight.remove(key)
                    _version.update { it + 1 }
                }
            }
            return meta
        }
        return runCatching { merge(meta, extra, episodes, imdb, sites) }.getOrDefault(meta)
    }

    private fun merge(meta: MetaDetails, extra: Extra, episodes: Boolean, imdb: Boolean, sites: Boolean): MetaDetails {
        var result = meta
        if (imdb && extra.imdbRating != null) result = result.copy(imdbRating = extra.imdbRating)
        if (sites && extra.sites.isNotEmpty()) {
            result = result.copy(externalRatings = result.externalRatings + extra.sites.filter { site -> result.externalRatings.none { it.source == site.source } })
        }
        if (episodes && extra.episodes.isNotEmpty()) {
            val sameNumbering = imdbRegex.containsMatchIn(meta.id)
            val byNumber = extra.episodes.associateBy { it.season to it.episode }
            result = result.copy(videos = result.videos.map { video ->
                val season = video.season ?: return@map video
                val number = video.episode ?: return@map video
                if (season <= 0) return@map video
                val match = if (sameNumbering) {
                    byNumber[season to number]
                } else {
                    // Another catalog's seasons rarely line up with IMDb's: go by the air date.
                    val aired = dateOf(video.released) ?: return@map video
                    val near = extra.episodes.filter { it.date != null && kotlin.math.abs(ChronoUnit.DAYS.between(it.date, aired)) <= 1 }
                    val sameDay = near.filter { it.date == aired }.ifEmpty { near }
                    sameDay.singleOrNull() ?: sameDay.firstOrNull { it.episode == number }
                }
                if (match != null && match.rating > 0.0) video.copy(rating = match.rating) else video
            })
        }
        return result
    }

    private suspend fun load(meta: MetaDetails, episodes: Boolean, imdb: Boolean, sites: Boolean): Extra = coroutineScope {
        val type = if (meta.type == "movie") "movie" else "series"
        val imdbId = imdbRegex.find(meta.id)?.value
            ?: meta.imdbId?.let { imdbRegex.find(it)?.value }
            ?: withTimeoutOrNull(8_000) { findImdbId(type, meta.name, meta.releaseInfo) }
            ?: return@coroutineScope Extra()
        val catalog = async {
            if (episodes || imdb) withTimeoutOrNull(12_000) { runCatching { fromCinemeta(type, imdbId) }.getOrNull() } else null
        }
        val wikidata = async {
            if (sites) withTimeoutOrNull(10_000) { runCatching { fromWikidata(imdbId) }.getOrNull() }.orEmpty() else emptyList()
        }
        val found = catalog.await()
        Extra(imdbRating = found?.imdbRating, sites = wikidata.await(), episodes = found?.episodes.orEmpty())
    }

    // ---- Cinemeta ------------------------------------------------------------------------------

    private suspend fun fromCinemeta(type: String, imdbId: String): Extra {
        val root = json.parseToJsonElement(httpGetText("$Cinemeta/meta/$type/$imdbId.json")) as? JsonObject ?: return Extra()
        val meta = root["meta"] as? JsonObject ?: return Extra()
        val rating = meta.text("imdbRating")?.takeIf { (it.toDoubleOrNull() ?: 0.0) > 0.0 }
        val episodes = (meta["videos"] as? JsonArray).orEmpty().mapNotNull { element ->
            val video = element as? JsonObject ?: return@mapNotNull null
            val season = video.text("season")?.toIntOrNull() ?: return@mapNotNull null
            val number = (video.text("episode") ?: video.text("number"))?.toIntOrNull() ?: return@mapNotNull null
            val score = video.text("rating")?.toDoubleOrNull() ?: return@mapNotNull null
            if (season <= 0 || score <= 0.0) return@mapNotNull null
            Episode(season, number, dateOf(video.text("released") ?: video.text("firstAired")), score)
        }
        return Extra(imdbRating = rating, episodes = episodes)
    }

    private fun normalize(value: String): String = value.lowercase().filter { it.isLetterOrDigit() }

    /** The same title on Cinemeta: exactly this name, and this year when both are known. */
    private suspend fun findImdbId(type: String, name: String, releaseInfo: String?): String? {
        val wanted = normalize(name)
        if (wanted.length < 2) return null
        val query = URLEncoder.encode(name.trim(), "UTF-8").replace("+", "%20")
        val root = json.parseToJsonElement(httpGetText("$Cinemeta/catalog/$type/top/search=$query.json")) as? JsonObject ?: return null
        val year = releaseInfo?.let { Regex("\\d{4}").find(it)?.value }
        return (root["metas"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.firstOrNull { item ->
            val itemYear = (item.text("releaseInfo") ?: item.text("year"))?.let { Regex("\\d{4}").find(it)?.value }
            normalize(item.text("name").orEmpty()) == wanted && (year == null || itemYear == null || year == itemYear)
        }?.text("id")?.let { imdbRegex.find(it)?.value }
    }

    // ---- Wikidata ------------------------------------------------------------------------------

    private suspend fun fromWikidata(imdbId: String): List<MetaExternalRating> {
        val query = """
            SELECT ?byLabel ?score ?when WHERE {
              ?item wdt:P345 "$imdbId" .
              ?item p:P444 ?statement .
              ?statement ps:P444 ?score ; pq:P447 ?by .
              OPTIONAL { ?statement pq:P585 ?when }
              ?by rdfs:label ?byLabel .
              FILTER(LANG(?byLabel) = "en")
            }
        """.trimIndent()
        val url = "https://query.wikidata.org/sparql?format=json&query=" + URLEncoder.encode(query, "UTF-8")
        val text = httpGetTextWithHeaders(url, mapOf(
            "Accept" to "application/sparql-results+json",
            "User-Agent" to "NuvioDesktopFork/1.0 (title scores lookup)",
        ))
        val rows = ((json.parseToJsonElement(text) as? JsonObject)?.get("results") as? JsonObject)?.get("bindings") as? JsonArray ?: return emptyList()
        data class Row(val by: String, val score: String, val at: String)
        val parsed = rows.mapNotNull { it as? JsonObject }.mapNotNull { row ->
            val by = (row["byLabel"] as? JsonObject)?.text("value") ?: return@mapNotNull null
            val score = (row["score"] as? JsonObject)?.text("value")?.trim() ?: return@mapNotNull null
            Row(by, score, (row["when"] as? JsonObject)?.text("value").orEmpty())
        }
        // The most recent statement of each kind; a statement without a date is the oldest.
        fun latest(site: String, pattern: Regex): Double? = parsed
            .filter { it.by.equals(site, ignoreCase = true) }
            .mapNotNull { row -> pattern.matchEntire(row.score)?.groupValues?.get(1)?.toDoubleOrNull()?.let { row.at to it } }
            .maxByOrNull { it.first }?.second?.takeIf { it in 0.0..100.0 }
        return listOfNotNull(
            latest("Rotten Tomatoes", Regex("(\\d{1,3})\\s?%"))?.let { MetaExternalRating(source = "tomatoes", value = it) },
            latest("Metacritic", Regex("(\\d{1,3})(?:\\s?/\\s?100)?"))?.let { MetaExternalRating(source = "metacritic", value = it) },
        )
    }

    private fun dateOf(value: String?): LocalDate? = value?.take(10)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }

    private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
}

package com.nuvio.app.shell

import co.touchlab.kermit.Logger
import com.nuvio.app.core.network.DesktopIPv4FirstDns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

private val suggestJson = Json { ignoreUnknownKeys = true; isLenient = true }
private val suggestHttp by lazy {
    OkHttpClient.Builder().dns(DesktopIPv4FirstDns()).connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()
}

/**
 * A GET that gives up after [seconds] in all. A coroutine timeout can't stop a blocking call: a
 * slow Wikidata used to keep the person page waiting a minute, then throw the answer away.
 */
private fun suggestGet(url: String, seconds: Long, headers: Map<String, String> = emptyMap()): String {
    val request = Request.Builder().url(url).apply { headers.forEach { (name, value) -> header(name, value) } }.get().build()
    val client = suggestHttp.newBuilder().callTimeout(seconds, TimeUnit.SECONDS).build()
    return client.newCall(request).execute().use { response ->
        if (!response.isSuccessful) error("HTTP ${response.code}")
        response.body?.string().orEmpty()
    }
}

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
private fun JsonObject.texts(key: String): List<String> =
    (this[key] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()

/**
 * "More like this" for titles whose catalog suggests nothing: Cinemeta's most popular titles in
 * the same genres, ranked by how many genres they share, then by decade and score. No key needed.
 */
internal object ShellSimilar {
    private val log = Logger.withTag("ShellSimilar")
    private const val Cinemeta = "https://v3-cinemeta.strem.io"
    private val cache = ConcurrentHashMap<String, JsonArray>()

    private val known = listOf(
        "Action", "Adventure", "Animation", "Biography", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy",
        "History", "Horror", "Music", "Musical", "Mystery", "Romance", "Sci-Fi", "Sport", "Thriller", "War", "Western",
    )

    /** A catalog's genre names in Cinemeta's words ("Science Fiction", "Sci-Fi & Fantasy", "Anime"...). */
    private fun genresOf(names: List<String>): List<String> = names.flatMap { raw ->
        val name = raw.trim().lowercase()
        buildList {
            if ("sci" in name) add("Sci-Fi")
            if (name == "anime" || "animat" in name) add("Animation")
            if ("supernatural" in name || "magic" in name) add("Fantasy")
            if ("suspense" in name || "psychological" in name) add("Thriller")
            if ("slice of life" in name) add("Drama")
            if ("sports" in name) add("Sport")
            known.forEach { genre -> if (genre.lowercase() in name.split(Regex("[^a-z-]+"))) add(genre) }
        }
    }.distinct()

    /** Genres and year of [id] from Cinemeta, for a title the page knows only by its id. */
    private suspend fun lookUp(kind: String, id: String): Pair<List<String>, String?>? = withContext(Dispatchers.IO) {
        withTimeoutOrNull(7_000) {
            runCatching {
                val body = suggestGet("$Cinemeta/meta/$kind/$id.json", 6)
                val meta = (suggestJson.parseToJsonElement(body) as? JsonObject)?.get("meta") as? JsonObject
                meta?.let { it.texts("genres") to (it.text("releaseInfo") ?: it.text("year")) }
            }.getOrNull()
        }
    }

    suspend fun forTitle(type: String, id: String, name: String, genres: List<String>, releaseInfo: String?): JsonArray {
        val key = "$type:$id"
        cache[key]?.let { return it }
        val kind = if (type == "movie") "movie" else "series"
        // Continue watching knows a title only by its id: ask Cinemeta for its genres and year.
        val looked = if (genresOf(genres).isEmpty() && id.startsWith("tt")) lookUp(kind, id) else null
        val wanted = genresOf(looked?.first?.takeIf { it.isNotEmpty() } ?: genres)
        if (wanted.isEmpty()) return JsonArray(emptyList())
        val year = (releaseInfo ?: looked?.second)?.let { Regex("\\d{4}").find(it)?.value?.toIntOrNull() }
        // The rarer genres say more about a title than "Drama" does: ask for those lists first.
        val asked = wanted.sortedBy { it in setOf("Drama", "Comedy", "Action") }.take(3)
        val lists = withContext(Dispatchers.IO) {
            coroutineScope {
                asked.map { genre ->
                    async {
                        withTimeoutOrNull(9_000) {
                            runCatching {
                                val url = "$Cinemeta/catalog/$kind/top/genre=${URLEncoder.encode(genre, "UTF-8").replace("+", "%20")}.json"
                                ((suggestJson.parseToJsonElement(suggestGet(url, 9)) as? JsonObject)?.get("metas") as? JsonArray).orEmpty()
                            }.onFailure { log.d { "No $genre list: ${it.message}" } }.getOrNull()
                        }.orEmpty()
                    }
                }.awaitAll()
            }
        }
        data class Scored(val item: JsonObject, val score: Double)
        val seen = HashSet<String>()
        val scored = lists.flatMapIndexed { listIndex, list ->
            list.mapIndexedNotNull { position, element ->
                val item = element as? JsonObject ?: return@mapIndexedNotNull null
                val itemId = item.text("id") ?: return@mapIndexedNotNull null
                if (itemId == id || item.text("name").equals(name, ignoreCase = true) || !seen.add(itemId)) return@mapIndexedNotNull null
                val itemGenres = (item.texts("genres") + item.texts("genre")).distinct()
                val shared = itemGenres.count { it in wanted }
                val itemYear = (item.text("releaseInfo") ?: item.text("year"))?.let { Regex("\\d{4}").find(it)?.value?.toIntOrNull() }
                val era = if (year != null && itemYear != null) (3.0 - kotlin.math.abs(year - itemYear) / 5.0).coerceAtLeast(0.0) else 0.0
                val rating = item.text("imdbRating")?.toDoubleOrNull() ?: 0.0
                // Shared genres first; then how close in time, how well liked, how popular.
                Scored(item, shared * 10.0 + era + rating / 2.0 - position / 40.0 - listIndex * 0.5)
            }
        }
        val result = buildJsonArray {
            scored.sortedByDescending { it.score }.take(24).forEach { (item, _) ->
                add(buildJsonObject {
                    put("id", item.text("id").orEmpty())
                    put("type", kind)
                    put("name", item.text("name").orEmpty())
                    item.text("poster")?.let { put("poster", it) }
                    (item.text("releaseInfo") ?: item.text("year"))?.let { put("releaseInfo", it) }
                    item.text("imdbRating")?.let { put("imdbRating", it) }
                })
            }
        }
        if (result.isNotEmpty()) cache[key] = result
        return result
    }
}

/**
 * A person's work, for the page behind a clickable name in a cast list: every film and series
 * Wikidata lists them in (as cast, voice or director) that has an IMDb id, newest first. No key
 * needed. When several people share the name, the one in the title the name was picked from is
 * taken (when the page says which title), else the one with the most work.
 */
internal object ShellPeople {
    private val log = Logger.withTag("ShellPeople")
    private val cache = ConcurrentHashMap<String, JsonObject>()

    private data class Work(val imdb: String, var name: String, var year: Int? = null, val kinds: MutableSet<String> = HashSet(), val roles: MutableSet<String> = HashSet())

    /** Items (Q ids) whose English label or alias is [name] in any capitalisation, from Wikidata's search. */
    private fun personIds(name: String): List<String> {
        val url = "https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&type=item&language=en&uselang=en&limit=20&search=" +
            URLEncoder.encode(name, "UTF-8")
        val text = suggestGet(url, 6, mapOf("User-Agent" to "NuvioDesktopFork/1.0 (cast lookup)"))
        val found = (suggestJson.parseToJsonElement(text) as? JsonObject)?.get("search") as? JsonArray ?: return emptyList()
        val wanted = name.lowercase()
        return found.mapNotNull { it as? JsonObject }
            .filter { item ->
                listOfNotNull(item.text("label"), (item["match"] as? JsonObject)?.text("text"))
                    .any { it.trim().replace(Regex("\\s+"), " ").lowercase() == wanted }
            }
            .mapNotNull { item -> item.text("id")?.takeIf { it.matches(Regex("Q\\d+")) } }
            .distinct()
            .take(10)
    }

    suspend fun works(name: String, titleId: String? = null): JsonObject {
        val wanted = name.trim().replace(Regex("\\s+"), " ")
        require(wanted.length in 2..120) { "No name." }
        // The title (IMDb id) the name was picked from, so a namesake isn't shown instead.
        val from = titleId?.let { Regex("tt\\d{5,}").find(it)?.value }
        val cacheKey = "${wanted.lowercase()}|${from.orEmpty()}"
        cache[cacheKey]?.let { return it }
        val literal = wanted.replace("\\", "\\\\").replace("\"", "\\\"")
        // A label match is exact ("leonardo dicaprio" misses); Wikidata's search ignores case. When
        // the search can't help, the exact label is used as before.
        val ids = withContext(Dispatchers.IO) { runCatching { personIds(wanted) }.getOrDefault(emptyList()) }
        val whoClause = if (ids.isNotEmpty()) {
            "VALUES ?person { ${ids.joinToString(" ") { "wd:$it" }} } ?person wdt:P31 wd:Q5 ."
        } else {
            "?person rdfs:label \"$literal\"@en ; wdt:P31 wd:Q5 ."
        }
        val query = """
            SELECT ?person ?work ?workLabel ?imdb ?date ?start ?kindLabel ?role WHERE {
              $whoClause
              { ?work wdt:P161 ?person . BIND("cast" AS ?role) }
              UNION { ?work wdt:P725 ?person . BIND("voice" AS ?role) }
              UNION { ?work wdt:P57 ?person . BIND("director" AS ?role) }
              ?work wdt:P345 ?imdb .
              OPTIONAL { ?work wdt:P577 ?date }
              OPTIONAL { ?work wdt:P580 ?start }
              OPTIONAL { ?work wdt:P31 ?kind . ?kind rdfs:label ?kindLabel . FILTER(LANG(?kindLabel) = "en") }
              ?work rdfs:label ?workLabel . FILTER(LANG(?workLabel) = "en")
            } LIMIT 4000
        """.trimIndent()
        val url = "https://query.wikidata.org/sparql?format=json&query=" + URLEncoder.encode(query, "UTF-8")
        val text = withContext(Dispatchers.IO) {
            runCatching {
                suggestGet(url, 20, mapOf(
                    "Accept" to "application/sparql-results+json",
                    "User-Agent" to "NuvioDesktopFork/1.0 (cast lookup)",
                ))
            }.onFailure { log.d { "Wikidata didn't answer: ${it.message}" } }.getOrNull()
        } ?: error("Couldn't reach the film database. Try again in a moment.")
        val rows = ((suggestJson.parseToJsonElement(text) as? JsonObject)?.get("results") as? JsonObject)?.get("bindings") as? JsonArray
            ?: JsonArray(emptyList())
        fun JsonObject.value(key: String): String? = (this[key] as? JsonObject)?.text("value")
        val people = LinkedHashMap<String, LinkedHashMap<String, Work>>()
        rows.forEach { element ->
            val row = element as? JsonObject ?: return@forEach
            val person = row.value("person") ?: return@forEach
            val imdb = row.value("imdb")?.takeIf { it.matches(Regex("tt\\d{5,}")) } ?: return@forEach
            val work = people.getOrPut(person) { LinkedHashMap() }.getOrPut(imdb) { Work(imdb, row.value("workLabel").orEmpty()) }
            (row.value("date") ?: row.value("start"))?.take(4)?.toIntOrNull()?.let { year -> work.year = minOf(work.year ?: year, year) }
            row.value("kindLabel")?.let { work.kinds += it.lowercase() }
            row.value("role")?.let { work.roles += it }
        }
        val chosen = from?.let { id -> people.values.firstOrNull { id in it } } ?: people.values.maxByOrNull { it.size }
        val works = chosen?.values.orEmpty()
            // A single episode or season is not a title of its own here.
            .filter { work -> work.name.isNotBlank() && work.kinds.none { "episode" in it || "season" in it } }
            .sortedWith(compareByDescending<Work> { it.year ?: 0 }.thenBy { it.name })
            .take(200)
        log.i { "Work for $wanted: ${works.size} titles" }
        val result = buildJsonObject {
            put("name", wanted)
            put("items", buildJsonArray {
                works.forEach { work ->
                    val series = work.kinds.any { kind -> listOf("series", "serial", "program", "show", "anime", "sitcom", "soap", "telenovela").any { it in kind } && "film" !in kind }
                    add(buildJsonObject {
                        put("id", work.imdb)
                        put("type", if (series) "series" else "movie")
                        put("name", work.name)
                        put("poster", "https://images.metahub.space/poster/medium/${work.imdb}/img")
                        work.year?.let { put("releaseInfo", it.toString()) }
                        put("role", when {
                            "director" in work.roles && work.roles.size == 1 -> "Director"
                            "voice" in work.roles && "cast" !in work.roles -> "Voice"
                            else -> ""
                        })
                    })
                }
            })
        }
        if (works.isNotEmpty()) cache[cacheKey] = result
        return result
    }
}

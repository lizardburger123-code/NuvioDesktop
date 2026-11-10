package com.nuvio.app.shell

import co.touchlab.kermit.Logger
import com.nuvio.app.core.storage.DesktopStorage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.time.LocalDate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * The anime catalog, from AniList: trending, this season, top airing, top rated, films, next
 * season and every season back to 1970. Each title is matched to its IMDb id (arm.haglund.dev),
 * so it opens, plays, resumes and counts towards trophies like any other film or series; the
 * few with no IMDb id use their Kitsu id. Kitsu's own rows leave Home once this has loaded
 * (they can be switched back on in Settings).
 */
internal object ShellAniList {
    private val log = Logger.withTag("ShellAniList")
    private const val Api = "https://graphql.anilist.co"
    private const val Arm = "https://arm.haglund.dev/api/v2/ids"
    private const val Art = "https://images.metahub.space"
    const val AddonId = "anilist"
    const val AddonName = "AniList"
    const val HomeKey = "anilist:home"
    private const val Logo = "https://anilist.co/img/icons/android-chrome-512x512.png"
    private const val PageSize = 30
    private const val RowSize = 24
    private const val FreshMs = 30 * 60_000L
    private const val RetryMs = 2 * 60_000L
    private const val UnknownRetryMs = 6 * 60 * 60_000L
    private const val PageCacheMs = 10 * 60_000L

    private const val Fields = "id format status seasonYear averageScore genres title{romaji english} " +
        "coverImage{extraLarge color} bannerImage description(asHtml:false) startDate{year} nextAiringEpisode{episode airingAt}"

    private val json = Json { ignoreUnknownKeys = true }
    private val http by lazy {
        OkHttpClient.Builder().connectTimeout(12, TimeUnit.SECONDS).readTimeout(25, TimeUnit.SECONDS).build()
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val store by lazy { DesktopStorage.store("nuvio_anilist") }

    // ---- Seasons ---------------------------------------------------------------------------

    private enum class Season(val label: String) { WINTER("Winter"), SPRING("Spring"), SUMMER("Summer"), FALL("Fall") }

    /** Anime seasons follow the broadcast quarters: Winter is January to March, and so on. */
    private data class Cour(val season: Season, val year: Int) {
        val label get() = "${season.label} $year"
        fun next() = if (season == Season.FALL) Cour(Season.WINTER, year + 1) else Cour(Season.entries[season.ordinal + 1], year)
    }

    private fun current(): Cour = LocalDate.now().let { Cour(Season.entries[(it.monthValue - 1) / 3], it.year) }

    // ---- The lists ---------------------------------------------------------------------------

    /** One AniList list: its query arguments (GraphQL literals) and the filters Discover offers. */
    private class Spec(val id: String, val title: String, val args: Map<String, String>, val filters: List<String>)

    private fun specs(): List<Spec> {
        val now = current()
        val next = now.next()
        return listOf(
            Spec("trending", "Trending now", mapOf("sort" to "[TRENDING_DESC]"), listOf("genre", "format", "year")),
            Spec("season", "Popular in ${now.label}", mapOf("season" to now.season.name, "seasonYear" to "${now.year}", "sort" to "[POPULARITY_DESC]"), listOf("genre", "format")),
            Spec("airing", "Top airing", mapOf("status" to "RELEASING", "sort" to "[SCORE_DESC]", "popularity_greater" to "20000"), listOf("genre", "format")),
            Spec("popular", "All-time popular", mapOf("sort" to "[POPULARITY_DESC]"), listOf("genre", "format", "year")),
            Spec("top", "Top rated", mapOf("sort" to "[SCORE_DESC]", "popularity_greater" to "10000"), listOf("genre", "format", "year")),
            Spec("films", "Top anime films", mapOf("format" to "MOVIE", "sort" to "[SCORE_DESC]", "popularity_greater" to "20000"), listOf("genre", "year")),
            Spec("next", "Coming in ${next.label}", mapOf("season" to next.season.name, "seasonYear" to "${next.year}", "sort" to "[POPULARITY_DESC]"), listOf("genre", "format")),
        )
    }

    /** Discover only: any season of any year (a * marks a filter that always has a value). */
    private fun seasonsSpec() = Spec("seasons", "By season", mapOf("sort" to "[POPULARITY_DESC]"), listOf("season*", "year*", "genre", "format"))

    private fun allSpecs() = specs() + seasonsSpec()

    private val genres = listOf(
        "Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", "Horror", "Mahou Shoujo", "Mecha", "Music",
        "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller",
    )
    private val formats = linkedMapOf("TV" to "TV", "Film" to "MOVIE", "ONA" to "ONA", "OVA" to "OVA", "Special" to "SPECIAL", "TV short" to "TV_SHORT")

    private fun options(filter: String, required: Boolean): List<String> = when (filter) {
        "genre" -> genres
        "format" -> formats.keys.toList()
        // A season that must be picked starts on this one; an optional year can reach next year.
        "season" -> current().season.let { now -> (0 until 4).map { Season.entries[(now.ordinal + it) % 4].label } }
        "year" -> (if (required) current().year else current().year + 1).downTo(1970).map { "$it" }
        else -> emptyList()
    }

    // ---- State -------------------------------------------------------------------------------

    data class State(
        val rows: List<JsonObject> = emptyList(),
        val loading: Boolean = false,
        val error: String? = null,
        val loadedAt: Long = 0L,
        val failedAt: Long = 0L,
        val hidden: Set<String> = emptySet(),
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()
    @Volatile private var restored = false

    /** Loads the lists the first time, and again once they're half an hour old. */
    fun refreshIfStale() {
        restore()
        val s = _state.value
        val now = System.currentTimeMillis()
        if (s.loading) return
        if (s.rows.isNotEmpty() && now - s.loadedAt < FreshMs) return
        if (now - s.failedAt < RetryMs) return
        _state.value = s.copy(loading = true)
        scope.launch { load() }
    }

    /** Last time's lists, so the Anime tab fills at once while fresh ones load. */
    @Synchronized private fun restore() {
        if (restored) return
        restored = true
        val hidden = store.getStringSet("hidden").orEmpty()
        val saved = runCatching {
            store.getString("rows_v1")?.let { json.parseToJsonElement(it) as? JsonObject }
        }.getOrNull()
        val rows = (saved?.get("rows") as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
        val at = (saved?.get("at") as? JsonPrimitive)?.longOrNull ?: 0L
        // Titles carrying an old season in their name ("Popular in Summer 2026") wait for the refresh.
        val stillCurrent = rows.any { it.str("title") == specs().first { spec -> spec.id == "season" }.title }
        _state.value = _state.value.copy(rows = if (stillCurrent) rows else emptyList(), loadedAt = if (stillCurrent) at else 0L, hidden = hidden)
    }

    private suspend fun load() {
        val specs = specs()
        val result = runCatching {
            val query = "query { " + specs.joinToString(" ") { spec ->
                "${spec.id}: Page(page:1, perPage:$RowSize){ media(${args(spec.args)}){ $Fields } }"
            } + " }"
            val data = graphql(query)
            val media = specs.associate { spec -> spec.id to mediaOf(data[spec.id]) }
            resolve(media.values.flatten().mapNotNull { it.long("id") })
            specs.mapNotNull { spec ->
                val items = distinct(media[spec.id].orEmpty().mapNotNull(::item))
                if (items.isEmpty()) null else section("anilist:${spec.id}", spec.title, "anilist|anime|${spec.id}", items)
            }
        }
        val now = System.currentTimeMillis()
        result.onSuccess { rows ->
            if (rows.isEmpty()) {
                _state.value = _state.value.copy(loading = false, error = "AniList sent no titles.", failedAt = now)
                return
            }
            _state.value = _state.value.copy(rows = rows, loading = false, error = null, loadedAt = now, failedAt = 0L)
            runCatching {
                store.putString("rows_v1", buildJsonObject { put("at", now); put("rows", JsonArray(rows)) }.toString())
            }
        }.onFailure { error ->
            log.w { "AniList lists failed: ${error.message}" }
            _state.value = _state.value.copy(loading = false, error = error.message ?: "Couldn't reach AniList.", failedAt = now)
        }
    }

    // ---- Home, Settings and the Anime tab ----------------------------------------------------

    /** The Anime tab's rows, minus the ones hidden in Settings. */
    fun rows(state: State = _state.value): List<JsonObject> = state.rows.filter { it.str("key") !in state.hidden }

    /** One row on Home: what's trending in anime. */
    fun homeRow(state: State = _state.value): JsonObject? {
        if (HomeKey in state.hidden) return null
        val trending = state.rows.firstOrNull { it.str("key") == "anilist:trending" } ?: return null
        return JsonObject(trending + mapOf("key" to JsonPrimitive(HomeKey), "title" to JsonPrimitive("Trending anime")))
    }

    /** For Settings › Home rows: key to title. */
    fun rowList(): List<Pair<String, String>> =
        listOf(HomeKey to "Trending anime (Home)") + specs().map { "anilist:${it.id}" to it.title }

    fun isHidden(key: String): Boolean {
        restore()
        return key in _state.value.hidden
    }

    fun setHidden(key: String, hidden: Boolean) {
        restore()
        val next = if (hidden) _state.value.hidden + key else _state.value.hidden - key
        store.putStringSet("hidden", next)
        _state.value = _state.value.copy(hidden = next)
    }

    // ---- Discover ----------------------------------------------------------------------------

    fun sources(): List<JsonObject> = allSpecs().map { spec ->
        buildJsonObject {
            put("id", "anilist|anime|${spec.id}")
            put("name", spec.title)
            put("addon", AddonName)
            put("addonId", AddonId)
            put("type", "anime")
            put("paged", true)
            put("searchable", true)
            put("searchOnly", false)
            put("filters", buildJsonArray {
                spec.filters.forEach { raw ->
                    val required = raw.endsWith("*")
                    val name = raw.removeSuffix("*")
                    add(buildJsonObject {
                        put("name", name)
                        put("required", required)
                        put("options", ShellJson.strings(options(name, required)))
                    })
                }
            })
        }
    }

    /** AniList as a catalog "addon" (Settings › Addons, and "See all" from its rows). */
    fun addon(): JsonObject = buildJsonObject {
        put("id", AddonId)
        put("name", AddonName)
        put("logo", Logo)
        put("description", "Built in. Anime from AniList: trending, this season, top rated, films and every season back to 1970.")
        put("types", ShellJson.strings(listOf("anime")))
        put("adult", false)
        put("catalogs", JsonArray(sources()))
    }

    private val pages = ConcurrentHashMap<String, Pair<Long, JsonObject>>()

    /** One page of a list, with Discover's filters (genre, format, year, season, search). */
    suspend fun page(listId: String, filters: Map<String, String>, skip: Int): JsonObject {
        val spec = allSpecs().firstOrNull { it.id == listId } ?: error("That AniList list is gone.")
        val args = spec.args.toMutableMap()
        filters["genre"]?.takeIf { it in genres }?.let { args["genre"] = quote(it) }
        filters["format"]?.let { formats[it] }?.let { args["format"] = it }
        filters["year"]?.toIntOrNull()?.takeIf { "seasonYear" !in spec.args }?.let { args["seasonYear"] = "$it" }
        filters["season"]?.let { label -> Season.entries.firstOrNull { it.label == label } }?.let { args["season"] = it.name }
        filters["search"]?.trim()?.takeIf { it.length > 1 }?.let {
            args["search"] = quote(it)
            args["sort"] = "[SEARCH_MATCH]"
            args.remove("popularity_greater")
        }
        if ("season" in args && "seasonYear" !in args) args["seasonYear"] = "${current().year}"
        val page = skip / PageSize + 1
        val key = "${args(args)}#$page"
        pages[key]?.let { (at, value) -> if (System.currentTimeMillis() - at < PageCacheMs) return value }
        val data = withContext(Dispatchers.IO) { graphql("query { p: Page(page:$page, perPage:$PageSize){ pageInfo{hasNextPage} media(${args(args)}){ $Fields } } }") }
        val pageObj = data["p"].obj()
        val media = mediaOf(pageObj)
        withContext(Dispatchers.IO) { resolve(media.mapNotNull { it.long("id") }) }
        val more = (pageObj["pageInfo"].obj()["hasNextPage"] as? JsonPrimitive)?.booleanOrNull == true
        val result = buildJsonObject {
            put("items", JsonArray(distinct(media.mapNotNull(::item))))
            put("next", if (more) skip + PageSize else -1)
        }
        pages[key] = System.currentTimeMillis() to result
        if (pages.size > 200) pages.keys.take(100).forEach { pages.remove(it) }
        return result
    }

    // ---- Search ------------------------------------------------------------------------------

    data class Found(val query: String, val section: JsonObject?)

    private val _found = MutableStateFlow(Found("", null))
    val found: StateFlow<Found> = _found.asStateFlow()
    private var searchJob: Job? = null

    /** Anime matches for the search screen, as one more section ("Anime · AniList"). */
    @Synchronized fun search(query: String) {
        searchJob?.cancel()
        val text = query.trim()
        if (text.length < 2) {
            _found.value = Found(text, null)
            return
        }
        searchJob = scope.launch {
            delay(250)
            val page = runCatching { page("popular", mapOf("search" to text), 0) }
                .onFailure { log.w { "AniList search failed: ${it.message}" } }
                .getOrNull()
            val items = (page?.get("items") as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
            _found.value = Found(text, if (items.isEmpty()) null else section("anilist:search", "Anime", null, items))
        }
    }

    // ---- AniList and the id matcher ----------------------------------------------------------

    private fun graphql(query: String): JsonObject {
        val body = buildJsonObject { put("query", query) }.toString().toRequestBody("application/json".toMediaType())
        val request = Request.Builder().url(Api).post(body).header("Accept", "application/json").build()
        http.newCall(request).execute().use { response ->
            if (response.code == 429) error("AniList is busy. Try again in a minute.")
            val text = response.body?.string().orEmpty()
            val root = runCatching { json.parseToJsonElement(text) as? JsonObject }.getOrNull()
                ?: error("AniList answered ${response.code}.")
            val data = root["data"] as? JsonObject
            if (data == null) {
                val message = ((root["errors"] as? JsonArray)?.firstOrNull() as? JsonObject)?.str("message")
                error(message?.let { "AniList: $it" } ?: "AniList answered ${response.code}.")
            }
            return data
        }
    }

    private fun mediaOf(page: JsonElement?): List<JsonObject> =
        (page.obj()["media"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }

    private data class Ids(val imdb: String?, val kitsu: Long?, val season: Int?)

    private val ids = ConcurrentHashMap<Long, Ids>()
    private val unknownAt = ConcurrentHashMap<Long, Long>()
    @Volatile private var idsLoaded = false

    @Synchronized private fun loadIds() {
        if (idsLoaded) return
        idsLoaded = true
        runCatching {
            val saved = store.getString("ids_v1")?.let { json.parseToJsonElement(it) as? JsonObject } ?: return
            saved.forEach { (key, value) ->
                val parts = (value as? JsonPrimitive)?.contentOrNull?.split("|") ?: return@forEach
                val id = key.toLongOrNull() ?: return@forEach
                ids[id] = Ids(parts.getOrNull(0)?.ifBlank { null }, parts.getOrNull(1)?.toLongOrNull(), parts.getOrNull(2)?.toIntOrNull())
            }
        }
    }

    private fun saveIds() {
        runCatching {
            val entries = ids.entries.toList().takeLast(8000)
            store.putString("ids_v1", buildJsonObject {
                entries.forEach { (id, v) -> put("$id", "${v.imdb.orEmpty()}|${v.kitsu ?: ""}|${v.season ?: ""}") }
            }.toString())
        }
    }

    /** Matches AniList ids to IMDb and Kitsu ids, 100 at a time; matches are kept on disk. */
    private suspend fun resolve(wanted: Collection<Long>) {
        loadIds()
        val now = System.currentTimeMillis()
        val missing = wanted.distinct().filter { id -> id !in ids && (unknownAt[id]?.let { now - it > UnknownRetryMs } ?: true) }
        if (missing.isEmpty()) return
        coroutineScope {
            missing.chunked(100).map { chunk ->
                async(Dispatchers.IO) { runCatching { fetchIds(chunk) }.onFailure { log.w { "ID match failed: ${it.message}" } } }
            }.awaitAll()
        }
        saveIds()
    }

    private fun fetchIds(chunk: List<Long>) {
        val body = buildJsonArray { chunk.forEach { add(buildJsonObject { put("anilist", it) }) } }
            .toString().toRequestBody("application/json".toMediaType())
        val request = Request.Builder().url(Arm).post(body).header("Accept", "application/json").build()
        val answers = http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("arm answered ${response.code}")
            json.parseToJsonElement(response.body?.string().orEmpty()) as? JsonArray ?: error("arm sent no list")
        }
        val byId = answers.mapNotNull { it as? JsonObject }.associateBy { it.long("anilist") }
        val now = System.currentTimeMillis()
        chunk.forEach { id ->
            val entry = byId[id]
            val imdb = entry?.str("imdb")?.takeIf { it.startsWith("tt") }
            val kitsu = entry?.long("kitsu")
            if (imdb == null && kitsu == null) {
                unknownAt[id] = now
            } else {
                val season = entry?.int("thetvdb-season") ?: entry?.int("themoviedb-season")
                ids[id] = Ids(imdb, kitsu, season)
            }
        }
    }

    // ---- Titles ------------------------------------------------------------------------------

    /** An AniList title as a catalog item (the same shape as an addon's), or null with no id match. */
    private fun item(media: JsonObject): JsonObject? {
        val anilistId = media.long("id") ?: return null
        val mapped = ids[anilistId] ?: return null
        val type = if (media.str("format") == "MOVIE") "movie" else "series"
        val id = mapped.imdb ?: mapped.kitsu?.let { "kitsu:$it" } ?: return null
        val title = media["title"].obj()
        val name = title.str("english")?.ifBlank { null } ?: title.str("romaji") ?: return null
        val cover = media["coverImage"].obj()
        val banner = media.str("bannerImage")
        return buildJsonObject {
            put("id", id)
            put("type", type)
            put("name", name)
            put("anilist", anilistId)
            cover.str("extraLarge")?.let { put("poster", it) }
            cover.str("color")?.let { put("color", it) }
            if (mapped.imdb != null) {
                // Full-size backdrops and title logos by IMDb id (what Cinemeta uses), with AniList's
                // own wide banner to fall back on.
                put("banner", "$Art/background/large/${mapped.imdb}/img")
                banner?.let { put("bannerAlt", it) }
                put("logo", "$Art/logo/medium/${mapped.imdb}/img")
            } else {
                banner?.let { put("banner", it) }
            }
            clean(media.str("description"))?.let { put("description", it) }
            (media.int("seasonYear") ?: media["startDate"].obj().int("year"))?.let { put("releaseInfo", "$it") }
            media.int("averageScore")?.let { put("score", it) }
            put("genres", buildJsonArray { (media["genres"] as? JsonArray).orEmpty().forEach { add(it) } })
            // A later season of a series opens on that season.
            if (type == "series" && mapped.imdb != null) mapped.season?.takeIf { it > 1 }?.let { put("season", it) }
            media["nextAiringEpisode"].obj().let { next ->
                val episode = next.int("episode")
                val at = next.long("airingAt")
                if (episode != null && at != null) {
                    put("nextEpisode", episode)
                    put("nextAt", at * 1000)
                }
            }
        }
    }

    /** Two seasons of one series share an IMDb id: the first (higher ranked) stays. */
    private fun distinct(items: List<JsonObject>): List<JsonObject> {
        val seen = HashSet<String>()
        return items.filter { seen.add("${it.str("type")}:${it.str("id")}") }
    }

    private fun section(key: String, title: String, source: String?, items: List<JsonObject>): JsonObject = buildJsonObject {
        put("key", key)
        put("title", title)
        put("subtitle", "")
        put("addonName", AddonName)
        put("type", "anime")
        put("kind", "anime")
        put("hasMore", source != null)
        source?.let { put("source", it) }
        put("items", JsonArray(items))
    }

    private val tags = Regex("<[^>]+>")
    private val sourceNote = Regex("\\((Source|Sources):[^)]*\\)", RegexOption.IGNORE_CASE)

    /** AniList's synopsis without its markup, source credits and broadcast notes. */
    private fun clean(text: String?): String? {
        if (text.isNullOrBlank()) return null
        val plain = text
            .replace(Regex("<br\\s*/?>", RegexOption.IGNORE_CASE), "\n")
            .substringBefore("<i>Note:")
            .replace(tags, "")
            .replace(sourceNote, "")
            .replace("&quot;", "\"").replace("&amp;", "&").replace("&#039;", "'").replace("&lt;", "<").replace("&gt;", ">")
            .lines().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("Note:", true) }
            .joinToString("\n\n")
            .trim()
        return plain.ifBlank { null }
    }

    private fun args(map: Map<String, String>) =
        (listOf("type:ANIME", "isAdult:false") + map.map { (k, v) -> "$k:$v" }).joinToString(", ")

    private fun quote(value: String) = JsonPrimitive(value).toString()

    private fun JsonElement?.obj(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
    private fun JsonObject.int(key: String): Int? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.intOrNull
    private fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.longOrNull
}

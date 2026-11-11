package com.nuvio.app.shell

import co.touchlab.kermit.Logger
import com.nuvio.app.core.storage.DesktopStorage
import com.nuvio.app.features.details.MetaDetails
import com.nuvio.app.features.details.MetaDetailsRepository
import com.nuvio.app.features.watched.WatchedRepository
import com.nuvio.app.features.watched.episodePlaybackId
import com.nuvio.app.features.watched.isEpisode
import com.nuvio.app.features.watchprogress.WatchProgressRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.LocalDate

/**
 * Season finishes, for the trophy pop-up: when the last unwatched episode of a season is watched
 * (in the player, or marked by hand), the season is announced once. Episodes that arrive in bulk
 * from a sync, or that were watched long ago, never announce anything.
 */
internal object ShellSeasons {
    private val log = Logger.withTag("ShellSeasons")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val store by lazy { DesktopStorage.store("nuvio_shell") }
    private const val RecentMs = 15 * 60_000L
    private const val MetaCacheMs = 10 * 60_000L

    private val _events = MutableStateFlow<List<JsonObject>>(emptyList())
    val events: StateFlow<List<JsonObject>> = _events.asStateFlow()

    @Volatile private var started = false
    private val seen = HashSet<String>()
    private val metas = HashMap<String, Pair<Long, MetaDetails>>()

    /** "seriesId:season" pairs already announced (kept across restarts). */
    private val announced: MutableSet<String> by lazy { store.getStringSet("seasons_announced").orEmpty().toMutableSet() }

    @Synchronized fun start() {
        if (started) return
        started = true
        WatchedRepository.ensureLoaded()
        WatchProgressRepository.ensureLoaded()
        scope.launch {
            var first = true
            combine(WatchedRepository.uiState, WatchProgressRepository.uiState) { watched, progress -> watched to progress }.collect { (watched, progress) ->
                // Each finished episode, from either record, as series id + season + episode.
                val now = System.currentTimeMillis()
                val finished = buildList {
                    watched.items.filter { it.isEpisode && (it.season ?: 0) > 0 }.forEach {
                        add(Triple("${it.id}:${it.season}:${it.episode}", it.markedAtEpochMs, Triple(it.id, it.type, it.season!!)))
                    }
                    progress.entries.filter { it.isEpisode && it.isEffectivelyCompleted && (it.seasonNumber ?: 0) > 0 }.forEach {
                        add(Triple("${it.parentMetaId}:${it.seasonNumber}:${it.episodeNumber}", it.lastUpdatedEpochMs, Triple(it.parentMetaId, it.parentMetaType, it.seasonNumber!!)))
                    }
                }
                val fresh = finished.filter { (key, _, _) -> seen.add(key) }
                if (first) {
                    first = false
                    return@collect
                }
                // A sync can bring hundreds of old episodes at once: only a few recent ones count.
                val candidates = fresh.filter { (_, at, _) -> now - at < RecentMs }.map { it.third }.distinct()
                if (candidates.isEmpty() || candidates.size > 6) return@collect
                candidates.forEach { (id, type, season) -> scope.launch { check(id, type, season) } }
            }
        }
    }

    private suspend fun check(id: String, type: String, season: Int) {
        val key = "$id:$season"
        if (key in announced) return
        // Let the watched record settle (the player marks the episode and saves progress separately).
        delay(1500)
        val meta = meta(type, id) ?: return
        val today = LocalDate.now().toString()
        val episodes = meta.videos.filter { it.season == season && it.episode != null }
            .filter { video -> video.released?.take(10)?.let { it <= today } ?: true }
            .distinctBy { it.episode }
        if (episodes.size < 2) return
        val progress = WatchProgressRepository.uiState.value.entries
            .filter { it.parentMetaId == id && it.isEffectivelyCompleted }
            .map { it.videoId }.toSet()
        val allSeen = episodes.all { video ->
            runCatching { WatchedRepository.isWatched(meta.id, meta.type, video.season, video.episode) }.getOrDefault(false) ||
                runCatching { meta.episodePlaybackId(video) in progress }.getOrDefault(false) ||
                video.id in progress
        }
        if (!allSeen) return
        synchronized(this) {
            if (!announced.add(key)) return
            store.putStringSet("seasons_announced", announced.toSet())
        }
        val lastSeason = meta.videos.mapNotNull { it.season }.filter { it > 0 }.maxOrNull()
        val event = buildJsonObject {
            put("key", key)
            put("id", meta.id)
            put("type", meta.type)
            put("name", meta.name)
            meta.poster?.let { put("poster", it) }
            put("season", season)
            put("episodes", episodes.size)
            put("final", lastSeason == season)
            put("at", System.currentTimeMillis())
        }
        log.i { "Season complete: ${meta.name} S$season" }
        _events.value = (listOf(event) + _events.value).take(20)
    }

    private suspend fun meta(type: String, id: String): MetaDetails? {
        synchronized(metas) {
            metas[id]?.let { (at, meta) -> if (System.currentTimeMillis() - at < MetaCacheMs) return meta }
        }
        val meta = runCatching { MetaDetailsRepository.fetch(type = if (type == "anime") "series" else type, id = id, cacheResult = false) }
            .onFailure { log.w { "No episodes for $id: ${it.message}" } }
            .getOrNull() ?: return null
        synchronized(metas) { metas[id] = System.currentTimeMillis() to meta }
        return meta
    }

    fun json(): JsonArray = JsonArray(_events.value)
}

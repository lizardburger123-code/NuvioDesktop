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
 *
 * A season is only finished once it has finished coming out: being caught up with a season that
 * is still airing announces nothing (see ShellAiring). Such a season waits, and is announced when
 * it turns out to be over.
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

    /** "type|seriesId|season": all aired episodes seen, but the season is still coming out. */
    private val waiting: MutableSet<String> by lazy { store.getStringSet("seasons_waiting").orEmpty().toMutableSet() }

    /** A season announced while it was still airing (an earlier version did that) is taken back. */
    private fun takeBack(id: String, season: Int) {
        synchronized(this) {
            if (!announced.remove("$id:$season")) return
            store.putStringSet("seasons_announced", announced.toSet())
        }
        log.i { "Season $season of $id is still airing: its trophy is taken back" }
        _events.value = _events.value.filterNot { it["key"]?.toString()?.trim('"') == "$id:$season" }
    }

    @Synchronized fun start() {
        if (started) return
        started = true
        ShellAiring.onStillAiring = ::takeBack
        // Seasons that were waiting for their run to end: look again a little after launch.
        scope.launch {
            delay(20_000)
            val pending = synchronized(this@ShellSeasons) { waiting.toList() }
            pending.forEach { line ->
                val parts = line.split('|')
                val season = parts.getOrNull(2)?.toIntOrNull()
                if (parts.size == 3 && season != null) check(parts[1], parts[0], season)
            }
        }
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
        // Let the watched record settle (the player marks the episode and saves progress separately).
        delay(1500)
        val meta = meta(type, id) ?: return
        val today = LocalDate.now().toString()
        val listed = meta.videos.filter { it.season == season && it.episode != null }.distinctBy { it.episode }
        val episodes = listed.filter { video -> video.available != false && (video.released?.take(10)?.let { it <= today } ?: true) }
        if (episodes.size < 2) return
        // More of this season is still to come: an episode is listed that hasn't aired, or this is
        // the latest season of a series that is still airing.
        val lastSeason = meta.videos.mapNotNull { it.season }.filter { it > 0 }.maxOrNull()
        val stillComing = episodes.size < listed.size || (season == lastSeason && ShellAiring.note(meta, id))
        val waitKey = "$type|$id|$season"
        // Announced while it was still airing (an earlier version did that): taken back, so the
        // season can be earned for real when it ends.
        if (stillComing) takeBack(id, season)
        if (key in announced) return
        val progress = WatchProgressRepository.uiState.value.entries
            .filter { it.parentMetaId == id && it.isEffectivelyCompleted }
            .map { it.videoId }.toSet()
        val allSeen = episodes.all { video ->
            runCatching { WatchedRepository.isWatched(meta.id, meta.type, video.season, video.episode) }.getOrDefault(false) ||
                runCatching { meta.episodePlaybackId(video) in progress }.getOrDefault(false) ||
                video.id in progress
        }
        if (!allSeen || stillComing) {
            // Caught up with a season that isn't over: remember it, and look again later.
            synchronized(this) {
                val changed = if (allSeen && stillComing) waiting.add(waitKey) else waiting.remove(waitKey)
                if (changed) store.putStringSet("seasons_waiting", waiting.toSet())
            }
            return
        }
        synchronized(this) {
            if (waiting.remove(waitKey)) store.putStringSet("seasons_waiting", waiting.toSet())
            if (!announced.add(key)) return
            store.putStringSet("seasons_announced", announced.toSet())
        }
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

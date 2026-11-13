package com.nuvio.app.shell

import co.touchlab.kermit.Logger
import com.nuvio.app.core.storage.DesktopStorage
import com.nuvio.app.features.details.MetaDetails
import com.nuvio.app.features.details.MetaDetailsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Whether a series is still coming out. Being caught up with a show is not finishing it: a series
 * (or its latest season) only becomes a trophy once it has stopped airing.
 *
 * A series counts as still airing when an episode is listed that hasn't aired yet, or when its
 * latest season is coming out in parts (weekly, twice a week, daily) and the last episode is
 * recent (the next one is often not listed until it airs). A series marked ended, cancelled or
 * finished is over.
 *
 * Verdicts are kept between launches and looked at again after a few days.
 */
internal object ShellAiring {
    data class State(val ongoing: Set<String> = emptySet(), val known: Set<String> = emptySet())

    private val log = Logger.withTag("ShellAiring")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val store by lazy { DesktopStorage.store("nuvio_shell") }
    private val gate = Semaphore(3)
    private const val Key = "airing_verdicts"
    private const val OngoingRecheckDays = 2L
    private const val EndedRecheckDays = 45L

    /** id -> (still airing, day checked). */
    private val verdicts = HashMap<String, Pair<Boolean, Long>>()
    private val inFlight = HashSet<String>()
    @Volatile private var loaded = false

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    /** Called with a series' id and its latest season when a fresh look finds it still airing. */
    @Volatile var onStillAiring: ((id: String, lastSeason: Int) -> Unit)? = null

    private fun today(): Long = LocalDate.now().toEpochDay()

    @Synchronized private fun ensureLoaded() {
        if (loaded) return
        loaded = true
        store.getStringSet(Key).orEmpty().forEach { line ->
            val parts = line.split('|')
            if (parts.size == 3) parts[2].toLongOrNull()?.let { day -> verdicts[parts[0]] = (parts[1] == "o") to day }
        }
        publish()
    }

    @Synchronized private fun publish() {
        _state.value = State(
            ongoing = verdicts.filterValues { it.first }.keys.toSet(),
            known = verdicts.keys.toSet(),
        )
    }

    @Synchronized private fun record(id: String, ongoing: Boolean) {
        verdicts[id] = ongoing to today()
        store.putStringSet(Key, verdicts.map { (key, value) -> "$key|${if (value.first) "o" else "e"}|${value.second}" }.toSet())
        publish()
    }

    @Synchronized private fun due(id: String): Boolean {
        val verdict = verdicts[id] ?: return true
        val age = today() - verdict.second
        return age >= if (verdict.first) OngoingRecheckDays else EndedRecheckDays
    }

    /** Look at these series (ids), a few at a time, unless they were looked at recently. */
    fun review(ids: Collection<String>) {
        ensureLoaded()
        ids.distinct().forEach { id ->
            val start = synchronized(this) { due(id) && inFlight.add(id) }
            if (!start) return@forEach
            scope.launch {
                try {
                    gate.withPermit {
                        val meta = runCatching { MetaDetailsRepository.fetch(type = "series", id = id, cacheResult = false) }
                            .onFailure { log.d { "No episodes for $id: ${it.message}" } }
                            .getOrNull() ?: return@withPermit
                        note(meta, id)
                    }
                } finally {
                    synchronized(this@ShellAiring) { inFlight.remove(id) }
                }
            }
        }
    }

    /** A verdict from details that are already in hand. Returns whether the series is still airing. */
    fun note(meta: MetaDetails, id: String = meta.id): Boolean {
        ensureLoaded()
        val ongoing = stillAiring(meta)
        record(id, ongoing)
        if (ongoing) {
            meta.videos.mapNotNull { it.season }.filter { it > 0 }.maxOrNull()?.let { last ->
                runCatching { onStillAiring?.invoke(id, last) }
            }
        }
        return ongoing
    }

    private fun dateOf(released: String?): LocalDate? =
        released?.take(10)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }

    fun stillAiring(meta: MetaDetails, today: LocalDate = LocalDate.now()): Boolean {
        val episodes = meta.videos.filter { (it.season ?: 0) > 0 && it.episode != null }
        if (episodes.isEmpty()) return false
        // An episode that is listed but not out yet.
        if (episodes.any { video -> video.available == false || dateOf(video.released)?.isAfter(today) == true }) return true
        val status = meta.status.orEmpty().lowercase()
        // Anime catalogs say "Finished Airing" or "finished" where others say "Ended".
        if ("ended" in status || "cancel" in status || "finished" in status) return false
        // Nothing upcoming is listed. A season coming out in parts often gets its next episode
        // listed late, so a recent episode still means "more to come". Recent is three weeks:
        // a weekly show can skip a week or two (a holiday, a sports broadcast).
        val lastSeason = episodes.maxOf { it.season ?: 0 }
        val inSeason = episodes.filter { it.season == lastSeason }
        val dates = inSeason.mapNotNull { dateOf(it.released) }.distinct().sorted()
        val last = dates.lastOrNull() ?: return false
        if (ChronoUnit.DAYS.between(last, today) > 21) return false
        // Weekly, twice a week (two nights in a row) or daily: the latest two air dates are close.
        val inParts = dates.size >= 2 && ChronoUnit.DAYS.between(dates[dates.size - 2], last) in 1..9
        // A premiere: up to three episodes on a single day (a whole season at once is more).
        val premiere = dates.size == 1 && inSeason.size <= 3
        return inParts || premiere
    }
}

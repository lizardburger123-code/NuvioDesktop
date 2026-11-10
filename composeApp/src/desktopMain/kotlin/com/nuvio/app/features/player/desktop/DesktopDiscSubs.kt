package com.nuvio.app.features.player.desktop

import com.nuvio.app.features.streams.StreamItem
import java.util.Locale

/**
 * "From the disc" in the player's Subtitles menu: the official subtitles from a Blu-ray (PGS),
 * found inside another source of the same title and copied onto the film that's playing.
 */
internal object DesktopDiscSubsUi {
    class Item(val stream: StreamItem, val title: String, val detail: String, val trackName: String?)

    /** idle | searching | ready | applying | applied | error */
    @Volatile var status: String = "idle"
        private set
    @Volatile var message: String = ""
        private set
    @Volatile var language: String = "ar"
        private set
    @Volatile var items: List<Item> = emptyList()
        private set
    @Volatile var checked: Int = 0
        private set
    @Volatile var toCheck: Int = 0
        private set
    @Volatile var applyingIndex: Int = -1
        private set
    @Volatile var appliedIndex: Int = -1
        private set
    @Volatile var progressDone: Int = 0
        private set
    @Volatile var progressTotal: Int = 0
        private set
    /** Changes when the video changes, so the page searches again on its first visit. */
    @Volatile var videoKey: String = ""
        private set

    @Synchronized fun forVideo(key: String) {
        if (key == videoKey) return
        videoKey = key
        status = "idle"; message = ""; items = emptyList(); checked = 0; toCheck = 0
        applyingIndex = -1; appliedIndex = -1; progressDone = 0; progressTotal = 0
    }

    @Synchronized fun beginSearch(language: String) {
        this.language = language
        status = "searching"; message = ""; items = emptyList(); checked = 0; toCheck = 0
        applyingIndex = -1; appliedIndex = -1
    }

    @Synchronized fun checking(count: Int) { toCheck = count; checked = 0 }
    @Synchronized fun oneChecked() { checked += 1 }

    @Synchronized fun finish(found: List<Item>, note: String) {
        items = found
        status = if (found.isEmpty()) "error" else "ready"
        message = note
    }

    @Synchronized fun fail(note: String) { status = "error"; message = note }

    @Synchronized fun beginApply(index: Int) {
        status = "applying"; applyingIndex = index; progressDone = 0; progressTotal = 0; message = ""
    }

    @Synchronized fun progress(done: Int, total: Int) { progressDone = done; progressTotal = total }

    @Synchronized fun applied(index: Int, note: String) {
        status = "applied"; appliedIndex = index; applyingIndex = -1; message = note
    }

    @Synchronized fun applyFailed(note: String) {
        status = "ready"; applyingIndex = -1; message = note
    }

    fun languageName(code: String = language): String = when (code) {
        "ar" -> "Arabic"
        "en" -> "English"
        else -> Locale.forLanguageTag(code).getDisplayLanguage(Locale.ENGLISH).ifBlank { code.uppercase(Locale.ROOT) }
    }
}

/** Lines up a disc subtitle's timing with the file that's playing, from when their lines start. */
internal object DiscTiming {
    class Fit(val delayMs: Int, val matched: Int, val ratio: Double)

    /**
     * The constant shift that makes the disc's line starts [disc] meet the playing file's
     * subtitle starts [reference], or null when no shift fits well enough to trust.
     */
    fun fit(disc: List<Long>, reference: List<Long>, maxShiftMs: Long = 120_000L): Fit? {
        if (disc.size < 20 || reference.size < 20) return null
        val ref = reference.sorted().toLongArray()
        val votes = HashMap<Long, Int>()
        disc.forEach { time ->
            var index = lowerBound(ref, time - maxShiftMs)
            while (index < ref.size && ref[index] <= time + maxShiftMs) {
                val bin = Math.floorDiv(ref[index] - time, 100L)
                votes[bin] = (votes[bin] ?: 0) + 1
                index++
            }
        }
        val best = votes.keys.maxByOrNull { bin -> (votes[bin] ?: 0) + (votes[bin - 1] ?: 0) + (votes[bin + 1] ?: 0) } ?: return null
        val guess = best * 100L + 50L
        val diffs = mutableListOf<Long>()
        disc.forEach { time ->
            val target = time + guess
            val index = lowerBound(ref, target - 300L)
            var nearest: Long? = null
            var i = index
            while (i < ref.size && ref[i] <= target + 300L) {
                if (nearest == null || kotlin.math.abs(ref[i] - target) < kotlin.math.abs(nearest - target)) nearest = ref[i]
                i++
            }
            nearest?.let { diffs += it - time }
        }
        val ratio = diffs.size.toDouble() / minOf(disc.size, ref.size)
        if (diffs.size < 15 || ratio < 0.25) return null
        val median = diffs.sorted()[diffs.size / 2]
        return Fit(median.toInt(), diffs.size, ratio)
    }

    private fun lowerBound(values: LongArray, target: Long): Int {
        var low = 0
        var high = values.size
        while (low < high) {
            val mid = (low + high) ushr 1
            if (values[mid] < target) low = mid + 1 else high = mid
        }
        return low
    }
}

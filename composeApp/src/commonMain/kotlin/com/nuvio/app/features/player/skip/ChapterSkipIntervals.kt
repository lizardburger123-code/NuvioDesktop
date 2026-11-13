package com.nuvio.app.features.player.skip

import com.nuvio.app.features.player.PlayerChapter

/*
 * Skip segments read from the playing file's own chapters.
 *
 * Online skip data is timed against whichever copy its contributor watched and is sometimes
 * simply wrong (an opening filed at 0:00 for an episode that starts with a scene). Chapters are
 * part of this exact file, so when they name the opening or the ending they win.
 */

private val OpeningTitle = Regex("""\b(opening|op\s?\d*|ncop\d*|theme song|title sequence)\b|オープニング""", RegexOption.IGNORE_CASE)
private val IntroTitle = Regex("""\bintro(duction)?\b""", RegexOption.IGNORE_CASE)
private val EndingTitle = Regex("""\b(ending|ed\s?\d*|nced\d*|end credits|credits|outro)\b|エンディング""", RegexOption.IGNORE_CASE)
private val RecapTitle = Regex("""\b(recap|previously)\b""", RegexOption.IGNORE_CASE)
/** "Opening Scene", "Post-Credits Scene": part of the story next to the titles, never skipped. */
private val SceneTitle = Regex("""\bscenes?\b|\b(mid|post|after)[\s-]*(the[\s-]*)?credits?\b""", RegexOption.IGNORE_CASE)
private val GenericTitle = Regex("""^\s*(chapter|chapitre|kapitel|cap[ií]tulo|part)?\s*#?\d{0,3}\s*$""", RegexOption.IGNORE_CASE)

/** A TV-size anime opening or ending runs a minute and a half. */
private val ThemeLength = 86.0..94.0

internal const val CHAPTER_PROVIDER = "chapters"

internal fun chapterSkipIntervals(chapters: List<PlayerChapter>, durationSec: Double): List<SkipInterval> {
    if (chapters.size < 2 || !durationSec.isFinite() || durationSec < 120.0) return emptyList()
    val sorted = chapters.filter { it.startSec.isFinite() && it.startSec >= 0.0 && it.startSec < durationSec }
        .sortedBy { it.startSec }
    if (sorted.size < 2) return emptyList()

    data class Span(val title: String, val start: Double, val end: Double) {
        val length get() = end - start
    }
    val spans = sorted.mapIndexed { index, chapter ->
        Span(chapter.title.trim(), chapter.startSec, sorted.getOrNull(index + 1)?.startSec ?: durationSec)
    }.filter { it.length > 1.0 }

    fun Span.interval(type: String) = SkipInterval(start, end, type, CHAPTER_PROVIDER)

    val named = spans.any { it.title.isNotEmpty() && !GenericTitle.matches(it.title) }
    if (named) {
        // "Intro" is the opening in some files and the scene before it in others: it only counts
        // when nothing else is called the opening and it is as long as an opening is.
        val opening = spans.firstOrNull { OpeningTitle.containsMatchIn(it.title) && !SceneTitle.containsMatchIn(it.title) && it.length in 20.0..200.0 }
            ?: spans.firstOrNull { IntroTitle.containsMatchIn(it.title) && !SceneTitle.containsMatchIn(it.title) && it.length in ThemeLength }
        val ending = spans.lastOrNull {
            it !== opening && EndingTitle.containsMatchIn(it.title) && !SceneTitle.containsMatchIn(it.title) &&
                it.length in 20.0..400.0 && it.start > durationSec * 0.5
        }
        val recap = spans.firstOrNull {
            it !== opening && RecapTitle.containsMatchIn(it.title) && it.length in 10.0..300.0 &&
                it.start < durationSec * 0.4
        }
        return listOfNotNull(recap?.interval("recap"), opening?.interval("op"), ending?.interval("ed"))
    }

    // Unnamed chapters still mark where each part begins; a part exactly as long as a theme
    // song, where a theme song goes, is one. Both have to be there: a single part of that length
    // could as well be a cold open, which must never be skipped.
    if (spans.size < 4) return emptyList()
    val opening = spans.firstOrNull { it.length in ThemeLength && it.start < durationSec * 0.35 } ?: return emptyList()
    val ending = spans.lastOrNull { it !== opening && it.length in ThemeLength && it.start > durationSec * 0.6 } ?: return emptyList()
    return listOf(opening.interval("op"), ending.interval("ed"))
}

internal fun skipSegmentCategory(type: String): String? = when (type.trim().lowercase()) {
    "intro", "op", "mixed-op" -> "opening"
    "outro", "ed", "mixed-ed", "credits", "ending" -> "ending"
    "recap" -> "recap"
    else -> null
}

/** The file's chapters replace online timings for the same kind of segment; the rest stay. */
internal fun mergeChapterSkipIntervals(
    fromChapters: List<SkipInterval>,
    online: List<SkipInterval>,
): List<SkipInterval> {
    if (fromChapters.isEmpty()) return online
    val covered = fromChapters.mapNotNull { skipSegmentCategory(it.type) }.toSet()
    return fromChapters + online.filter { skipSegmentCategory(it.type)?.let { category -> category !in covered } ?: true }
}

/**
 * Whether an online segment could be what it claims. Anime openings and endings are theme songs:
 * one filed as a few seconds long, or as most of the episode, is a mistake in the data.
 */
internal fun SkipInterval.isPlausible(anime: Boolean): Boolean {
    if (!startTime.isFinite() || startTime < 0.0) return false
    val category = skipSegmentCategory(type) ?: return true
    // Open-ended segments (no end known) are handled where they are used.
    if (!endTime.isFinite() || endTime >= Double.MAX_VALUE / 2) return true
    val length = endTime - startTime
    if (length < 3.0) return false
    return when {
        anime && category == "opening" -> length in 25.0..200.0
        anime && category == "ending" -> length in 25.0..400.0
        else -> true
    }
}

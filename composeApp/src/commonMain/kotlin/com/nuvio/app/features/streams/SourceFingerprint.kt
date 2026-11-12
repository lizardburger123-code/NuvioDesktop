package com.nuvio.app.features.streams

/*
 * What makes two files "the same source" across episodes: who released it and how it looks.
 * Addons name the same release differently per episode, so this reads the traits out of the text.
 */

internal data class SourceFingerprint(
    val addon: String,
    /** Release group, lower-cased; empty when the text doesn't name one. */
    val group: String,
    val quality: String,
    /** remux, bluray, web or empty. */
    val origin: String,
    /** dv, hdr, dv+hdr or empty. */
    val range: String,
    /** hevc, av1, avc or empty. */
    val codec: String,
    val sizeBytes: Long,
)

internal enum class SourceMatch { NONE, CLOSE, SAME }

private val VideoExtension = Regex("""\.(mkv|mp4|avi|m4v|ts|webm)$""", RegexOption.IGNORE_CASE)
private val LeadingGroup = Regex("""^\[([^\[\]]{2,32})]""")
private val TrailingGroup = Regex("""-\s?([A-Za-z0-9][A-Za-z0-9_]{1,24})(?:\s*[\[(][^\[\]()]*[\])])*$""")
private val GroupName = Regex("""^[a-z0-9][a-z0-9 _.\-]{1,31}$""")
private val LooksLikeRelease = Regex("""\b(2160p|1080p|720p|480p|web-?dl|webrip|blu-?ray|bdrip|remux|x26[45]|hevc)\b""", RegexOption.IGNORE_CASE)
private val NotAGroup = setOf(
    "dl", "rip", "web", "webdl", "webrip", "bluray", "bdrip", "brrip", "remux", "raw", "hd", "sd", "uhd",
    "x264", "x265", "h264", "h265", "264", "265", "hevc", "avc", "av1", "aac", "ac3", "eac3", "dts", "ma",
    "flac", "opus", "hdr", "hdr10", "dv", "10bit", "8bit", "multi", "dual", "sub", "subs", "dub", "dubbed",
    "1080p", "720p", "2160p", "480p", "4k", "imax", "proper", "repack", "mkv", "mp4",
    "rd", "tb", "ad", "pm", "oc", "dl", "ed", "p2p", "cached", "uncached", "torbox", "realdebrid", "instant",
)

private fun groupIn(line: String): String? {
    val text = line.trim().dropWhile { !it.isLetterOrDigit() && it != '[' }.replace(VideoExtension, "").trim()
    if (text.isEmpty()) return null
    fun String.asGroup(): String? = trim().lowercase()
        .takeIf { GroupName.matches(it) && it.any(Char::isLetter) && it !in NotAGroup }
    LeadingGroup.find(text)?.groupValues?.get(1)?.asGroup()?.let { return it }
    return TrailingGroup.find(text)?.groupValues?.get(1)?.asGroup()
}

internal fun sourceFingerprint(
    addon: String,
    filename: String?,
    texts: List<String?>,
    sizeBytes: Long? = null,
): SourceFingerprint {
    val lines = texts.filterNotNull().flatMap { it.lines() }.map(String::trim).filter(String::isNotEmpty)
    val all = (listOfNotNull(filename) + lines).joinToString(" \n ")
    fun has(pattern: String) = Regex(pattern, RegexOption.IGNORE_CASE).containsMatchIn(all)

    val group = filename?.let(::groupIn)
        ?: lines.firstNotNullOfOrNull { line ->
            if (VideoExtension.containsMatchIn(line) || LooksLikeRelease.containsMatchIn(line)) groupIn(line) else null
        }
    val dolbyVision = has("""\bdv\b|dolby.?vision|\bdovi\b""")
    val hdr = has("""hdr10\+|\bhdr(10)?\b""")
    return SourceFingerprint(
        addon = addon.trim().lowercase(),
        group = group.orEmpty(),
        quality = when {
            has("""2160p|\b4k\b|uhd""") -> "4K"
            has("1080p") -> "1080p"
            has("720p") -> "720p"
            has("""480p|\bsd\b""") -> "SD"
            else -> ""
        },
        origin = when {
            has("remux") -> "remux"
            has("""blu-?ray|bdrip|brrip""") -> "bluray"
            has("""web-?dl|webrip|\bweb\b""") -> "web"
            else -> ""
        },
        range = listOfNotNull("dv".takeIf { dolbyVision }, "hdr".takeIf { hdr }).joinToString("+"),
        codec = when {
            has("""hevc|x265|h\.?265""") -> "hevc"
            has("""\bav1\b""") -> "av1"
            has("""x264|h\.?264|\bavc\b""") -> "avc"
            else -> ""
        },
        sizeBytes = sizeBytes ?: 0L,
    )
}

internal fun StreamItem.sourceFingerprint(): SourceFingerprint = sourceFingerprint(
    addon = addonName,
    filename = behaviorHints.filename,
    texts = listOf(name, title, description),
    sizeBytes = behaviorHints.videoSize,
)

/**
 * SAME: the same release group at the same quality and dynamic range. CLOSE: no group to go by,
 * but the same addon offers a file that agrees on everything that is known.
 */
internal fun SourceFingerprint.matchWith(other: SourceFingerprint): SourceMatch {
    val sameLook = quality.isNotEmpty() && quality == other.quality && range == other.range
    if (!sameLook) return SourceMatch.NONE
    if (group.isNotEmpty() && group == other.group) return SourceMatch.SAME
    if (group.isNotEmpty() && other.group.isNotEmpty()) return SourceMatch.NONE
    return if (origin == other.origin && codec == other.codec && addon == other.addon) SourceMatch.CLOSE else SourceMatch.NONE
}

private fun SourceFingerprint.closeness(other: SourceFingerprint): Int {
    var points = 0
    if (addon == other.addon) points += 4
    if (origin == other.origin) points += 2
    if (codec == other.codec) points += 2
    if (sizeBytes > 0L && other.sizeBytes > 0L) {
        val ratio = other.sizeBytes.toDouble() / sizeBytes.toDouble()
        if (ratio in 0.7..1.4) points += 2 else if (ratio in 0.5..2.0) points += 1
    }
    return points
}

/**
 * The stream that continues [current]: the same binge group when the addon declares one,
 * otherwise the nearest SAME match, otherwise the nearest CLOSE one. [usable] leaves out
 * streams that can't be played right now.
 */
internal fun List<StreamItem>.sourceMatching(
    current: SourceFingerprint?,
    bingeGroup: String?,
    usable: (StreamItem) -> Boolean = { true },
): Pair<StreamItem, SourceMatch>? {
    val wantedGroup = bingeGroup?.trim().orEmpty()
    if (wantedGroup.isNotEmpty()) {
        firstOrNull { it.behaviorHints.bingeGroup == wantedGroup && usable(it) }?.let { return it to SourceMatch.SAME }
    }
    if (current == null) return null
    var best: Pair<StreamItem, SourceMatch>? = null
    var bestPoints = -1
    for (stream in this) {
        if (!usable(stream)) continue
        val candidate = stream.sourceFingerprint()
        val level = current.matchWith(candidate)
        if (level == SourceMatch.NONE) continue
        val points = level.ordinal * 100 + current.closeness(candidate)
        if (points > bestPoints) {
            bestPoints = points
            best = stream to level
        }
    }
    return best
}

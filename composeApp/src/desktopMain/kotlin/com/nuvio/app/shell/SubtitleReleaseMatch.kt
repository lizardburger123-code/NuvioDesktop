package com.nuvio.app.shell

import java.util.Locale

/**
 * How well a subtitle's release name fits the video file being played. Subtitles are timed to a
 * specific release: the same group and source (BluRay, WEB-DL, HDTV) almost always line up, a
 * different source usually drifts. Returns 0..1.
 */
internal object SubtitleReleaseMatch {
    data class Release(
        val group: String?,
        val source: String?,
        val platform: String?,
        val resolution: String?,
        val tokens: Set<String>,
        val season: Int?,
        val episode: Int?,
    )

    private val extension = Regex("\\.(mkv|mp4|avi|m4v|ts|mov|wmv|webm|srt|ass|ssa|vtt|sub|zip)$", RegexOption.IGNORE_CASE)
    private val groupPattern = Regex("-([A-Za-z0-9]{2,})(?:\\s*\\[[^\\]]*\\])?\\s*$")
    private val episodeCode = Regex("s(\\d{1,2})[ ._-]?e(\\d{1,3})|(\\d{1,2})x(\\d{2,3})")
    private val noiseGroups = setOf("dl", "rip", "web", "x264", "x265", "h264", "h265", "hevc", "avc", "aac", "ac3", "dts", "hdr", "dv")
    private val platforms = mapOf(
        "amzn" to "amzn", "amazon" to "amzn", "nf" to "nf", "netflix" to "nf", "dsnp" to "dsnp", "disney" to "dsnp",
        "hmax" to "hmax", "max" to "hmax", "atvp" to "atvp", "hulu" to "hulu", "pcok" to "pcok", "pmtp" to "pmtp", "itunes" to "itunes",
    )

    fun parse(text: String?): Release {
        val raw = text.orEmpty().trim().replace(extension, "")
        val normalized = raw.lowercase(Locale.ROOT)
            .replace("web-dl", "webdl").replace("web dl", "webdl").replace("blu-ray", "bluray").replace("blu ray", "bluray")
        val tokens = normalized.split(Regex("[^a-z0-9]+")).filter { it.isNotEmpty() }.toSet()
        val group = groupPattern.find(raw)?.groupValues?.get(1)?.lowercase(Locale.ROOT)?.takeIf { it !in noiseGroups }
        val source = when {
            "remux" in tokens || "bluray" in tokens || "bdrip" in tokens || "brrip" in tokens || "bdremux" in tokens || "bd" in tokens -> "bluray"
            "webdl" in tokens || "webrip" in tokens || "web" in tokens -> "web"
            "hdtv" in tokens || "pdtv" in tokens -> "hdtv"
            "dvdrip" in tokens || "dvd" in tokens -> "dvd"
            "hdrip" in tokens -> "hdrip"
            else -> null
        }
        val platform = tokens.firstNotNullOfOrNull { platforms[it] }
        val resolution = tokens.firstOrNull { it in setOf("2160p", "1080p", "720p", "576p", "480p") }
            ?: if ("4k" in tokens || "uhd" in tokens) "2160p" else null
        val code = episodeCode.find(normalized)
        val season = code?.let { (it.groupValues[1].ifEmpty { it.groupValues[3] }).toIntOrNull() }
        val episode = code?.let { (it.groupValues[2].ifEmpty { it.groupValues[4] }).toIntOrNull() }
        return Release(group, source, platform, resolution, tokens, season, episode)
    }

    fun score(file: Release, candidate: String, season: Int? = null, episode: Int? = null): Double {
        // Several release names can be listed for one subtitle ("A / B"); take the best.
        return candidate.split(" / ", "\n", " | ").filter { it.isNotBlank() }.ifEmpty { listOf(candidate) }
            .maxOf { scoreOne(file, parse(it), season, episode) }
    }

    private fun scoreOne(file: Release, sub: Release, season: Int?, episode: Int?): Double {
        if (sub.tokens.isEmpty()) return 0.0
        var score = 0.0
        if (file.group != null && sub.group != null && file.group == sub.group) score += 0.5
        else if (file.group != null && file.group in sub.tokens) score += 0.4
        if (file.source != null && file.source == sub.source) score += 0.2
        if (file.platform != null && file.platform == sub.platform) score += 0.1
        if (file.resolution != null && file.resolution == sub.resolution) score += 0.05
        if (file.tokens.isNotEmpty()) {
            val overlap = file.tokens.intersect(sub.tokens).size.toDouble() / file.tokens.size
            score += overlap * 0.15
        }
        // A subtitle for another episode is useless whatever else matches.
        val wantedSeason = season ?: file.season
        val wantedEpisode = episode ?: file.episode
        if (wantedEpisode != null && sub.episode != null && (sub.episode != wantedEpisode || (wantedSeason != null && sub.season != null && sub.season != wantedSeason))) {
            score *= 0.15
        }
        return score.coerceIn(0.0, 1.0)
    }

    fun label(score: Double): String? = when {
        score >= 0.65 -> "Exact release"
        score >= 0.35 -> "Same source"
        score >= 0.15 -> "Close"
        else -> null
    }
}

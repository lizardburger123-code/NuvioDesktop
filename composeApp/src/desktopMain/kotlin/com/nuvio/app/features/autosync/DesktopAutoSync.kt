package com.nuvio.app.features.autosync

import co.touchlab.kermit.Logger
import com.nuvio.app.core.storage.DesktopStorage
import com.nuvio.app.features.player.SubtitleSyncCue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayInputStream
import java.io.File
import java.util.Locale
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream
import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * Desktop AutoSync.
 *
 * Reference timing, in order of trust:
 *  1. The video's own embedded subtitle tracks, read from the Matroska Cues index over HTTP
 *     range requests (works for text and PGS tracks without playing the file).
 *  2. When the file has none: addon subtitles that independently agree with each other at a
 *     near-zero delay. One file alone is never trusted as a reference.
 *
 * The selected subtitle is aligned to the reference with the shared AutoSyncTimelineRetimer
 * (constant offset, frame-rate drift and per-line repair). When the selected subtitle cannot be
 * matched confidently, other subtitles in the same language are tried and the best one wins.
 */
internal object DesktopAutoSync {
    private val log = Logger.withTag("DesktopAutoSync")

    private const val MAX_SUBTITLE_BYTES = 6 * 1024 * 1024
    private const val DOWNLOAD_TIMEOUT_MS = 9_000L
    private const val MAX_EMBEDDED_REFERENCES = 3
    private const val MAX_SAME_LANGUAGE_ALTERNATIVES = 4
    private const val MAX_CONSENSUS_CANDIDATES = 6
    private const val CONSENSUS_MAX_OFFSET_MS = 600.0
    private const val ALREADY_SYNCED_SHIFT_MS = 90.0
    private const val MIN_TARGET_CUES = 8

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(6, TimeUnit.SECONDS)
        .callTimeout(9, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    sealed interface Result {
        /** A retimed copy was written; load [filePath] in place of [subtitleUrl]. */
        data class Applied(
            val subtitleUrl: String,
            val filePath: String,
            val summary: String,
        ) : Result

        /** The chosen subtitle already matches the video; nothing to change. */
        data class AlreadySynced(val subtitleUrl: String, val summary: String) : Result

        data object NoReference : Result
        data object NoMatch : Result
    }

    private class LoadedSubtitle(
        val candidate: AutoSyncSubtitleCandidate,
        val body: String,
        val cues: List<SubtitleSyncCue>,
    )

    private class Reference(
        val key: String,
        val label: String,
        val cues: List<SubtitleSyncCue>,
        val estimatedEndStartsMs: Set<Long>,
        val sdh: Boolean,
    ) {
        val activity: AutoSyncTimelineRetimer.PreparedActivity? by lazy {
            AutoSyncTimelineRetimer.prepareUnitActivity(cues)
        }
    }

    private class Match(
        val subtitle: LoadedSubtitle,
        val reference: Reference,
        val timeline: AutoSyncTimelineRetimeResult,
    ) {
        val quality: Double
            get() {
                val result = timeline
                val costScore = 1.0 / (1.0 + result.averageGroupCost.coerceAtLeast(0.0))
                val skipPenalty = result.longestTargetSkipRun.coerceAtMost(20) * 0.004
                val sdhPenalty = if (reference.sdh) 0.010 else 0.0
                return result.targetCoverage * 0.42 +
                    result.referenceCoverage * 0.15 +
                    costScore * 0.23 +
                    result.simpleGroupRatio * 0.20 -
                    skipPenalty -
                    sdhPenalty
            }
    }

    suspend fun run(
        streamUrl: String,
        streamHeaders: Map<String, String>,
        selectedUrl: String,
        selectedLanguage: String?,
        candidates: List<AutoSyncSubtitleCandidate>,
        toleranceMs: Int,
    ): Result = withContext(Dispatchers.IO) {
        val selectedCandidate = candidates.firstOrNull { it.url == selectedUrl }
            ?: AutoSyncSubtitleCandidate(url = selectedUrl, language = selectedLanguage.orEmpty())
        val targetLanguage = normalizeLanguage(selectedCandidate.language.ifBlank { selectedLanguage.orEmpty() })

        val (embedded, selected) = coroutineScope {
            val embeddedDeferred = async {
                runCatching { DesktopEmbeddedSubtitleTimelineLoader.load(streamUrl, streamHeaders) }
                    .getOrNull()
            }
            val selectedDeferred = async { loadSubtitle(selectedCandidate) }
            embeddedDeferred.await() to selectedDeferred.await()
        }
        currentCoroutineContext().ensureActive()

        var references = embedded?.tracks
            .orEmpty()
            .filter { (it.roleFlags and DesktopEmbeddedSubtitleTimelineLoader.ROLE_FLAG_COMMENTARY) == 0 }
            .filter { (it.selectionFlags and DesktopEmbeddedSubtitleTimelineLoader.SELECTION_FLAG_FORCED) == 0 }
            .sortedWith(compareBy<DesktopReferenceTrack> { isSdh(it.label, it.roleFlags) }.thenByDescending { it.cues.size })
            .take(MAX_EMBEDDED_REFERENCES)
            .map { track ->
                Reference(
                    key = track.key,
                    label = "embedded ${track.label ?: track.language ?: "subtitle"}",
                    cues = track.cues,
                    estimatedEndStartsMs = track.estimatedEndStartsMs,
                    sdh = isSdh(track.label, track.roleFlags),
                )
            }
        log.i { "embedded references=${references.size} source=${embedded?.source}" }

        if (references.isEmpty()) {
            val consensus = findConsensusReference(selectedCandidate, candidates)
            if (consensus == null) {
                log.i { "no embedded or consensus reference" }
                return@withContext Result.NoReference
            }
            references = listOf(consensus)
        }

        val targets = buildList {
            if (selected != null && selected.cues.size >= MIN_TARGET_CUES) add(selected)
        }.toMutableList()

        var best = bestMatch(targets, references)
        if (best == null || !best.timeline.confident) {
            // The selected file may be for another cut or release: try same-language siblings.
            val siblings = candidates
                .filter { it.url != selectedUrl && normalizeLanguage(it.language) == targetLanguage }
                .take(MAX_SAME_LANGUAGE_ALTERNATIVES)
            val loaded = coroutineScope { siblings.map { async { loadSubtitle(it) } }.awaitAll() }
                .filterNotNull()
                .filter { it.cues.size >= MIN_TARGET_CUES }
            val siblingBest = bestMatch(loaded, references)
            if (siblingBest != null && (best == null || isBetter(siblingBest, best))) best = siblingBest
        }

        val match = best?.takeIf { it.timeline.confident } ?: return@withContext Result.NoMatch
        val shift = match.timeline.maxAlignmentShiftMs()
        val summary = describe(match.timeline)
        log.i {
            "matched url=${match.subtitle.candidate.url.take(80)} ref=${match.reference.label} " +
                "shift=${shift.roundToLong()}ms scale=${match.timeline.alignmentScale} quality=${match.quality}"
        }
        val tolerance = toleranceMs.coerceAtLeast(0).toDouble()
        if (match.subtitle.candidate.url == selectedUrl && shift <= maxOf(tolerance, ALREADY_SYNCED_SHIFT_MS)) {
            return@withContext Result.AlreadySynced(selectedUrl, summary)
        }

        val retimed = AutoSyncSubtitleTextRetimer.retime(match.subtitle.body, match.timeline)
            ?: return@withContext Result.NoMatch
        val file = writeRetimed(match.subtitle.candidate.url, retimed)
        Result.Applied(
            subtitleUrl = match.subtitle.candidate.url,
            filePath = file.absolutePath,
            summary = summary,
        )
    }

    private suspend fun bestMatch(
        subtitles: List<LoadedSubtitle>,
        references: List<Reference>,
    ): Match? {
        var best: Match? = null
        for (subtitle in subtitles) {
            val targetActivity = AutoSyncTimelineRetimer.prepareUnitActivity(subtitle.cues) ?: continue
            for (reference in references) {
                currentCoroutineContext().ensureActive()
                val context = currentCoroutineContext()
                val timeline = runCatching {
                    AutoSyncTimelineRetimer.retime(
                        reference = reference.cues,
                        target = subtitle.cues,
                        coarseScale = 1.0,
                        coarseInterceptMs = 0.0,
                        discoverAlignment = true,
                        allowAmbiguousDelayOnlyMargin = AutoSyncTimelineRetimer.shouldRelaxDelayOnlyMargin(
                            sdhReference = reference.sdh,
                            referenceSize = reference.cues.size,
                            targetSize = subtitle.cues.size,
                        ),
                        referenceEstimatedEndStartsMs = reference.estimatedEndStartsMs,
                        preparedReferenceActivity = reference.activity,
                        preparedTargetActivity = targetActivity,
                        cancellationCheck = { context.ensureActive() },
                    )
                }.getOrElse { error ->
                    if (error is CancellationException) throw error
                    null
                } ?: continue
                val candidate = Match(subtitle, reference, timeline)
                if (best == null || isBetter(candidate, best)) best = candidate
            }
        }
        return best
    }

    private fun isBetter(candidate: Match, current: Match): Boolean {
        if (candidate.timeline.confident != current.timeline.confident) return candidate.timeline.confident
        if (candidate.subtitle === current.subtitle) {
            preferTighterFitOnDisagreement(candidate.timeline, current.timeline)?.let { return it }
        }
        return candidate.quality > current.quality
    }

    /**
     * Without embedded subtitles, a reference is only trusted when two independent addon
     * subtitles agree with each other at a near-zero delay (they were timed to this cut).
     */
    private suspend fun findConsensusReference(
        selected: AutoSyncSubtitleCandidate,
        candidates: List<AutoSyncSubtitleCandidate>,
    ): Reference? {
        val pool = candidates
            .filter { it.url != selected.url }
            .sortedBy { consensusLanguageRank(it.language) }
            .take(MAX_CONSENSUS_CANDIDATES)
        if (pool.size < 2) return null
        val loaded = coroutineScope { pool.map { async { loadSubtitle(it) } }.awaitAll() }
            .filterNotNull()
            .filter { it.cues.size >= MIN_TARGET_CUES }
            .mapNotNull { subtitle ->
                AutoSyncTimelineRetimer.prepareUnitActivity(subtitle.cues)?.let { subtitle to it }
            }
        var bestPair: Pair<LoadedSubtitle, LoadedSubtitle>? = null
        for (first in loaded.indices) {
            for (second in first + 1 until loaded.size) {
                currentCoroutineContext().ensureActive()
                val (a, aActivity) = loaded[first]
                val (b, bActivity) = loaded[second]
                if (AutoSyncReferenceConsistency.isSameSource(aActivity, bActivity)) continue
                val alignment = AutoSyncTimelineRetimer.findDelayOnlyAlignmentPrepared(
                    referenceActivity = aActivity,
                    targetActivity = bActivity,
                    targetSize = b.cues.size,
                ) ?: continue
                if (abs(alignment.offsetMs) > CONSENSUS_MAX_OFFSET_MS) continue
                val pairSize = a.cues.size + b.cues.size
                val currentSize = bestPair?.let { it.first.cues.size + it.second.cues.size } ?: -1
                if (pairSize > currentSize) bestPair = a to b
            }
        }
        val (a, b) = bestPair ?: return null
        val chosen = if (a.cues.size >= b.cues.size) a else b
        return Reference(
            key = "consensus:${chosen.candidate.url.hashCode()}",
            label = "addon consensus (${chosen.candidate.language})",
            cues = chosen.cues,
            estimatedEndStartsMs = emptySet(),
            sdh = isSdh(chosen.candidate.name, 0),
        )
    }

    private fun consensusLanguageRank(language: String): Int = when (normalizeLanguage(language)) {
        "en" -> 0
        else -> 1
    }

    private suspend fun loadSubtitle(candidate: AutoSyncSubtitleCandidate): LoadedSubtitle? {
        val body = withTimeoutOrNull(DOWNLOAD_TIMEOUT_MS) { download(candidate.url, candidate.language) }
            ?: return null
        val cues = runCatching {
            AutoSyncTimelineRetimer.normalizeExternalTimeline(
                AutoSyncSubtitleCueParser.parse(body, candidate.url),
            )
        }.getOrNull() ?: return null
        return LoadedSubtitle(candidate, body, cues)
    }

    private fun download(url: String, languageHint: String?): String? {
        if (!url.startsWith("http://", true) && !url.startsWith("https://", true)) {
            return runCatching {
                val path = if (url.startsWith("file:", true)) File(java.net.URI(url)) else File(url)
                decode(path.readBytes(), languageHint)
            }.getOrNull()
        }
        val request = Request.Builder().url(url).header("Accept", "*/*").build()
        return runCatching {
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@use null
                val source = response.body?.byteStream() ?: return@use null
                val bytes = source.use { stream ->
                    val buffer = java.io.ByteArrayOutputStream()
                    val chunk = ByteArray(16 * 1024)
                    while (true) {
                        val read = stream.read(chunk)
                        if (read < 0) break
                        buffer.write(chunk, 0, read)
                        if (buffer.size() > MAX_SUBTITLE_BYTES) return@use null
                    }
                    buffer.toByteArray()
                }
                decode(bytes ?: return@use null, languageHint)
            }
        }.getOrNull()
    }

    private fun decode(raw: ByteArray, languageHint: String?): String {
        val bytes = if (raw.size > 2 && raw[0] == 0x1F.toByte() && raw[1] == 0x8B.toByte()) {
            GZIPInputStream(ByteArrayInputStream(raw)).use { it.readBytes() }
        } else {
            raw
        }
        return DesktopSubtitleCharsetDetector.decode(bytes, languageHint = languageHint)
    }

    private fun writeRetimed(subtitleUrl: String, retimed: String): File {
        val directory = DesktopStorage.cacheDir.resolve("autosync").toFile().also { it.mkdirs() }
        val prefix = "autosync_${Integer.toHexString(subtitleUrl.hashCode())}_"
        val extension = when {
            retimed.trimStart().startsWith("WEBVTT") -> "vtt"
            retimed.contains("[Events]", ignoreCase = true) -> "ass"
            else -> "srt"
        }
        val file = File(directory, "$prefix${Integer.toHexString(retimed.hashCode())}.$extension")
        directory.listFiles { candidate -> candidate.name.startsWith(prefix) && candidate != file }
            ?.forEach { it.delete() }
        file.writeText(retimed, Charsets.UTF_8)
        return file
    }

    private fun describe(timeline: AutoSyncTimelineRetimeResult): String {
        val offsetSeconds = timeline.alignmentInterceptMs / 1000.0
        val sign = if (offsetSeconds >= 0) "+" else "−"
        val offset = String.format(Locale.US, "%s%.1fs", sign, abs(offsetSeconds))
        val drift = abs(timeline.alignmentScale - 1.0) > 0.0005
        return if (drift) "$offset, frame-rate corrected" else offset
    }

    private fun isSdh(label: String?, roleFlags: Int): Boolean {
        if ((roleFlags and DesktopEmbeddedSubtitleTimelineLoader.ROLE_FLAG_HEARING_IMPAIRED) != 0) return true
        val text = label.orEmpty().lowercase()
        return text.contains("sdh") || text.contains("hearing impaired") ||
            text.contains("hearing-impaired") || text.contains("closed caption")
    }

    private fun normalizeLanguage(language: String): String {
        val value = language.trim().lowercase(Locale.ROOT)
        return when {
            value.startsWith("ar") || value == "ara" || value.contains("arabic") -> "ar"
            value.startsWith("en") || value == "eng" || value.contains("english") -> "en"
            value.length >= 2 -> value.take(2)
            else -> value
        }
    }
}

package com.nuvio.app.features.autosync

import com.nuvio.app.features.player.SubtitleSyncCue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.async
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.util.ArrayDeque
import java.util.LinkedHashMap
import java.util.concurrent.TimeUnit
import kotlin.math.max

/**
 * Desktop port of the Android EmbeddedSubtitleTimelineLoader (Matroska/WebM path).
 *
 * Player-independent embedded subtitle timeline loader.
 *
 * For seekable Matroska/WebM HTTP sources this reads the container's EBML metadata and Cues index
 * with HTTP range requests. Matroska recommends indexing every subtitle frame in Cues, so a normal
 * remux can expose the whole embedded subtitle timing timeline without playing or seeking ExoPlayer.
 *
 * This is deliberately best-effort. If range requests, Tracks, or subtitle Cues are unavailable,
 * AutoSync falls back to the existing live Media3 observation path.
 */
internal object DesktopEmbeddedSubtitleTimelineLoader {
    const val SELECTION_FLAG_FORCED = 1 shl 1
    const val ROLE_FLAG_COMMENTARY = 1 shl 3
    const val ROLE_FLAG_HEARING_IMPAIRED = 1 shl 10
    const val ROLE_FLAG_DESCRIBES_VIDEO = 1 shl 9

    private const val TOTAL_TIMEOUT_MS = 7_000L
    private const val INITIAL_PROBE_BYTES = 512 * 1024
    private const val HEADER_PROBE_BYTES = 64
    private const val TAIL_PROBE_BYTES = 4 * 1024 * 1024
    private const val MAX_SEEK_HEAD_BYTES = 2 * 1024 * 1024
    private const val MAX_INFO_BYTES = 512 * 1024
    private const val MAX_TRACKS_BYTES = 4 * 1024 * 1024
    private const val MAX_CUES_BYTES = 8 * 1024 * 1024
    private const val MAX_TOTAL_DOWNLOAD_BYTES = 24L * 1024L * 1024L
    private const val MAX_RANGE_REQUESTS = 16
    private const val MAX_SEEK_HEAD_HOPS = 4
    private const val DEFAULT_TIMESTAMP_SCALE_NS = 1_000_000L
    private const val DEFAULT_CUE_DURATION_MS = 5_000L
    private const val LAST_MKV_CUE_ESTIMATED_DURATION_MS = 2_000L
    private const val MAX_MKV_INTER_CUE_ESTIMATED_DURATION_MS = 4_000L
    private const val MATROSKA_PGS_CODEC_ID = "S_HDMV/PGS"
    private const val MIN_INDEXED_CUES = 8
    private const val MIN_INDEXED_SPAN_MS = 30_000L
    private const val MAX_CACHE_ENTRIES = 2
    private const val NEGATIVE_CACHE_TTL_MS = 120_000L
    private const val MAX_MP4_MOOV_BYTES = 24 * 1024 * 1024
    private const val MAX_MP4_TOP_LEVEL_BOXES = 64
    private const val MP4_BOX_HEADER_BYTES = 16

    // Top-level Matroska/EBML IDs.
    private const val ID_EBML = 0x1A45DFA3L
    private const val ID_SEGMENT = 0x18538067L
    private const val ID_SEEK_HEAD = 0x114D9B74L
    private const val ID_INFO = 0x1549A966L
    private const val ID_TRACKS = 0x1654AE6BL
    private const val ID_CUES = 0x1C53BB6BL
    private const val ID_CLUSTER = 0x1F43B675L

    // SeekHead.
    private const val ID_SEEK = 0x4DBBL
    private const val ID_SEEK_ID = 0x53ABL
    private const val ID_SEEK_POSITION = 0x53ACL

    // Info.
    private const val ID_TIMESTAMP_SCALE = 0x2AD7B1L

    // Tracks.
    private const val ID_TRACK_ENTRY = 0xAEL
    private const val ID_TRACK_NUMBER = 0xD7L
    private const val ID_TRACK_TYPE = 0x83L
    private const val ID_FLAG_DEFAULT = 0x88L
    private const val ID_FLAG_FORCED = 0x55AAL
    private const val ID_FLAG_HEARING_IMPAIRED = 0x55ABL
    private const val ID_FLAG_VISUAL_IMPAIRED = 0x55ACL
    private const val ID_FLAG_TEXT_DESCRIPTIONS = 0x55ADL
    private const val ID_FLAG_COMMENTARY = 0x55AFL
    private const val ID_NAME = 0x536EL
    private const val ID_LANGUAGE = 0x22B59CL
    private const val ID_LANGUAGE_IETF = 0x22B59DL
    private const val ID_CODEC_ID = 0x86L
    private const val TRACK_TYPE_SUBTITLE = 17L

    // Cues.
    private const val ID_CUE_POINT = 0xBBL
    private const val ID_CUE_TIME = 0xB3L
    private const val ID_CUE_TRACK_POSITIONS = 0xB7L
    private const val ID_CUE_TRACK = 0xF7L
    private const val ID_CUE_DURATION = 0xB2L

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(4, TimeUnit.SECONDS)
        .callTimeout(5, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    private val cacheLock = Any()
    private val cache = object : LinkedHashMap<String, CachedLoadResult>(
        MAX_CACHE_ENTRIES,
        0.75f,
        true,
    ) {
        override fun removeEldestEntry(
            eldest: MutableMap.MutableEntry<String, CachedLoadResult>?,
        ): Boolean = size > MAX_CACHE_ENTRIES
    }
    private val inFlight = mutableMapOf<String, CompletableDeferred<DesktopIndexedEmbeddedTimeline?>>()

    /**
     * Starts loading the index in [scope] so a later [load] finds it cached or joins the
     * in-flight download instead of starting from zero when AutoSync runs.
     */
    fun prefetch(
        scope: CoroutineScope,
        sourceUrl: String,
        sourceHeaders: Map<String, String> = emptyMap(),
    ) {
        scope.launch { load(sourceUrl, sourceHeaders) }
    }

    suspend fun load(
        sourceUrl: String,
        sourceHeaders: Map<String, String> = emptyMap(),
    ): DesktopIndexedEmbeddedTimeline? {
        if (!sourceUrl.startsWith("http://", ignoreCase = true) &&
            !sourceUrl.startsWith("https://", ignoreCase = true)
        ) {
            return null
        }

        val cacheKey = "$sourceUrl#${sourceHeaders.hashCode()}"
        val nowNs = System.nanoTime()
        val ownedLoad = CompletableDeferred<DesktopIndexedEmbeddedTimeline?>()
        val activeLoad = synchronized(cacheLock) {
            val cached = cache[cacheKey]
            if (cached != null) {
                if (cached.timeline != null) return cached.timeline
                val ageMs = (nowNs - cached.createdAtNs).coerceAtLeast(0L) / 1_000_000L
                if (ageMs < NEGATIVE_CACHE_TTL_MS) return null
                cache.remove(cacheKey)
            }
            inFlight.getOrPut(cacheKey) { ownedLoad }
        }

        if (activeLoad !== ownedLoad) {
            return try {
                activeLoad.await()
            } catch (cancel: CancellationException) {
                // The owning load was cancelled (e.g. its player closed). Load for this caller
                // unless this caller itself is the one being cancelled.
                currentCoroutineContext().ensureActive()
                load(sourceUrl, sourceHeaders)
            }
        }

        try {
            return loadAndCache(cacheKey, sourceUrl, sourceHeaders)
                .also(ownedLoad::complete)
        } finally {
            ownedLoad.cancel()
            synchronized(cacheLock) {
                if (inFlight[cacheKey] === ownedLoad) inFlight.remove(cacheKey)
            }
        }
    }

    /** One subtitle track a file carries, read from its header without downloading the film. */
    data class EmbeddedSubtitleInfo(
        val number: Int,
        val language: String?,
        val name: String?,
        /** "PGS" (disc bitmap), "VobSub" (DVD bitmap), "ASS", "SRT" or the raw codec id. */
        val format: String,
        val forced: Boolean,
        val hearingImpaired: Boolean,
        val commentary: Boolean,
    ) {
        /** Bitmap tracks come straight off a Blu-ray or DVD: the official subtitles. */
        val fromDisc: Boolean get() = format == "PGS" || format == "VobSub"
    }

    private const val PROBE_TIMEOUT_MS = 8_000L
    private const val PROBE_MAX_BYTES = 6L * 1024L * 1024L
    private const val PROBE_MAX_REQUESTS = 6

    /**
     * Lists the subtitle tracks of a Matroska file at [sourceUrl] by reading only its header
     * (usually one range request of half a megabyte). Null when the file can't be read that way
     * (not Matroska, no range support, too slow).
     */
    suspend fun probeSubtitleTracks(
        sourceUrl: String,
        sourceHeaders: Map<String, String> = emptyMap(),
    ): List<EmbeddedSubtitleInfo>? {
        if (!sourceUrl.startsWith("http://", ignoreCase = true) &&
            !sourceUrl.startsWith("https://", ignoreCase = true)
        ) return null
        return try {
            withTimeout(PROBE_TIMEOUT_MS) {
                withContext(Dispatchers.IO) { readSubtitleTracks(sourceUrl, sourceHeaders) }
            }
        } catch (_: TimeoutCancellationException) {
            null
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (_: Exception) {
            null
        }
    }

    private suspend fun readSubtitleTracks(
        sourceUrl: String,
        sourceHeaders: Map<String, String>,
    ): List<EmbeddedSubtitleInfo>? {
        val stats = RangeStats(
            deadlineNs = System.nanoTime() + PROBE_TIMEOUT_MS * 1_000_000L,
            maxBytes = PROBE_MAX_BYTES,
            maxRequests = PROBE_MAX_REQUESTS,
        )
        val initial = fetchRange(
            sourceUrl = sourceUrl,
            sourceHeaders = sourceHeaders,
            start = 0L,
            length = INITIAL_PROBE_BYTES,
            requirePartialContent = false,
            stats = stats,
        ) ?: return null
        val segment = findSegment(initial.bytes) ?: return null
        val segmentDataStart = segment.dataStart.toLong()
        val directPositions = findInitialTopLevelPositions(bytes = initial.bytes, segment = segment)

        var tracksPosition = directPositions[ID_TRACKS]
        if (tracksPosition == null) {
            // Tracks normally sits right after the header; when it doesn't, the SeekHead says where.
            val seekHeadPosition = directPositions[ID_SEEK_HEAD] ?: return null
            val seekHeadBytes = extractElementFromInitialProbe(
                initialBytes = initial.bytes,
                absolutePosition = seekHeadPosition,
                expectedId = ID_SEEK_HEAD,
                maxElementBytes = MAX_SEEK_HEAD_BYTES,
            ) ?: fetchElementAt(
                sourceUrl = sourceUrl,
                sourceHeaders = sourceHeaders,
                absolutePosition = seekHeadPosition,
                expectedId = ID_SEEK_HEAD,
                maxElementBytes = MAX_SEEK_HEAD_BYTES,
                stats = stats,
            ) ?: return null
            tracksPosition = parseSeekHead(seekHeadBytes)[ID_TRACKS]?.let { segmentDataStart + it } ?: return null
        }
        val tracksBytes = extractElementFromInitialProbe(
            initialBytes = initial.bytes,
            absolutePosition = tracksPosition,
            expectedId = ID_TRACKS,
            maxElementBytes = MAX_TRACKS_BYTES,
        ) ?: fetchElementAt(
            sourceUrl = sourceUrl,
            sourceHeaders = sourceHeaders,
            absolutePosition = tracksPosition,
            expectedId = ID_TRACKS,
            maxElementBytes = MAX_TRACKS_BYTES,
            stats = stats,
        ) ?: return null
        return parseSubtitleTracks(tracksBytes).map { track ->
            val codec = track.codecId.orEmpty()
            EmbeddedSubtitleInfo(
                number = track.number,
                language = track.languageIetf?.takeIf { it.isNotBlank() } ?: track.language?.takeIf { it.isNotBlank() },
                name = track.name?.takeIf { it.isNotBlank() },
                format = when {
                    codec.equals(MATROSKA_PGS_CODEC_ID, ignoreCase = true) -> "PGS"
                    codec.equals("S_VOBSUB", ignoreCase = true) -> "VobSub"
                    codec.startsWith("S_TEXT/ASS", ignoreCase = true) || codec.startsWith("S_TEXT/SSA", ignoreCase = true) -> "ASS"
                    codec.startsWith("S_TEXT/UTF8", ignoreCase = true) -> "SRT"
                    codec.startsWith("S_TEXT/WEBVTT", ignoreCase = true) -> "WebVTT"
                    else -> codec.removePrefix("S_").ifBlank { "Unknown" }
                },
                forced = track.forced,
                hearingImpaired = track.hearingImpaired,
                commentary = track.commentary,
            )
        }
    }

    // ---- Disc subtitles from another file -------------------------------------------------------

    /** A disc subtitle track pulled out of a file: a ready-to-load .sup, and when each line appears. */
    class PgsExtraction(val sup: ByteArray, val showTimesMs: List<Long>, val trackName: String?)

    sealed interface PgsOutcome {
        class Done(val extraction: PgsExtraction) : PgsOutcome
        class Failed(val reason: String) : PgsOutcome
    }

    private const val ID_CONTENT_ENCODINGS = 0x6D80L
    private const val ID_CONTENT_ENCODING = 0x6240L
    private const val ID_CONTENT_ENCODING_TYPE = 0x5033L
    private const val ID_CONTENT_COMPRESSION = 0x5034L
    private const val ID_CONTENT_COMP_ALGO = 0x4254L
    private const val ID_CONTENT_COMP_SETTINGS = 0x4255L
    private const val ID_CUE_CLUSTER_POSITION = 0xF1L
    private const val ID_CUE_RELATIVE_POSITION = 0xF0L
    private const val ID_SIMPLE_BLOCK = 0xA3L
    private const val ID_BLOCK_GROUP = 0xA0L
    private const val ID_BLOCK = 0xA1L
    private const val PGS_BLOCK_WINDOW = 96 * 1024
    private const val PGS_MAX_BLOCK_BYTES = 2 * 1024 * 1024
    private const val PGS_PARALLEL = 8
    private const val PGS_TOTAL_TIMEOUT_MS = 300_000L

    private class PgsTrackSpec(
        val number: Int,
        val language: String?,
        val name: String?,
        val forced: Boolean,
        val hearingImpaired: Boolean,
        val commentary: Boolean,
        val isDefault: Boolean,
        /** 0 = zlib, 3 = header stripping, null = stored as is. */
        val compression: Int?,
        val strippedHeader: ByteArray?,
    )

    private class PgsCue(val ticks: Long, val clusterPosition: Long, val relativePosition: Long?)

    /**
     * Copies the [language] disc subtitle track (PGS) out of the Matroska file at [sourceUrl]
     * without downloading the film: the file's index (Cues) says where every subtitle block sits,
     * and each block is fetched on its own with a small range request. [languageOf] turns a track's
     * language tag into the same two-letter code as [language].
     */
    suspend fun extractPgsTrack(
        sourceUrl: String,
        sourceHeaders: Map<String, String>,
        language: String,
        languageOf: (String?) -> String,
        onProgress: (done: Int, total: Int) -> Unit,
    ): PgsOutcome = try {
        withTimeout(PGS_TOTAL_TIMEOUT_MS) {
            withContext(Dispatchers.IO) { extractPgs(sourceUrl, sourceHeaders, language, languageOf, onProgress) }
        }
    } catch (_: TimeoutCancellationException) {
        PgsOutcome.Failed("The file answered too slowly. Try another source.")
    } catch (cancel: CancellationException) {
        throw cancel
    } catch (error: Exception) {
        PgsOutcome.Failed("The subtitles couldn't be read from this file (${error.message ?: error::class.simpleName}).")
    }

    /** Debrid links redirect to a CDN; asking the service once and then the CDN directly saves thousands of round trips. */
    private fun resolveFinalUrl(sourceUrl: String, sourceHeaders: Map<String, String>): String? = runCatching {
        val request = Request.Builder()
            .url(sourceUrl)
            .header("Range", "bytes=0-0")
            .header("Accept-Encoding", "identity")
            .apply { sourceHeaders.forEach { (name, value) -> if (!name.equals("Range", true)) header(name, value) } }
            .build()
        httpClient.newCall(request).execute().use { response ->
            if (response.isSuccessful) response.request.url.toString() else null
        }
    }.getOrNull()

    private suspend fun extractPgs(
        sourceUrl: String,
        sourceHeaders: Map<String, String>,
        language: String,
        languageOf: (String?) -> String,
        onProgress: (done: Int, total: Int) -> Unit,
    ): PgsOutcome {
        val url = resolveFinalUrl(sourceUrl, sourceHeaders) ?: sourceUrl
        val stats = RangeStats(
            deadlineNs = System.nanoTime() + 60_000L * 1_000_000L,
            maxBytes = 40L * 1024L * 1024L,
            maxRequests = 24,
        )
        val initial = fetchRange(url, sourceHeaders, 0L, INITIAL_PROBE_BYTES, false, stats)
            ?: return PgsOutcome.Failed("The file couldn't be opened.")
        val segment = findSegment(initial.bytes) ?: return PgsOutcome.Failed("This file isn't an MKV, so its disc subtitles can't be read.")
        val segmentDataStart = segment.dataStart.toLong()
        val positions = HashMap(findInitialTopLevelPositions(bytes = initial.bytes, segment = segment))
        positions[ID_SEEK_HEAD]?.let { seekHeadPosition ->
            val seekHead = extractElementFromInitialProbe(initial.bytes, seekHeadPosition, ID_SEEK_HEAD, MAX_SEEK_HEAD_BYTES)
                ?: fetchElementAt(url, sourceHeaders, seekHeadPosition, ID_SEEK_HEAD, MAX_SEEK_HEAD_BYTES, stats)
            seekHead?.let { bytes -> parseSeekHead(bytes).forEach { (id, relative) -> positions.putIfAbsent(id, segmentDataStart + relative) } }
        }
        suspend fun element(id: Long, maxBytes: Int): ByteArray? {
            val position = positions[id] ?: return null
            return extractElementFromInitialProbe(initial.bytes, position, id, maxBytes)
                ?: fetchElementAt(url, sourceHeaders, position, id, maxBytes, stats)
        }

        val timestampScaleNs = element(ID_INFO, MAX_INFO_BYTES)?.let(::parseTimestampScaleNs) ?: DEFAULT_TIMESTAMP_SCALE_NS
        val tracks = element(ID_TRACKS, MAX_TRACKS_BYTES)?.let(::parsePgsTrackSpecs)
            ?: return PgsOutcome.Failed("The file's track list couldn't be read.")
        val track = tracks
            .filter { languageOf(it.language) == language && !it.forced && !it.commentary }
            .sortedWith(compareBy<PgsTrackSpec>({ it.hearingImpaired }, { !it.isDefault }))
            .firstOrNull()
            ?: return PgsOutcome.Failed("This file has no disc subtitles in that language.")
        val cuesBytes = element(ID_CUES, MAX_CUES_BYTES)
            ?: return PgsOutcome.Failed("This file has no index, so its subtitles can't be read without downloading the whole film.")
        val cues = parsePgsCues(cuesBytes, track.number)
        if (cues.size < MIN_INDEXED_CUES) return PgsOutcome.Failed("This file's index doesn't list its subtitles. Try another source.")
        if (cues.any { it.relativePosition == null }) {
            return PgsOutcome.Failed("This file's index doesn't say exactly where its subtitles are. Try another source.")
        }

        val total = cues.size
        val done = AtomicInteger(0)
        val gate = Semaphore(PGS_PARALLEL)
        val headerSizes = ConcurrentHashMap<Long, Int>()
        onProgress(0, total)
        val frames = coroutineScope {
            cues.map { cue ->
                async {
                    gate.withPermit {
                        val frame = runCatching { fetchPgsFrame(url, sourceHeaders, segmentDataStart, cue, track, headerSizes) }
                            .getOrElse { if (it is CancellationException) throw it else null }
                        onProgress(done.incrementAndGet(), total)
                        cue to frame
                    }
                }
            }.awaitAll()
        }
        val missing = frames.count { it.second == null }
        if (missing > total / 10) return PgsOutcome.Failed("$missing of $total subtitle pieces couldn't be read. Try again, or another source.")

        val out = java.io.ByteArrayOutputStream()
        val shows = mutableListOf<Long>()
        frames.sortedBy { it.first.ticks }.forEach { (cue, frame) ->
            if (frame == null) return@forEach
            val ns = cue.ticks * timestampScaleNs
            val pts = ns / 100_000L * 9L
            val timeMs = ns / 1_000_000L
            var index = 0
            var shown = false
            while (index + 3 <= frame.size) {
                val type = frame[index].toInt() and 0xFF
                val size = ((frame[index + 1].toInt() and 0xFF) shl 8) or (frame[index + 2].toInt() and 0xFF)
                if (index + 3 + size > frame.size) break
                // A presentation segment with objects on screen starts a line; with none it clears one.
                if (type == 0x16 && size >= 11 && (frame[index + 3 + 10].toInt() and 0xFF) > 0) shown = true
                out.write('P'.code); out.write('G'.code)
                out.write((pts ushr 24).toInt() and 0xFF); out.write((pts ushr 16).toInt() and 0xFF)
                out.write((pts ushr 8).toInt() and 0xFF); out.write(pts.toInt() and 0xFF)
                repeat(4) { out.write(0) }
                out.write(frame, index, 3 + size)
                index += 3 + size
            }
            if (shown) shows += timeMs
        }
        if (shows.isEmpty()) return PgsOutcome.Failed("The subtitle track in this file is empty.")
        return PgsOutcome.Done(PgsExtraction(out.toByteArray(), shows, track.name))
    }

    private suspend fun fetchPgsFrame(
        url: String,
        headers: Map<String, String>,
        segmentDataStart: Long,
        cue: PgsCue,
        track: PgsTrackSpec,
        headerSizes: ConcurrentHashMap<Long, Int>,
    ): ByteArray? {
        val clusterStart = segmentDataStart + cue.clusterPosition
        val relative = cue.relativePosition ?: return null
        val known = headerSizes[clusterStart]
        // The block sits [relative] bytes after the cluster's own header (5 to 12 bytes long).
        val windowStart = clusterStart + relative + (known ?: 0)
        val stats = RangeStats(deadlineNs = System.nanoTime() + 30_000L * 1_000_000L, maxBytes = 6L * 1024L * 1024L, maxRequests = 3)
        val window = fetchRange(url, headers, windowStart, PGS_BLOCK_WINDOW, true, stats)?.bytes ?: return null
        val offsets = if (known != null) listOf(0) else (5..12).toList()
        for (offset in offsets) {
            val block = readElement(window, offset, window.size) ?: continue
            if (block.id != ID_SIMPLE_BLOCK && block.id != ID_BLOCK_GROUP) continue
            val size = block.size ?: continue
            if (size <= 0L || size > PGS_MAX_BLOCK_BYTES) continue
            val bytes: ByteArray
            val start: Int
            if (block.dataStart + size <= window.size) {
                bytes = window
                start = offset
            } else {
                bytes = fetchRange(url, headers, windowStart + offset, (block.headerSize + size).toInt(), true, stats)?.bytes ?: continue
                start = 0
            }
            val element = readElement(bytes, start, bytes.size) ?: continue
            val frame = blockFrame(bytes, element, track.number) ?: continue
            if (known == null) headerSizes[clusterStart] = offset
            return decodeFrame(frame, track)
        }
        return null
    }

    /** The frame of a SimpleBlock or BlockGroup for [trackNumber]; null for another track or laced blocks. */
    private fun blockFrame(bytes: ByteArray, element: EbmlElement, trackNumber: Int): ByteArray? {
        val end = element.endWithin(bytes.size) ?: return null
        if (element.id == ID_BLOCK_GROUP) {
            var frame: ByteArray? = null
            forEachChild(bytes, element.dataStart, end) { child ->
                if (child.id == ID_BLOCK && frame == null) frame = blockPayload(bytes, child.dataStart, child.endWithin(end) ?: return@forEachChild, trackNumber)
            }
            return frame
        }
        return blockPayload(bytes, element.dataStart, end, trackNumber)
    }

    private fun blockPayload(bytes: ByteArray, start: Int, end: Int, trackNumber: Int): ByteArray? {
        if (start >= end) return null
        val first = bytes[start].toInt() and 0xFF
        val length = vintLength(first) ?: return null
        if (start + length + 3 > end) return null
        var number = (first and ((1 shl (8 - length)) - 1)).toLong()
        for (index in 1 until length) number = (number shl 8) or (bytes[start + index].toLong() and 0xFFL)
        if (number.toInt() != trackNumber) return null
        val flags = bytes[start + length + 2].toInt() and 0xFF
        if ((flags and 0x06) != 0) return null
        return bytes.copyOfRange(start + length + 3, end)
    }

    private fun decodeFrame(frame: ByteArray, track: PgsTrackSpec): ByteArray? = when (track.compression) {
        null -> frame
        3 -> (track.strippedHeader ?: ByteArray(0)) + frame
        0 -> runCatching {
            val inflater = java.util.zip.Inflater()
            try {
                inflater.setInput(frame)
                val out = java.io.ByteArrayOutputStream(frame.size * 4)
                val buffer = ByteArray(16 * 1024)
                while (!inflater.finished()) {
                    val count = inflater.inflate(buffer)
                    if (count == 0 && (inflater.needsInput() || inflater.needsDictionary())) break
                    out.write(buffer, 0, count)
                }
                out.toByteArray()
            } finally {
                inflater.end()
            }
        }.getOrNull()
        else -> null
    }

    private fun parsePgsTrackSpecs(tracksElement: ByteArray): List<PgsTrackSpec> {
        val root = readElement(tracksElement, 0, tracksElement.size) ?: return emptyList()
        if (root.id != ID_TRACKS) return emptyList()
        val rootEnd = root.endWithin(tracksElement.size) ?: return emptyList()
        val result = mutableListOf<PgsTrackSpec>()
        forEachChild(tracksElement, root.dataStart, rootEnd) { entry ->
            if (entry.id != ID_TRACK_ENTRY) return@forEachChild
            val entryEnd = entry.endWithin(rootEnd) ?: return@forEachChild
            var number: Int? = null
            var type: Long? = null
            var codecId: String? = null
            var language: String? = null
            var languageIetf: String? = null
            var name: String? = null
            var isDefault = true
            var forced = false
            var hearingImpaired = false
            var commentary = false
            var compression: Int? = null
            var stripped: ByteArray? = null
            forEachChild(tracksElement, entry.dataStart, entryEnd) { child ->
                when (child.id) {
                    ID_TRACK_NUMBER -> number = readUnsigned(tracksElement, child)?.toInt()
                    ID_TRACK_TYPE -> type = readUnsigned(tracksElement, child)
                    ID_CODEC_ID -> codecId = readUtf8(tracksElement, child)
                    ID_LANGUAGE -> language = readUtf8(tracksElement, child)
                    ID_LANGUAGE_IETF -> languageIetf = readUtf8(tracksElement, child)
                    ID_NAME -> name = readUtf8(tracksElement, child)
                    ID_FLAG_DEFAULT -> isDefault = readUnsigned(tracksElement, child) != 0L
                    ID_FLAG_FORCED -> forced = readUnsigned(tracksElement, child) == 1L
                    ID_FLAG_HEARING_IMPAIRED -> hearingImpaired = readUnsigned(tracksElement, child) == 1L
                    ID_FLAG_COMMENTARY -> commentary = readUnsigned(tracksElement, child) == 1L
                    ID_CONTENT_ENCODINGS -> {
                        val encodingsEnd = child.endWithin(entryEnd) ?: return@forEachChild
                        forEachChild(tracksElement, child.dataStart, encodingsEnd) { encoding ->
                            if (encoding.id != ID_CONTENT_ENCODING) return@forEachChild
                            val encodingEnd = encoding.endWithin(encodingsEnd) ?: return@forEachChild
                            var encodingType = 0L
                            var algo: Int? = null
                            var settings: ByteArray? = null
                            forEachChild(tracksElement, encoding.dataStart, encodingEnd) { part ->
                                when (part.id) {
                                    ID_CONTENT_ENCODING_TYPE -> encodingType = readUnsigned(tracksElement, part) ?: 0L
                                    ID_CONTENT_COMPRESSION -> {
                                        algo = 0
                                        val compressionEnd = part.endWithin(encodingEnd) ?: return@forEachChild
                                        forEachChild(tracksElement, part.dataStart, compressionEnd) { option ->
                                            when (option.id) {
                                                ID_CONTENT_COMP_ALGO -> algo = readUnsigned(tracksElement, option)?.toInt() ?: 0
                                                ID_CONTENT_COMP_SETTINGS -> settings = option.endWithin(compressionEnd)?.let { tracksElement.copyOfRange(option.dataStart, it) }
                                            }
                                        }
                                    }
                                }
                            }
                            if (encodingType == 0L && algo != null) {
                                compression = algo
                                stripped = settings
                            }
                        }
                    }
                }
            }
            val trackNumber = number ?: return@forEachChild
            if (type != TRACK_TYPE_SUBTITLE || !codecId.equals(MATROSKA_PGS_CODEC_ID, ignoreCase = true)) return@forEachChild
            result += PgsTrackSpec(
                number = trackNumber,
                language = languageIetf?.takeIf { it.isNotBlank() } ?: language?.takeIf { it.isNotBlank() } ?: "eng",
                name = name?.takeIf { it.isNotBlank() },
                forced = forced,
                hearingImpaired = hearingImpaired,
                commentary = commentary,
                isDefault = isDefault,
                compression = compression,
                strippedHeader = stripped,
            )
        }
        return result
    }

    private fun parsePgsCues(cuesElement: ByteArray, trackNumber: Int): List<PgsCue> {
        val root = readElement(cuesElement, 0, cuesElement.size) ?: return emptyList()
        if (root.id != ID_CUES) return emptyList()
        val rootEnd = root.endWithin(cuesElement.size) ?: return emptyList()
        val result = mutableListOf<PgsCue>()
        forEachChild(cuesElement, root.dataStart, rootEnd) { point ->
            if (point.id != ID_CUE_POINT) return@forEachChild
            val pointEnd = point.endWithin(rootEnd) ?: return@forEachChild
            var time: Long? = null
            val found = mutableListOf<Pair<Long, Long?>>()
            forEachChild(cuesElement, point.dataStart, pointEnd) { child ->
                when (child.id) {
                    ID_CUE_TIME -> time = readUnsigned(cuesElement, child)
                    ID_CUE_TRACK_POSITIONS -> {
                        val positionEnd = child.endWithin(pointEnd) ?: return@forEachChild
                        var cueTrack: Int? = null
                        var cluster: Long? = null
                        var relative: Long? = null
                        forEachChild(cuesElement, child.dataStart, positionEnd) { part ->
                            when (part.id) {
                                ID_CUE_TRACK -> cueTrack = readUnsigned(cuesElement, part)?.toInt()
                                ID_CUE_CLUSTER_POSITION -> cluster = readUnsigned(cuesElement, part)
                                ID_CUE_RELATIVE_POSITION -> relative = readUnsigned(cuesElement, part)
                            }
                        }
                        val clusterPosition = cluster
                        if (cueTrack == trackNumber && clusterPosition != null) found += clusterPosition to relative
                    }
                }
            }
            val ticks = time ?: return@forEachChild
            found.forEach { (cluster, relative) -> result += PgsCue(ticks, cluster, relative) }
        }
        return result.distinctBy { "${it.clusterPosition}:${it.relativePosition}:${it.ticks}" }.sortedBy { it.ticks }
    }

    private suspend fun loadAndCache(
        cacheKey: String,
        sourceUrl: String,
        sourceHeaders: Map<String, String>,
    ): DesktopIndexedEmbeddedTimeline? {
        return try {
            val loaded = try {
                withTimeout(TOTAL_TIMEOUT_MS) {
                    withContext(Dispatchers.IO) {
                        loadMatroskaCueIndex(sourceUrl, sourceHeaders)
                    }
                }
            } catch (_: TimeoutCancellationException) {
                // A transient deadline is not evidence that the container is unsupported.
                // Do not publish a negative cache entry for timed-out work.
                return null
            }

            synchronized(cacheLock) {
                cache[cacheKey] = CachedLoadResult(
                    timeline = loaded,
                    createdAtNs = System.nanoTime(),
                )
            }
            loaded
        } catch (cancel: CancellationException) {
            // External cancellation must remain observable and must never publish cache state.
            throw cancel
        } catch (_: Exception) {
            synchronized(cacheLock) {
                cache[cacheKey] = CachedLoadResult(
                    timeline = null,
                    createdAtNs = System.nanoTime(),
                )
            }
            null
        }
    }

    private suspend fun loadMatroskaCueIndex(
        sourceUrl: String,
        sourceHeaders: Map<String, String>,
    ): DesktopIndexedEmbeddedTimeline? {
        val startedAtNs = System.nanoTime()
        val stats = RangeStats(
            deadlineNs = System.nanoTime() + TOTAL_TIMEOUT_MS * 1_000_000L,
            maxBytes = MAX_TOTAL_DOWNLOAD_BYTES,
            maxRequests = MAX_RANGE_REQUESTS,
        )
        val initial = fetchRange(
            sourceUrl = sourceUrl,
            sourceHeaders = sourceHeaders,
            start = 0L,
            length = INITIAL_PROBE_BYTES,
            requirePartialContent = false,
            stats = stats,
        ) ?: return null

        val segment = findSegment(initial.bytes)
        // Desktop indexes Matroska/WebM only; MP4 needs Media3's box parser.
        if (segment == null) return null

        val initialMetadata = InitialMetadata(
            segmentDataStart = segment.dataStart.toLong(),
            directPositions = findInitialTopLevelPositions(
                bytes = initial.bytes,
                segment = segment,
            ),
            totalLength = initial.totalLength,
            initialBytes = initial.bytes,
        )
        val segmentDataStart = initialMetadata.segmentDataStart
        val directPositions = initialMetadata.directPositions

        // Resolve SeekHead chains. SeekPosition is relative to Segment payload start.
        val resolvedPositions = mutableMapOf<Long, Long>()
        directPositions.forEach { (id, position) -> resolvedPositions.putIfAbsent(id, position) }

        val seekHeadQueue = ArrayDeque<Long>()
        directPositions[ID_SEEK_HEAD]?.let(seekHeadQueue::addLast)
        val visitedSeekHeads = mutableSetOf<Long>()
        var seekHeadHops = 0

        while (seekHeadQueue.isNotEmpty() && seekHeadHops < MAX_SEEK_HEAD_HOPS) {
            val seekHeadPosition = seekHeadQueue.removeFirst()
            if (!visitedSeekHeads.add(seekHeadPosition)) continue
            seekHeadHops++

            val seekHeadBytes = extractElementFromInitialProbe(
                initialBytes = initialMetadata.initialBytes,
                absolutePosition = seekHeadPosition,
                expectedId = ID_SEEK_HEAD,
                maxElementBytes = MAX_SEEK_HEAD_BYTES,
            ) ?: fetchElementAt(
                sourceUrl = sourceUrl,
                sourceHeaders = sourceHeaders,
                absolutePosition = seekHeadPosition,
                expectedId = ID_SEEK_HEAD,
                maxElementBytes = MAX_SEEK_HEAD_BYTES,
                stats = stats,
            ) ?: continue

            parseSeekHead(seekHeadBytes).forEach { (id, relativePosition) ->
                val absolute = segmentDataStart + relativePosition
                if (resolvedPositions.putIfAbsent(id, absolute) == null && id == ID_SEEK_HEAD) {
                    seekHeadQueue.addLast(absolute)
                } else if (id == ID_SEEK_HEAD && absolute !in visitedSeekHeads) {
                    seekHeadQueue.addLast(absolute)
                }
            }
        }

        val infoPosition = resolvedPositions[ID_INFO] ?: directPositions[ID_INFO]
        val timestampScaleNs = infoPosition
            ?.let { position ->
                extractElementFromInitialProbe(
                    initialBytes = initialMetadata.initialBytes,
                    absolutePosition = position,
                    expectedId = ID_INFO,
                    maxElementBytes = MAX_INFO_BYTES,
                ) ?: fetchElementAt(
                    sourceUrl = sourceUrl,
                    sourceHeaders = sourceHeaders,
                    absolutePosition = position,
                    expectedId = ID_INFO,
                    maxElementBytes = MAX_INFO_BYTES,
                    stats = stats,
                )
            }
            ?.let(::parseTimestampScaleNs)
            ?: DEFAULT_TIMESTAMP_SCALE_NS

        val tracksPosition = resolvedPositions[ID_TRACKS] ?: directPositions[ID_TRACKS]
            ?: return null
        val subtitleTracks = (
            extractElementFromInitialProbe(
                initialBytes = initialMetadata.initialBytes,
                absolutePosition = tracksPosition,
                expectedId = ID_TRACKS,
                maxElementBytes = MAX_TRACKS_BYTES,
            ) ?: fetchElementAt(
                sourceUrl = sourceUrl,
                sourceHeaders = sourceHeaders,
                absolutePosition = tracksPosition,
                expectedId = ID_TRACKS,
                maxElementBytes = MAX_TRACKS_BYTES,
                stats = stats,
            )
            )?.let(::parseSubtitleTracks).orEmpty()
        if (subtitleTracks.isEmpty()) {
            return DesktopIndexedEmbeddedTimeline(
                tracks = emptyList(),
                source = "matroska-no-subtitle-tracks",
                bytesDownloaded = stats.bytesDownloaded,
                rangeRequests = stats.requests,
                loadMs = (System.nanoTime() - startedAtNs) / 1_000_000L,
                skipLiveFallbackWait = true,
                noSubtitleTracks = true,
            )
        }

        val cuesPosition = resolvedPositions[ID_CUES] ?: directPositions[ID_CUES]
        val parsedCues = if (cuesPosition != null) {
            (
                extractElementFromInitialProbe(
                    initialBytes = initialMetadata.initialBytes,
                    absolutePosition = cuesPosition,
                    expectedId = ID_CUES,
                    maxElementBytes = MAX_CUES_BYTES,
                ) ?: fetchElementAt(
                    sourceUrl = sourceUrl,
                    sourceHeaders = sourceHeaders,
                    absolutePosition = cuesPosition,
                    expectedId = ID_CUES,
                    maxElementBytes = MAX_CUES_BYTES,
                    stats = stats,
                )
                )?.let { cuesBytes ->
                parseSubtitleCueTimelines(
                    cuesElement = cuesBytes,
                    subtitleTracks = subtitleTracks,
                    timestampScaleNs = timestampScaleNs,
                )
            }
        } else {
            null
        } ?: findAndParseCuesNearFileEnd(
            sourceUrl = sourceUrl,
            sourceHeaders = sourceHeaders,
            totalLength = initialMetadata.totalLength,
            subtitleTracks = subtitleTracks,
            timestampScaleNs = timestampScaleNs,
            stats = stats,
        ) ?: return null

        if (subtitleTracks.all { track -> parsedCues[track.number]?.cues.orEmpty().isEmpty() }) {
            return DesktopIndexedEmbeddedTimeline(
                tracks = emptyList(),
                source = "matroska-cues-no-subtitle-entries",
                bytesDownloaded = stats.bytesDownloaded,
                rangeRequests = stats.requests,
                loadMs = (System.nanoTime() - startedAtNs) / 1_000_000L,
                skipLiveFallbackWait = true,
            )
        }

        val referenceTracks = subtitleTracks.mapNotNull { track ->
            val parsedTimeline = parsedCues[track.number] ?: return@mapNotNull null
            val cues = parsedTimeline.cues
                .sortedBy { it.startTimeMs }
                .distinctBy { it.startTimeMs }
            if (cues.size < MIN_INDEXED_CUES) return@mapNotNull null
            val spanMs = cues.last().startTimeMs - cues.first().startTimeMs
            if (spanMs < MIN_INDEXED_SPAN_MS) return@mapNotNull null

            var selectionFlags = 0
            if (track.forced) selectionFlags = selectionFlags or SELECTION_FLAG_FORCED

            var roleFlags = 0
            if (track.commentary) roleFlags = roleFlags or ROLE_FLAG_COMMENTARY
            if (track.hearingImpaired) {
                roleFlags = roleFlags or ROLE_FLAG_HEARING_IMPAIRED
            }
            if (track.visualImpaired || track.textDescriptions) {
                roleFlags = roleFlags or ROLE_FLAG_DESCRIBES_VIDEO
            }

            DesktopReferenceTrack(
                key = "mkv-cues:${track.number}",
                language = track.languageIetf?.takeIf { it.isNotBlank() }
                    ?: track.language?.takeIf { it.isNotBlank() },
                cues = cues,
                label = track.name?.takeIf { it.isNotBlank() }
                    ?: buildFallbackTrackLabel(track),
                selectionFlags = selectionFlags,
                roleFlags = roleFlags,
                generation = -1L,
                estimatedEndStartsMs = parsedTimeline.estimatedEndStartsMs,
            )
        }

        if (referenceTracks.isEmpty()) {
            return null
        }

        return DesktopIndexedEmbeddedTimeline(
            tracks = referenceTracks,
            source = "matroska-cues",
            bytesDownloaded = stats.bytesDownloaded,
            rangeRequests = stats.requests,
            loadMs = (System.nanoTime() - startedAtNs) / 1_000_000L,
        )
    }

    private suspend fun findAndParseCuesNearFileEnd(
        sourceUrl: String,
        sourceHeaders: Map<String, String>,
        totalLength: Long?,
        subtitleTracks: List<MatroskaSubtitleTrack>,
        timestampScaleNs: Long,
        stats: RangeStats,
    ): Map<Int, IndexedSubtitleTimeline>? {
        val fileLength = totalLength?.takeIf { it > 0L } ?: return null
        val start = max(0L, fileLength - TAIL_PROBE_BYTES)
        if (start == 0L) return null
        val tailLength = (fileLength - start).coerceAtMost(TAIL_PROBE_BYTES.toLong()).toInt()
        val candidates = fetchRange(
            sourceUrl = sourceUrl,
            sourceHeaders = sourceHeaders,
            start = start,
            length = tailLength,
            requirePartialContent = true,
            stats = stats,
        )?.let { tail ->
            findElementIdOffsets(tail.bytes, ID_CUES).asReversed()
        } ?: return null
        for (relativeOffset in candidates) {
            val absolute = start + relativeOffset
            val cuesBytes = fetchElementAt(
                sourceUrl = sourceUrl,
                sourceHeaders = sourceHeaders,
                absolutePosition = absolute,
                expectedId = ID_CUES,
                maxElementBytes = MAX_CUES_BYTES,
                stats = stats,
            ) ?: continue
            val parsed = parseSubtitleCueTimelines(
                cuesElement = cuesBytes,
                subtitleTracks = subtitleTracks,
                timestampScaleNs = timestampScaleNs,
            )
            if (parsed.values.any { timeline -> timeline.cues.size >= MIN_INDEXED_CUES }) return parsed
        }
        return null
    }

    private fun findSegment(bytes: ByteArray): EbmlElement? {
        var position = 0
        var elementCount = 0
        while (position < bytes.size && elementCount++ < 32) {
            val element = readElement(bytes, position, bytes.size) ?: return null
            if (element.id == ID_SEGMENT) return element
            if (element.id == ID_EBML) {
                val end = element.endWithin(bytes.size) ?: return null
                position = end
                continue
            }
            val end = element.endWithin(bytes.size) ?: return null
            position = end
        }
        return null
    }

    private fun findInitialTopLevelPositions(
        bytes: ByteArray,
        segment: EbmlElement,
    ): Map<Long, Long> {
        val result = mutableMapOf<Long, Long>()
        var position = segment.dataStart
        var elementCount = 0
        while (position < bytes.size && elementCount++ < 128) {
            val element = readElement(bytes, position, bytes.size) ?: break
            when (element.id) {
                ID_SEEK_HEAD, ID_INFO, ID_TRACKS, ID_CUES ->
                    result.putIfAbsent(element.id, position.toLong())
                ID_CLUSTER -> break
            }
            val end = element.endWithin(bytes.size) ?: break
            position = end
        }
        return result
    }

    private fun parseSeekHead(seekHeadElement: ByteArray): Map<Long, Long> {
        val root = readElement(seekHeadElement, 0, seekHeadElement.size) ?: return emptyMap()
        if (root.id != ID_SEEK_HEAD) return emptyMap()
        val rootEnd = root.endWithin(seekHeadElement.size) ?: return emptyMap()
        val result = mutableMapOf<Long, Long>()

        forEachChild(seekHeadElement, root.dataStart, rootEnd) { seek ->
            if (seek.id != ID_SEEK) return@forEachChild
            val seekEnd = seek.endWithin(rootEnd) ?: return@forEachChild
            var targetId: Long? = null
            var position: Long? = null
            forEachChild(seekHeadElement, seek.dataStart, seekEnd) { child ->
                when (child.id) {
                    ID_SEEK_ID -> targetId = readBinaryId(seekHeadElement, child)
                    ID_SEEK_POSITION -> position = readUnsigned(seekHeadElement, child)
                }
            }
            val id = targetId
            val relativePosition = position
            if (id != null && relativePosition != null) {
                result.putIfAbsent(id, relativePosition)
            }
        }
        return result
    }

    private fun parseTimestampScaleNs(infoElement: ByteArray): Long {
        val root = readElement(infoElement, 0, infoElement.size) ?: return DEFAULT_TIMESTAMP_SCALE_NS
        if (root.id != ID_INFO) return DEFAULT_TIMESTAMP_SCALE_NS
        val rootEnd = root.endWithin(infoElement.size) ?: return DEFAULT_TIMESTAMP_SCALE_NS
        var scale = DEFAULT_TIMESTAMP_SCALE_NS
        forEachChild(infoElement, root.dataStart, rootEnd) { child ->
            if (child.id == ID_TIMESTAMP_SCALE) {
                readUnsigned(infoElement, child)?.takeIf { it > 0L }?.let { scale = it }
            }
        }
        return scale
    }

    private fun parseSubtitleTracks(tracksElement: ByteArray): List<MatroskaSubtitleTrack> {
        val root = readElement(tracksElement, 0, tracksElement.size) ?: return emptyList()
        if (root.id != ID_TRACKS) return emptyList()
        val rootEnd = root.endWithin(tracksElement.size) ?: return emptyList()
        val result = mutableListOf<MatroskaSubtitleTrack>()

        forEachChild(tracksElement, root.dataStart, rootEnd) { entry ->
            if (entry.id != ID_TRACK_ENTRY) return@forEachChild
            val entryEnd = entry.endWithin(rootEnd) ?: return@forEachChild

            var number: Int? = null
            var type: Long? = null
            var name: String? = null
            var language: String? = null
            var languageIetf: String? = null
            var codecId: String? = null
            var isDefault = true
            var forced = false
            var hearingImpaired = false
            var visualImpaired = false
            var textDescriptions = false
            var commentary = false

            forEachChild(tracksElement, entry.dataStart, entryEnd) { child ->
                when (child.id) {
                    ID_TRACK_NUMBER -> number = readUnsigned(tracksElement, child)?.toInt()
                    ID_TRACK_TYPE -> type = readUnsigned(tracksElement, child)
                    ID_NAME -> name = readUtf8(tracksElement, child)
                    ID_LANGUAGE -> language = readUtf8(tracksElement, child)
                    ID_LANGUAGE_IETF -> languageIetf = readUtf8(tracksElement, child)
                    ID_CODEC_ID -> codecId = readUtf8(tracksElement, child)
                    ID_FLAG_DEFAULT -> isDefault = readUnsigned(tracksElement, child) != 0L
                    ID_FLAG_FORCED -> forced = readUnsigned(tracksElement, child) == 1L
                    ID_FLAG_HEARING_IMPAIRED -> hearingImpaired = readUnsigned(tracksElement, child) == 1L
                    ID_FLAG_VISUAL_IMPAIRED -> visualImpaired = readUnsigned(tracksElement, child) == 1L
                    ID_FLAG_TEXT_DESCRIPTIONS -> textDescriptions = readUnsigned(tracksElement, child) == 1L
                    ID_FLAG_COMMENTARY -> commentary = readUnsigned(tracksElement, child) == 1L
                }
            }

            val trackNumber = number
            if (trackNumber != null && type == TRACK_TYPE_SUBTITLE) {
                result += MatroskaSubtitleTrack(
                    number = trackNumber,
                    name = name,
                    language = language,
                    languageIetf = languageIetf,
                    codecId = codecId,
                    isDefault = isDefault,
                    forced = forced,
                    hearingImpaired = hearingImpaired,
                    visualImpaired = visualImpaired,
                    textDescriptions = textDescriptions,
                    commentary = commentary,
                )
            }
        }
        return result
    }

    private fun parseSubtitleCueTimelines(
        cuesElement: ByteArray,
        subtitleTracks: List<MatroskaSubtitleTrack>,
        timestampScaleNs: Long,
    ): Map<Int, IndexedSubtitleTimeline> {
        val root = readElement(cuesElement, 0, cuesElement.size) ?: return emptyMap()
        if (root.id != ID_CUES) return emptyMap()
        val rootEnd = root.endWithin(cuesElement.size) ?: return emptyMap()
        val subtitleTrackNumbers = subtitleTracks.mapTo(mutableSetOf()) { it.number }
        val pendingByTrack = subtitleTrackNumbers.associateWith { mutableListOf<PendingIndexedCue>() }
            .toMutableMap()

        forEachChild(cuesElement, root.dataStart, rootEnd) { cuePoint ->
            if (cuePoint.id != ID_CUE_POINT) return@forEachChild
            val pointEnd = cuePoint.endWithin(rootEnd) ?: return@forEachChild
            var cueTimeTicks: Long? = null
            val positions = mutableListOf<CueTrackPosition>()

            forEachChild(cuesElement, cuePoint.dataStart, pointEnd) { child ->
                when (child.id) {
                    ID_CUE_TIME -> cueTimeTicks = readUnsigned(cuesElement, child)
                    ID_CUE_TRACK_POSITIONS -> {
                        val positionEnd = child.endWithin(pointEnd)
                        if (positionEnd != null) {
                            var trackNumber: Int? = null
                            var durationTicks: Long? = null
                            forEachChild(cuesElement, child.dataStart, positionEnd) { positionChild ->
                                when (positionChild.id) {
                                    ID_CUE_TRACK -> trackNumber = readUnsigned(cuesElement, positionChild)?.toInt()
                                    ID_CUE_DURATION -> durationTicks = readUnsigned(cuesElement, positionChild)
                                }
                            }
                            trackNumber?.let { positions += CueTrackPosition(it, durationTicks) }
                        }
                    }
                }
            }

            val timeTicks = cueTimeTicks ?: return@forEachChild
            val startMs = ticksToMs(timeTicks, timestampScaleNs) ?: return@forEachChild
            positions.forEach { position ->
                if (position.trackNumber !in subtitleTrackNumbers) return@forEach
                val durationMs = position.durationTicks
                    ?.let { ticksToMs(it, timestampScaleNs) }
                    ?.takeIf { it > 0L }
                pendingByTrack[position.trackNumber]?.add(
                    PendingIndexedCue(
                        startTimeMs = startMs,
                        explicitDurationMs = durationMs,
                    ),
                )
            }
        }

        val tracksByNumber = subtitleTracks.associateBy { it.number }
        val peerDialogueCueCounts = subtitleTracks
            .asSequence()
            .filter { track ->
                !track.codecId.equals(MATROSKA_PGS_CODEC_ID, ignoreCase = true) &&
                    !track.forced &&
                    !track.commentary
            }
            .mapNotNull { track ->
                pendingByTrack[track.number]
                    ?.size
                    ?.takeIf { it >= MIN_INDEXED_CUES }
            }
            .sorted()
            .toList()
        val peerDialogueCueCount = peerDialogueCueCounts
            .takeIf { it.isNotEmpty() }
            ?.let { counts -> counts[counts.size / 2] }

        return pendingByTrack.mapValues { (trackNumber, pending) ->
            val sorted = pending
                .sortedBy { it.startTimeMs }
                .distinctBy { it.startTimeMs }

            if (tracksByNumber[trackNumber]?.codecId.equals(MATROSKA_PGS_CODEC_ID, ignoreCase = true)) {
                buildPgsIndexedTimeline(
                    sorted = sorted,
                    peerDialogueCueCount = peerDialogueCueCount,
                )
            } else {
                buildDefaultIndexedTimeline(sorted)
            }
        }
    }

    /**
     * PGS commonly indexes both a visible display and the later clear display set. AutoSync only
     * needs the resulting visibility interval, not the bitmap. Pair those events only when that
     * interpretation is supported by peer text-track density (when available); otherwise preserve
     * the original cue timeline. This keeps the fast O(n), zero-extra-I/O path conservative.
     */
    private fun buildPgsIndexedTimeline(
        sorted: List<PendingIndexedCue>,
        peerDialogueCueCount: Int?,
    ): IndexedSubtitleTimeline {
        if (sorted.size < 2) {
            return IndexedSubtitleTimeline(
                cues = emptyList(),
                estimatedEndStartsMs = emptySet(),
            )
        }

        val pairedCount = sorted.size / 2
        val explicitDurationCount = sorted.count { (it.explicitDurationMs ?: 0L) > 0L }
        val shouldPair = if (peerDialogueCueCount != null) {
            val rawDelta = if (sorted.size >= peerDialogueCueCount) {
                sorted.size - peerDialogueCueCount
            } else {
                peerDialogueCueCount - sorted.size
            }
            val pairedDelta = if (pairedCount >= peerDialogueCueCount) {
                pairedCount - peerDialogueCueCount
            } else {
                peerDialogueCueCount - pairedCount
            }

            // Require a material improvement, not a marginal count coincidence.
            pairedDelta.toLong() * 3L <= rawDelta.toLong() * 2L
        } else {
            // With no peer text track, explicit durations on most entries are evidence that the
            // index already represents visible cues rather than alternating display/clear events.
            explicitDurationCount.toLong() * 4L < sorted.size.toLong() * 3L
        }

        if (!shouldPair) {
            return buildDefaultIndexedTimeline(sorted)
        }

        val cues = ArrayList<SubtitleSyncCue>(pairedCount)
        var index = 0
        while (index + 1 < sorted.size) {
            val display = sorted[index]
            val clear = sorted[index + 1]
            if (clear.startTimeMs > display.startTimeMs) {
                val explicitEndMs = display.explicitDurationMs
                    ?.takeIf { duration ->
                        duration > 0L && display.startTimeMs <= Long.MAX_VALUE - duration
                    }
                    ?.let { duration -> display.startTimeMs + duration }
                val endTimeMs = explicitEndMs
                    ?.coerceAtMost(clear.startTimeMs)
                    ?: clear.startTimeMs

                if (endTimeMs > display.startTimeMs) {
                    cues += SubtitleSyncCue(
                        startTimeMs = display.startTimeMs,
                        endTimeMs = endTimeMs,
                        text = "",
                    )
                }
            }
            index += 2
        }

        return IndexedSubtitleTimeline(
            cues = cues,
            estimatedEndStartsMs = emptySet(),
        )
    }

    private fun buildDefaultIndexedTimeline(
        sorted: List<PendingIndexedCue>,
    ): IndexedSubtitleTimeline {
        val estimatedEndStartsMs = HashSet<Long>()

        val cues = sorted.mapIndexed { index, cue ->
            val durationMs = cue.explicitDurationMs ?: run {
                estimatedEndStartsMs += cue.startTimeMs
                val nextStartMs = sorted.getOrNull(index + 1)?.startTimeMs
                if (nextStartMs != null && nextStartMs > cue.startTimeMs) {
                    (nextStartMs - cue.startTimeMs)
                        .coerceAtMost(MAX_MKV_INTER_CUE_ESTIMATED_DURATION_MS)
                        .coerceAtLeast(1L)
                } else {
                    LAST_MKV_CUE_ESTIMATED_DURATION_MS
                }
            }
            SubtitleSyncCue(
                startTimeMs = cue.startTimeMs,
                endTimeMs = cue.startTimeMs + durationMs,
                text = "",
            )
        }

        return IndexedSubtitleTimeline(
            cues = cues,
            estimatedEndStartsMs = estimatedEndStartsMs,
        )
    }

    private fun buildFallbackTrackLabel(track: MatroskaSubtitleTrack): String {
        val language = track.languageIetf?.takeIf { it.isNotBlank() }
            ?: track.language?.takeIf { it.isNotBlank() }
            ?: "Subtitle"
        val suffix = when {
            track.commentary -> " [Commentary]"
            track.forced -> " [Forced]"
            track.hearingImpaired -> " [SDH]"
            else -> " [Full]"
        }
        return language + suffix
    }

    private fun ticksToMs(ticks: Long, timestampScaleNs: Long): Long? {
        if (ticks < 0L || timestampScaleNs <= 0L) return null
        if (ticks > Long.MAX_VALUE / timestampScaleNs) {
            return ((ticks.toDouble() * timestampScaleNs.toDouble()) / 1_000_000.0)
                .takeIf { it.isFinite() && it >= 0.0 && it <= Long.MAX_VALUE.toDouble() }
                ?.toLong()
        }
        return ticks * timestampScaleNs / 1_000_000L
    }

    /**
     * Reuse the first 512 KiB probe whenever it already contains a complete metadata element.
     * Matroska SeekHead/Info/Tracks are commonly near the beginning of the file, so this removes
     * whole network round-trips without changing parsing or range-request fallback behavior.
     */
    private fun extractElementFromInitialProbe(
        initialBytes: ByteArray,
        absolutePosition: Long,
        expectedId: Long,
        maxElementBytes: Int,
    ): ByteArray? {
        if (absolutePosition < 0L || absolutePosition > Int.MAX_VALUE.toLong()) return null
        val start = absolutePosition.toInt()
        if (start < 0 || start >= initialBytes.size) return null

        val header = readElement(initialBytes, start, initialBytes.size) ?: return null
        if (header.id != expectedId || header.size == null) return null
        val totalSize = header.headerSize.toLong() + header.size
        if (totalSize <= 0L || totalSize > maxElementBytes.toLong()) return null

        val end = start.toLong() + totalSize
        if (end > initialBytes.size.toLong() || end > Int.MAX_VALUE.toLong()) return null
        return initialBytes.copyOfRange(start, end.toInt())
    }

    private suspend fun fetchElementAt(
        sourceUrl: String,
        sourceHeaders: Map<String, String>,
        absolutePosition: Long,
        expectedId: Long,
        maxElementBytes: Int,
        stats: RangeStats,
    ): ByteArray? {
        if (absolutePosition < 0L) return null
        val headerProbe = fetchRange(
            sourceUrl = sourceUrl,
            sourceHeaders = sourceHeaders,
            start = absolutePosition,
            length = HEADER_PROBE_BYTES,
            requirePartialContent = absolutePosition > 0L,
            stats = stats,
        ) ?: return null
        val header = readElement(headerProbe.bytes, 0, headerProbe.bytes.size) ?: return null
        if (header.id != expectedId || header.size == null) return null
        val totalSize = header.headerSize.toLong() + header.size
        if (totalSize <= 0L) return null
        if (totalSize > maxElementBytes.toLong()) {
            return null
        }
        if (totalSize > stats.remainingByteBudget()) {
            return null
        }
        if (totalSize <= headerProbe.bytes.size) {
            return if (totalSize == headerProbe.bytes.size.toLong()) {
                headerProbe.bytes
            } else {
                // At most HEADER_PROBE_BYTES (64 B), so this tiny trim is intentionally harmless.
                headerProbe.bytes.copyOf(totalSize.toInt())
            }
        }

        // The large element is read directly into one exact-size array. Avoid ByteArrayOutputStream
        // and a second copy, which matters for a multi-megabyte Cues index.
        return fetchRange(
            sourceUrl = sourceUrl,
            sourceHeaders = sourceHeaders,
            start = absolutePosition,
            length = totalSize.toInt(),
            requirePartialContent = absolutePosition > 0L,
            stats = stats,
            requireExactLength = true,
        )?.bytes
    }

    private suspend fun fetchRange(
        sourceUrl: String,
        sourceHeaders: Map<String, String>,
        start: Long,
        length: Int,
        requirePartialContent: Boolean,
        stats: RangeStats,
        requireExactLength: Boolean = false,
    ): RangeResponse? {
        if (length <= 0 || start < 0L) return null
        if (!stats.canRequest(length)) return null
        val end = start + length - 1L
        if (end < start) return null

        val requestBuilder = Request.Builder()
            .url(sourceUrl)
            .header("Range", "bytes=$start-$end")
            .header("Accept-Encoding", "identity")

        sourceHeaders.forEach { (name, value) ->
            if (!name.equals("Range", ignoreCase = true) &&
                !name.equals("Accept-Encoding", ignoreCase = true) &&
                !name.equals("Content-Length", ignoreCase = true) &&
                !name.equals("Host", ignoreCase = true)
            ) {
                requestBuilder.header(name, value)
            }
        }

        val remainingBudgetMs = stats.remainingBudgetMs()
        if (remainingBudgetMs <= 0L) return null

        stats.requests++
        val call = httpClient.newCall(requestBuilder.build())
        call.timeout().timeout(
            minOf(remainingBudgetMs.coerceAtLeast(1L), 5_000L),
            TimeUnit.MILLISECONDS,
        )

        return suspendCancellableCoroutine { continuation ->
            // OkHttp's async API lets structured coroutine cancellation interrupt DNS/connect/
            // headers/body reads immediately instead of waiting for blocking execute() to return.
            continuation.invokeOnCancellation {
                call.cancel()
            }

            call.enqueue(
                object : Callback {
                    override fun onFailure(call: Call, error: java.io.IOException) {
                        if (!continuation.isActive) return
                        if (call.isCanceled()) {
                            continuation.resumeWith(
                                Result.failure(
                                    CancellationException(
                                        "Cancelled embedded index HTTP request",
                                    ).also { it.initCause(error) },
                                ),
                            )
                        } else {
                            continuation.resumeWith(Result.failure(error))
                        }
                    }

                    override fun onResponse(call: Call, response: Response) {
                        if (!continuation.isActive) {
                            response.close()
                            return
                        }

                        try {
                            val result = response.use { current ->
                                if (!current.isSuccessful) return@use null
                                if (requirePartialContent && current.code != 206) return@use null
                                if (start > 0L && current.code != 206) return@use null

                                val contentRange = parseContentRange(
                                    current.header("Content-Range"),
                                )
                                if (current.code == 206) {
                                    val parsedRange = contentRange ?: return@use null
                                    if (parsedRange.start != start) return@use null
                                }

                                val body = current.body ?: return@use null
                                val input = body.byteStream()
                                val bytes = ByteArray(length)
                                var offset = 0
                                while (offset < length) {
                                    if (
                                        stats.remainingBudgetMs() <= 0L ||
                                        stats.remainingByteBudget() <= 0L
                                    ) {
                                        return@use null
                                    }
                                    val allowedRead = minOf(
                                        length - offset,
                                        stats.remainingByteBudget()
                                            .coerceAtMost(Int.MAX_VALUE.toLong())
                                            .toInt(),
                                    )
                                    if (allowedRead <= 0) return@use null
                                    val read = input.read(bytes, offset, allowedRead)
                                    if (read < 0) break
                                    if (read == 0) continue
                                    offset += read
                                    stats.bytesDownloaded += read.toLong()
                                }
                                if (offset == 0) return@use null
                                if (requireExactLength && offset != length) return@use null

                                val returnedBytes =
                                    if (offset == length) bytes else bytes.copyOf(offset)
                                val totalLength = contentRange?.total
                                    ?: if (current.code == 200) {
                                        current.header("Content-Length")?.toLongOrNull()
                                    } else {
                                        null
                                    }
                                RangeResponse(
                                    bytes = returnedBytes,
                                    totalLength = totalLength,
                                )
                            }

                            if (continuation.isActive) {
                                continuation.resumeWith(Result.success(result))
                            }
                        } catch (error: Throwable) {
                            if (!continuation.isActive) return
                            if (call.isCanceled() && error !is CancellationException) {
                                continuation.resumeWith(
                                    Result.failure(
                                        CancellationException(
                                            "Cancelled embedded index HTTP request",
                                        ).also { it.initCause(error) },
                                    ),
                                )
                            } else {
                                continuation.resumeWith(Result.failure(error))
                            }
                        }
                    }
                },
            )
        }
    }

    private fun parseContentRange(value: String?): ContentRange? {
        if (value.isNullOrBlank()) return null
        val trimmed = value.trim()
        if (!trimmed.startsWith("bytes ", ignoreCase = true)) return null
        val rangeAndTotal = trimmed.substringAfter(' ').split('/', limit = 2)
        if (rangeAndTotal.size != 2) return null
        val bounds = rangeAndTotal[0].split('-', limit = 2)
        val start = bounds.getOrNull(0)?.toLongOrNull()
        val end = bounds.getOrNull(1)?.toLongOrNull()
        val total = rangeAndTotal[1].takeIf { it != "*" }?.toLongOrNull()
        if (start != null && end != null && end < start) return null
        return ContentRange(start = start, end = end, total = total)
    }

    private fun findElementIdOffsets(bytes: ByteArray, id: Long): List<Int> {
        val idBytes = elementIdBytes(id)
        if (idBytes.isEmpty() || bytes.size < idBytes.size) return emptyList()
        val result = mutableListOf<Int>()
        outer@ for (index in 0..bytes.size - idBytes.size) {
            for (offset in idBytes.indices) {
                if (bytes[index + offset] != idBytes[offset]) continue@outer
            }
            val parsed = readElement(bytes, index, bytes.size)
            if (parsed?.id == id && parsed.size != null) result += index
        }
        return result
    }

    private fun elementIdBytes(id: Long): ByteArray {
        var length = 1
        while (length < 8 && id >= (1L shl (length * 8))) length++
        return ByteArray(length) { index ->
            ((id shr ((length - index - 1) * 8)) and 0xFF).toByte()
        }
    }

    private fun forEachChild(
        bytes: ByteArray,
        start: Int,
        endExclusive: Int,
        action: (EbmlElement) -> Unit,
    ) {
        var position = start
        var count = 0
        while (position < endExclusive && count++ < 1_000_000) {
            val child = readElement(bytes, position, endExclusive) ?: break
            val end = child.endWithin(endExclusive) ?: break
            action(child)
            if (end <= position) break
            position = end
        }
    }

    private fun readElement(bytes: ByteArray, offset: Int, limit: Int): EbmlElement? {
        if (offset < 0 || offset >= limit || limit > bytes.size) return null
        val idLength = vintLength(bytes[offset].toInt() and 0xFF) ?: return null
        if (idLength > 4 || offset + idLength >= limit) return null

        var id = 0L
        for (index in 0 until idLength) {
            id = (id shl 8) or (bytes[offset + index].toLong() and 0xFFL)
        }

        val sizeOffset = offset + idLength
        val sizeLength = vintLength(bytes[sizeOffset].toInt() and 0xFF) ?: return null
        if (sizeLength > 8 || sizeOffset + sizeLength > limit) return null
        val markerMask = 1 shl (8 - sizeLength)
        var sizeValue = (bytes[sizeOffset].toInt() and (markerMask - 1)).toLong()
        for (index in 1 until sizeLength) {
            sizeValue = (sizeValue shl 8) or (bytes[sizeOffset + index].toLong() and 0xFFL)
        }
        val unknownValue = (1L shl (7 * sizeLength)) - 1L
        val size = if (sizeValue == unknownValue) null else sizeValue
        val dataStart = sizeOffset + sizeLength
        return EbmlElement(
            id = id,
            size = size,
            headerStart = offset,
            dataStart = dataStart,
            headerSize = dataStart - offset,
        )
    }

    private fun vintLength(firstByte: Int): Int? {
        if (firstByte == 0) return null
        var mask = 0x80
        var length = 1
        while ((firstByte and mask) == 0) {
            mask = mask ushr 1
            length++
            if (length > 8) return null
        }
        return length
    }

    private fun readUnsigned(bytes: ByteArray, element: EbmlElement): Long? {
        val size = element.size ?: return null
        if (size !in 1L..8L) return null
        val end = element.dataStart + size.toInt()
        if (end > bytes.size) return null
        var value = 0L
        for (index in element.dataStart until end) {
            value = (value shl 8) or (bytes[index].toLong() and 0xFFL)
        }
        return value
    }

    private fun readBinaryId(bytes: ByteArray, element: EbmlElement): Long? {
        val size = element.size ?: return null
        if (size !in 1L..4L) return null
        val end = element.dataStart + size.toInt()
        if (end > bytes.size) return null
        var value = 0L
        for (index in element.dataStart until end) {
            value = (value shl 8) or (bytes[index].toLong() and 0xFFL)
        }
        return value
    }

    private fun readUtf8(bytes: ByteArray, element: EbmlElement): String? {
        val size = element.size ?: return null
        if (size < 0L || size > Int.MAX_VALUE) return null
        val end = element.dataStart + size.toInt()
        if (end > bytes.size) return null
        return bytes.copyOfRange(element.dataStart, end)
            .toString(Charsets.UTF_8)
            .trimEnd('\u0000')
    }




    private data class CachedLoadResult(
        val timeline: DesktopIndexedEmbeddedTimeline?,
        val createdAtNs: Long,
    )

    private data class RangeResponse(
        val bytes: ByteArray,
        val totalLength: Long?,
    )

    private data class RangeStats(
        var requests: Int = 0,
        var bytesDownloaded: Long = 0L,
        val deadlineNs: Long,
        val maxBytes: Long,
        val maxRequests: Int,
    ) {
        fun remainingBudgetMs(): Long =
            ((deadlineNs - System.nanoTime()) / 1_000_000L).coerceAtLeast(0L)

        fun remainingByteBudget(): Long =
            (maxBytes - bytesDownloaded).coerceAtLeast(0L)

        fun canRequest(length: Int): Boolean =
            length > 0 &&
                requests < maxRequests &&
                length.toLong() <= remainingByteBudget() &&
                remainingBudgetMs() > 0L
    }

    private data class ContentRange(
        val start: Long?,
        val end: Long?,
        val total: Long?,
    )

    private data class InitialMetadata(
        val segmentDataStart: Long,
        val directPositions: Map<Long, Long>,
        val totalLength: Long?,
        val initialBytes: ByteArray,
    )

    private data class EbmlElement(
        val id: Long,
        val size: Long?,
        val headerStart: Int,
        val dataStart: Int,
        val headerSize: Int,
    ) {
        fun endWithin(limit: Int): Int? {
            val contentSize = size ?: return null
            if (contentSize < 0L || contentSize > Int.MAX_VALUE) return null
            val end = dataStart.toLong() + contentSize
            if (end > limit.toLong()) return null
            return end.toInt()
        }
    }

    private data class MatroskaSubtitleTrack(
        val number: Int,
        val name: String?,
        val language: String?,
        val languageIetf: String?,
        val codecId: String?,
        val isDefault: Boolean,
        val forced: Boolean,
        val hearingImpaired: Boolean,
        val visualImpaired: Boolean,
        val textDescriptions: Boolean,
        val commentary: Boolean,
    )

    private data class CueTrackPosition(
        val trackNumber: Int,
        val durationTicks: Long?,
    )

    private data class PendingIndexedCue(
        val startTimeMs: Long,
        val explicitDurationMs: Long?,
    )

    private data class IndexedSubtitleTimeline(
        val cues: List<SubtitleSyncCue>,
        val estimatedEndStartsMs: Set<Long>,
    )
}

internal data class DesktopIndexedEmbeddedTimeline(
    val tracks: List<DesktopReferenceTrack>,
    val source: String,
    val bytesDownloaded: Long,
    val rangeRequests: Int,
    val loadMs: Long,
    val skipLiveFallbackWait: Boolean = false,
    val noSubtitleTracks: Boolean = false,
)

internal data class DesktopReferenceTrack(
    val key: String,
    val language: String?,
    val cues: List<SubtitleSyncCue>,
    val label: String? = null,
    val selectionFlags: Int = 0,
    val roleFlags: Int = 0,
    val generation: Long = 0L,
    val estimatedEndStartsMs: Set<Long> = emptySet(),
)

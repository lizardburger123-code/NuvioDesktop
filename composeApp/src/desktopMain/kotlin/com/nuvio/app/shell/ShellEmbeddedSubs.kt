package com.nuvio.app.shell

import com.nuvio.app.features.autosync.DesktopEmbeddedSubtitleTimelineLoader
import com.nuvio.app.features.autosync.DesktopEmbeddedSubtitleTimelineLoader.EmbeddedSubtitleInfo
import com.nuvio.app.features.streams.StreamDebridCacheState
import com.nuvio.app.features.streams.StreamItem
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.concurrent.ConcurrentHashMap

/**
 * The subtitle tracks inside a source's file, read from its header before anything plays. A
 * Blu-ray remux keeps the disc's own subtitles (PGS): for many films that includes the official
 * Arabic translation, which is better than anything on the subtitle sites.
 */
internal object ShellEmbeddedSubs {
    /** Two files at a time: each probe asks the debrid service for a link. */
    private val gate = Semaphore(2)
    private val found = ConcurrentHashMap<String, List<EmbeddedSubtitleInfo>>()
    private val unreadable = ConcurrentHashMap<String, Long>()
    private const val RETRY_UNREADABLE_MS = 10 * 60_000L

    private val uncachedMarker = Regex("⏳|\\[(TB|RD|AD|PM|DL|ED|OC|PKP|EN)\\s*download\\]|uncached|not cached", RegexOption.IGNORE_CASE)

    /**
     * Only files that are ready to stream: opening an uncached torrent's link would ask the debrid
     * service to start downloading it.
     */
    fun canProbe(stream: StreamItem): Boolean {
        val url = stream.playableDirectUrl ?: return false
        if (!url.startsWith("http://", true) && !url.startsWith("https://", true)) return false
        if (stream.debridCacheStatus?.state == StreamDebridCacheState.NOT_CACHED) return false
        val text = listOfNotNull(stream.name, stream.title, stream.description).joinToString(" ")
        return !uncachedMarker.containsMatchIn(text)
    }

    private fun cacheKey(stream: StreamItem): String =
        stream.behaviorHints.filename?.takeIf { it.isNotBlank() }?.let { "$it#${stream.behaviorHints.videoSize ?: 0}" }
            ?: stream.playableDirectUrl.orEmpty()

    /** The file's subtitle tracks, or null when it can't be read (not Matroska, not ready, too slow). */
    suspend fun probe(stream: StreamItem): List<EmbeddedSubtitleInfo>? {
        if (!canProbe(stream)) return null
        val key = cacheKey(stream)
        found[key]?.let { return it }
        unreadable[key]?.let { at -> if (System.currentTimeMillis() - at < RETRY_UNREADABLE_MS) return null }
        val url = stream.playableDirectUrl ?: return null
        val headers = stream.behaviorHints.proxyHeaders?.request.orEmpty()
        val tracks = gate.withPermit {
            found[key] ?: DesktopEmbeddedSubtitleTimelineLoader.probeSubtitleTracks(url, headers)
        }
        if (tracks == null) unreadable[key] = System.currentTimeMillis() else found[key] = tracks
        return tracks
    }

    fun json(tracks: List<EmbeddedSubtitleInfo>): JsonArray = buildJsonArray {
        tracks.filter { !it.commentary }.forEach { track ->
            add(buildJsonObject {
                put("number", track.number)
                put("language", SubtitleSearchService.normalizeLanguage(track.language))
                track.name?.let { put("name", it) }
                put("format", track.format)
                if (track.fromDisc) put("disc", true)
                if (track.forced) put("forced", true)
                if (track.hearingImpaired) put("hi", true)
            })
        }
    }
}

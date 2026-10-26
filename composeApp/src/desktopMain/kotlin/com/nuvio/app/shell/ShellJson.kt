package com.nuvio.app.shell

import com.nuvio.app.features.details.MetaDetails
import com.nuvio.app.features.details.MetaVideo
import com.nuvio.app.features.home.HomeCatalogSection
import com.nuvio.app.features.home.MetaPreview
import com.nuvio.app.features.library.LibraryItem
import com.nuvio.app.features.streams.AddonStreamGroup
import com.nuvio.app.features.streams.StreamItem
import com.nuvio.app.features.watchprogress.WatchProgressEntry
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** Converts app models into the payloads the web shell reads (see webui/src/mock/backend.js). */
internal object ShellJson {
    fun JsonObjectBuilder.putIfNotNull(key: String, value: String?) {
        if (!value.isNullOrBlank()) put(key, value)
    }

    fun strings(values: Collection<String>): JsonArray = buildJsonArray { values.forEach { add(JsonPrimitive(it)) } }

    fun preview(item: MetaPreview): JsonObject = buildJsonObject {
        put("id", item.id)
        put("type", item.type)
        put("name", item.name)
        putIfNotNull("poster", item.poster)
        putIfNotNull("banner", item.banner ?: item.landscapePoster)
        putIfNotNull("logo", item.logo)
        putIfNotNull("description", item.description)
        putIfNotNull("releaseInfo", item.releaseInfo)
        putIfNotNull("imdbRating", item.imdbRating)
        putIfNotNull("runtime", item.runtime)
        put("genres", strings(item.genres))
    }

    fun libraryItem(item: LibraryItem): JsonObject = buildJsonObject {
        put("id", item.id)
        put("type", item.type)
        put("name", item.name)
        putIfNotNull("poster", item.poster)
        putIfNotNull("banner", item.banner)
        putIfNotNull("logo", item.logo)
        putIfNotNull("description", item.description)
        putIfNotNull("releaseInfo", item.releaseInfo)
        putIfNotNull("imdbRating", item.imdbRating)
        put("genres", strings(item.genres))
        put("addedAt", item.savedAtEpochMs)
    }

    /** Movies, series or anime: anime catalogs come from anime addons (Kitsu, MAL, AniList). */
    fun sectionKind(section: HomeCatalogSection): String {
        val haystack = listOf(section.key, section.addonName, section.title, section.subtitle).joinToString(" ").lowercase()
        val anime = listOf("kitsu", "anime", "myanimelist", "anilist", "mal.").any { it in haystack } ||
            section.items.take(6).count { it.id.startsWith("kitsu:") || it.id.startsWith("mal:") || it.id.startsWith("anilist:") } >= 3
        return when {
            anime -> "anime"
            section.target.contentType == "movie" -> "movie"
            section.target.contentType == "series" -> "series"
            else -> section.target.contentType
        }
    }

    fun section(section: HomeCatalogSection): JsonObject = buildJsonObject {
        put("key", section.key)
        put("title", section.title)
        put("subtitle", section.subtitle)
        put("addonName", section.addonName)
        put("type", section.target.contentType)
        put("kind", sectionKind(section))
        put("hasMore", section.hasMore)
        // "See all": the catalog behind the row, browsable page after page with its filters.
        (section.target as? com.nuvio.app.features.catalog.CatalogTarget.Addon)?.let { target ->
            put("source", "${target.manifestUrl}|${target.contentType}|${target.catalogId}")
            target.genre?.let { put("genre", it) }
        }
        put("items", buildJsonArray { section.items.forEach { add(preview(it)) } })
    }

    fun continueEntry(entry: WatchProgressEntry): JsonObject = buildJsonObject {
        val season = entry.seasonNumber
        val episode = entry.episodeNumber
        put("key", "${entry.parentMetaType}:${entry.parentMetaId}:${season ?: 0}:${episode ?: 0}")
        put("id", entry.parentMetaId)
        put("type", entry.parentMetaType)
        put("name", entry.title)
        putIfNotNull("poster", entry.poster)
        putIfNotNull("backdrop", entry.background)
        putIfNotNull("logo", entry.logo)
        put("videoId", entry.videoId)
        if (season != null) put("season", season)
        if (episode != null) put("episode", episode)
        putIfNotNull("episodeTitle", entry.episodeTitle)
        putIfNotNull("thumbnail", entry.episodeThumbnail ?: entry.background)
        put("positionMs", entry.lastPositionMs)
        put("durationMs", entry.durationMs)
        val progress = when {
            entry.durationMs > 0 -> entry.lastPositionMs.toDouble() / entry.durationMs.toDouble()
            entry.progressPercent != null -> entry.progressPercent!!.toDouble() / 100.0
            else -> 0.0
        }
        put("progress", progress.coerceIn(0.0, 1.0))
        put("lastWatched", entry.lastUpdatedEpochMs)
    }

    fun video(video: MetaVideo, progress: WatchProgressEntry?, watched: Boolean): JsonObject = buildJsonObject {
        put("id", video.id)
        put("title", video.title)
        putIfNotNull("released", video.released)
        put("available", video.available)
        putIfNotNull("thumbnail", video.thumbnail)
        video.season?.let { put("season", it) }
        video.episode?.let { put("episode", it) }
        putIfNotNull("overview", video.overview)
        video.runtime?.let { put("runtime", it) }
        video.rating?.let { put("rating", it) }
        val fraction = progress?.takeIf { it.durationMs > 0 && !it.isCompleted }
            ?.let { it.lastPositionMs.toDouble() / it.durationMs.toDouble() } ?: 0.0
        put("progress", fraction.coerceIn(0.0, 1.0))
        put("watched", watched || progress?.isCompleted == true)
    }

    fun details(
        meta: MetaDetails,
        progressFor: (MetaVideo) -> WatchProgressEntry?,
        watchedFor: (MetaVideo) -> Boolean,
        resume: WatchProgressEntry?,
    ): JsonObject = buildJsonObject {
        put("id", meta.id)
        put("type", meta.type)
        put("name", meta.name)
        putIfNotNull("poster", meta.poster)
        putIfNotNull("background", meta.background)
        putIfNotNull("banner", meta.background)
        putIfNotNull("logo", meta.logo)
        putIfNotNull("description", meta.description)
        putIfNotNull("releaseInfo", meta.releaseInfo)
        putIfNotNull("status", meta.status)
        putIfNotNull("imdbRating", meta.imdbRating)
        putIfNotNull("ageRating", meta.ageRating)
        putIfNotNull("runtime", meta.runtime)
        putIfNotNull("country", meta.country)
        putIfNotNull("language", meta.language)
        putIfNotNull("defaultVideoId", meta.defaultVideoId)
        put("genres", strings(meta.genres))
        put("director", strings(meta.director))
        put("cast", buildJsonArray {
            meta.cast.take(30).forEach { person ->
                add(buildJsonObject {
                    put("name", person.name)
                    putIfNotNull("role", person.role)
                    putIfNotNull("photo", person.photo)
                })
            }
        })
        put("trailers", buildJsonArray {
            meta.trailers.filter { it.site.equals("YouTube", ignoreCase = true) }.take(3).forEach { trailer ->
                add(buildJsonObject {
                    put("key", trailer.key)
                    put("name", trailer.displayName ?: trailer.name)
                    put("site", trailer.site)
                })
            }
        })
        put("moreLikeThis", buildJsonArray { meta.moreLikeThis.take(20).forEach { add(preview(it)) } })
        put("videos", buildJsonArray { meta.videos.forEach { add(video(it, progressFor(it), watchedFor(it))) } })
        if (resume != null && !resume.isCompleted) {
            put("resume", buildJsonObject {
                put("videoId", resume.videoId)
                resume.seasonNumber?.let { put("season", it) }
                resume.episodeNumber?.let { put("episode", it) }
                put("positionMs", resume.lastPositionMs)
                put("durationMs", resume.durationMs)
            })
        } else {
            put("resume", JsonNull)
        }
    }

    fun streamKey(groupId: String, index: Int, stream: StreamItem): String =
        "$groupId#$index#${(stream.url ?: stream.infoHash ?: stream.externalUrl ?: stream.name.orEmpty()).hashCode()}"

    fun stream(groupId: String, index: Int, stream: StreamItem): JsonObject = buildJsonObject {
        put("key", streamKey(groupId, index, stream))
        putIfNotNull("name", stream.name)
        putIfNotNull("title", stream.title)
        putIfNotNull("description", stream.description)
        putIfNotNull("filename", stream.behaviorHints.filename)
        stream.behaviorHints.videoSize?.takeIf { it > 0 }?.let { put("size", formatBytes(it)) }
        put("addonName", stream.addonName)
        stream.debridCacheStatus?.let { status ->
            if (status.state == com.nuvio.app.features.streams.StreamDebridCacheState.CACHED) put("cached", true)
            else if (status.state == com.nuvio.app.features.streams.StreamDebridCacheState.NOT_CACHED) put("cached", false)
        }
        put("external", stream.shouldOpenExternally)
        // The torrent behind it, so an uncached source can be sent to TorBox from the list.
        ShellTorbox.hashOf(stream)?.let { put("hash", it) }
        if (stream.directPlaybackUrl == null && stream.infoHash != null) put("p2p", true)
    }

    fun streamGroup(group: AddonStreamGroup): JsonObject = buildJsonObject {
        put("addonId", group.addonId)
        put("addonName", group.addonName)
        put("loading", group.isLoading)
        group.error?.let { put("error", it) }
        put("streams", buildJsonArray { group.streams.forEachIndexed { index, item -> add(stream(group.addonId, index, item)) } })
    }

    fun formatBytes(bytes: Long): String {
        val gb = bytes / 1_073_741_824.0
        return if (gb >= 1) "%.1f GB".format(gb) else "%.0f MB".format(bytes / 1_048_576.0)
    }

    fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
    fun JsonObject.int(key: String): Int? = (this[key] as? JsonPrimitive)?.contentOrNull?.toDoubleOrNull()?.toInt()
    fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.contentOrNull?.toDoubleOrNull()?.toLong()
    fun JsonObject.double(key: String): Double? = (this[key] as? JsonPrimitive)?.contentOrNull?.toDoubleOrNull()
    fun JsonObject.bool(key: String): Boolean? = (this[key] as? JsonPrimitive)?.contentOrNull?.toBooleanStrictOrNull()
    fun JsonElement?.asStringList(): List<String> = (this as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()
    fun JsonElement?.primitiveString(): String? = (this as? JsonPrimitive)?.jsonPrimitive?.contentOrNull
}

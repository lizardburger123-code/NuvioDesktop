package com.nuvio.app.shell

import com.nuvio.app.core.storage.DesktopStorage
import com.nuvio.app.features.downloads.DownloadItem
import com.nuvio.app.features.downloads.DownloadStatus
import com.nuvio.app.features.downloads.DownloadsRepository
import com.nuvio.app.features.downloads.DownloadsUiState
import com.nuvio.app.features.streams.StreamBehaviorHints
import com.nuvio.app.features.streams.StreamItem
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.net.URI
import java.util.concurrent.ConcurrentHashMap

/** Downloads for the shell: the app's own download engine, shown with live speed. */
internal object ShellDownloads {
    private data class Rate(val bytes: Long, val at: Long, val speed: Double)
    private val rates = ConcurrentHashMap<String, Rate>()
    private val store by lazy { DesktopStorage.store("nuvio_shell") }

    fun json(state: DownloadsUiState): JsonElement = buildJsonArray {
        val now = System.currentTimeMillis()
        state.items.forEach { item ->
            var speed = 0.0
            if (item.status == DownloadStatus.Downloading) {
                val prev = rates[item.id]
                speed = prev?.speed ?: 0.0
                if (prev == null) rates[item.id] = Rate(item.downloadedBytes, now, 0.0)
                else if (now - prev.at >= 300) {
                    val instant = (item.downloadedBytes - prev.bytes).coerceAtLeast(0) * 1000.0 / (now - prev.at)
                    speed = if (prev.speed == 0.0) instant else prev.speed * .6 + instant * .4
                    rates[item.id] = Rate(item.downloadedBytes, now, speed)
                }
            } else {
                rates.remove(item.id)
            }
            add(buildJsonObject {
                put("id", item.id)
                put("type", item.parentMetaType)
                put("metaId", item.parentMetaId)
                put("videoId", item.videoId)
                put("title", item.title)
                item.poster?.let { put("poster", it) }
                item.episodeThumbnail?.let { put("thumbnail", it) }
                item.seasonNumber?.let { put("season", it) }
                item.episodeNumber?.let { put("episode", it) }
                item.episodeTitle?.let { put("episodeTitle", it) }
                put("fileName", item.fileName)
                put("source", item.providerName)
                put("status", item.status.name.lowercase())
                put("done", item.downloadedBytes)
                item.totalBytes?.let { put("total", it) }
                put("speed", speed.toLong())
                item.errorMessage?.let { put("error", it) }
                put("createdAt", item.createdAtEpochMs)
            })
        }
    }

    fun item(id: String): DownloadItem = DownloadsRepository.uiState.value.items.firstOrNull { it.id == id } ?: error("That download is gone.")

    /** A source that plays the finished file. */
    fun localStream(item: DownloadItem): StreamItem {
        val uri = DownloadsRepository.playableLocalFileUri(item) ?: error("The file isn't there any more. Download it again.")
        return StreamItem(
            name = "Downloaded",
            title = item.fileName,
            url = uri,
            addonName = "Downloads",
            addonId = "downloads",
            behaviorHints = StreamBehaviorHints(filename = item.fileName),
        )
    }

    fun reveal(id: String?) {
        val file = id?.let { DownloadsRepository.uiState.value.items.firstOrNull { item -> item.id == it } }
            ?.let { DownloadsRepository.playableLocalFileUri(it) }
            ?.let { runCatching { File(URI(it)) }.getOrNull() }
        if (file != null && file.exists()) {
            runCatching { ProcessBuilder("explorer.exe", "/select,${file.absolutePath}").start() }
        } else {
            runCatching { ProcessBuilder("explorer.exe", folder().absolutePath).start() }
        }
    }

    fun folder(): File {
        val custom = store.getString("downloads_dir")?.trim()?.takeIf { it.isNotEmpty() }?.let(::File)
        return (custom ?: File(System.getProperty("user.home"), "Downloads${File.separator}Nuvio")).also { it.mkdirs() }
    }

    fun setFolder(path: String?): String {
        val value = path?.trim().orEmpty()
        if (value.isEmpty()) store.putString("downloads_dir", null)
        else {
            val dir = File(value)
            require(dir.isAbsolute) { "Use a full folder path, like D:\\Movies." }
            dir.mkdirs()
            require(dir.isDirectory && dir.canWrite()) { "Nuvio can't write to that folder." }
            store.putString("downloads_dir", dir.absolutePath)
        }
        return folder().absolutePath
    }
}

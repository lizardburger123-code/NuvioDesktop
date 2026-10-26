package com.nuvio.app.features.downloads

import com.nuvio.app.core.storage.DesktopStorage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import java.awt.Desktop
import java.io.File
import java.io.FileOutputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import kotlin.io.path.createDirectories

// HTTP/1.1 so parallel parts really use separate connections (debrid CDNs cap each one), and the
// app-wide proxy selector so "Unblock sites" applies to downloads too.
private val desktopDownloadHttpClient: HttpClient = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(30))
    .followRedirects(HttpClient.Redirect.NORMAL)
    .version(HttpClient.Version.HTTP_1_1)
    .proxy(java.net.ProxySelector.getDefault() ?: java.net.ProxySelector.of(null))
    .build()

private const val Parts = 6
private const val SplitAbove = 48L * 1024 * 1024

internal actual object DownloadsPlatformDownloader {
    /** Downloads\Nuvio (videos don't belong in the roaming app-data folder). */
    private val downloadsDir: File
        get() {
            val custom = runCatching { DesktopStorage.store("nuvio_shell").getString("downloads_dir") }.getOrNull()
                ?.trim()?.takeIf { it.isNotEmpty() }?.let(::File)
            val dir = custom ?: File(System.getProperty("user.home"), "Downloads${File.separator}Nuvio")
            return dir.also { it.mkdirs() }
        }

    /** Where older versions saved; still checked so those files keep playing. */
    private val legacyDir: File
        get() = File(DesktopStorage.rootDir.resolve("downloads").toUri())

    actual fun restoreItem(item: DownloadItem): DownloadItem =
        if (item.status == DownloadStatus.Downloading) {
            item.copy(status = DownloadStatus.Paused, errorMessage = null)
        } else {
            item
        }

    actual fun start(
        request: DownloadPlatformRequest,
        onProgress: (downloadedBytes: Long, totalBytes: Long?) -> Unit,
        onSuccess: (localFileUri: String, totalBytes: Long?) -> Unit,
        onFailure: (message: String) -> Unit,
        onPaused: () -> Unit,
    ): DownloadsTaskHandle {
        val job = SupervisorJob()
        val scope = CoroutineScope(job + Dispatchers.IO)

        scope.launch {
            val dir = downloadsDir
            val destination = File(dir, request.destinationFileName)
            val tempFile = File(dir, "${request.destinationFileName}.part")
            val stateFile = File(dir, "${request.destinationFileName}.part.json")
            // Progress at most a few times a second: every update is saved, so per-chunk updates
            // would mean thousands of disk writes per second.
            var lastReport = 0L
            val report: (Long, Long?, Boolean) -> Unit = { done, total, force ->
                val now = System.currentTimeMillis()
                if (force || now - lastReport >= 400) {
                    lastReport = now
                    onProgress(done, total)
                }
            }

            try {
                val total = probeRangeTotal(request)
                if (total != null && total >= SplitAbove) {
                    downloadInParts(request, total, tempFile, stateFile, report)
                } else {
                    stateFile.delete()
                    downloadSingle(request, tempFile, report)
                }
                ensureActive()
                if (destination.exists()) destination.delete()
                if (!tempFile.renameTo(destination)) {
                    tempFile.copyTo(destination, overwrite = true)
                    tempFile.delete()
                }
                stateFile.delete()
                val finalSize = destination.length()
                onSuccess(destination.toURI().toString(), finalSize)
            } catch (error: CancellationException) {
                onPaused()
                throw error
            } catch (error: Throwable) {
                onFailure(error.message ?: "Download failed")
            }
        }

        return DesktopDownloadsTaskHandle(job)
    }

    /** Total size when the server can send parts (a 1-byte range answers both questions). */
    private fun probeRangeTotal(request: DownloadPlatformRequest): Long? = runCatching {
        val builder = HttpRequest.newBuilder().uri(URI(request.sourceUrl)).timeout(Duration.ofSeconds(30)).GET()
        request.sourceHeaders.forEach { (k, v) -> if (k.isNotBlank() && v.isNotBlank()) builder.header(k, v) }
        builder.header("Range", "bytes=0-0")
        val response = desktopDownloadHttpClient.send(builder.build(), HttpResponse.BodyHandlers.discarding())
        if (response.statusCode() == 206) parseContentRangeTotal(response.headers().firstValue("Content-Range").orElse(null)) else null
    }.getOrNull()

    private suspend fun downloadInParts(
        request: DownloadPlatformRequest,
        total: Long,
        tempFile: File,
        stateFile: File,
        report: (Long, Long?, Boolean) -> Unit,
    ) = kotlinx.coroutines.coroutineScope {
        // Each part: [start, end] inclusive and how much of it is already on disk.
        val size = (total + Parts - 1) / Parts
        val starts = LongArray(Parts) { it * size }
        val ends = LongArray(Parts) { minOf(total - 1, (it + 1) * size - 1) }
        val done = java.util.concurrent.atomic.AtomicLongArray(Parts)
        val saved = runCatching { stateFile.readText().trim().split(",").map { it.trim().toLong() } }.getOrNull()
        if (saved != null && saved.size == Parts + 1 && saved[0] == total && tempFile.length() == total) {
            for (i in 0 until Parts) done.set(i, saved[i + 1].coerceIn(0, ends[i] - starts[i] + 1))
        } else {
            java.io.RandomAccessFile(tempFile, "rw").use { it.setLength(total) }
        }
        val sum = { (0 until Parts).sumOf { done.get(it) } }
        val save = { runCatching { stateFile.writeText((listOf(total) + (0 until Parts).map { done.get(it) }).joinToString(",")) } }
        report(sum(), total, true)
        try {
            (0 until Parts).map { part ->
                async {
                    var attempt = 0
                    while (true) {
                        val from = starts[part] + done.get(part)
                        if (from > ends[part]) break
                        try {
                            val builder = HttpRequest.newBuilder().uri(URI(request.sourceUrl)).timeout(Duration.ofSeconds(60)).GET()
                            request.sourceHeaders.forEach { (k, v) -> if (k.isNotBlank() && v.isNotBlank()) builder.header(k, v) }
                            builder.header("Range", "bytes=$from-${ends[part]}")
                            val response = desktopDownloadHttpClient.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream())
                            if (response.statusCode() != 206) error("The server stopped sending parts (HTTP ${response.statusCode()})")
                            java.io.RandomAccessFile(tempFile, "rw").use { file ->
                                file.seek(from)
                                response.body().use { input ->
                                    val buffer = ByteArray(256 * 1024)
                                    while (true) {
                                        ensureActive()
                                        val read = input.read(buffer)
                                        if (read <= 0) break
                                        val room = (ends[part] - (starts[part] + done.get(part)) + 1).toInt().coerceAtLeast(0)
                                        val n = minOf(read, room)
                                        file.write(buffer, 0, n)
                                        done.addAndGet(part, n.toLong())
                                        report(sum(), total, false)
                                        if (n < read) break
                                    }
                                }
                            }
                            attempt = 0
                        } catch (error: CancellationException) {
                            throw error
                        } catch (error: Throwable) {
                            attempt++
                            if (attempt > 4) throw error
                            kotlinx.coroutines.delay(1000L * attempt)
                        }
                    }
                }
            }.forEach { it.await() }
        } finally {
            save()
        }
        report(sum(), total, true)
    }

    private fun CoroutineScope.downloadSingle(
        request: DownloadPlatformRequest,
        tempFile: File,
        report: (Long, Long?, Boolean) -> Unit,
    ) {
        var resumeFromBytes = tempFile.takeIf { it.exists() }?.length()?.coerceAtLeast(0L) ?: 0L
        var attemptedRangeRequest = resumeFromBytes > 0L
        var response = sendDownloadRequest(request, if (attemptedRangeRequest) resumeFromBytes else null)

        if (attemptedRangeRequest && response.statusCode() == 416) {
            tempFile.delete()
            resumeFromBytes = 0L
            attemptedRangeRequest = false
            response = sendDownloadRequest(request, null)
        }
        if (response.statusCode() !in 200..299) error("Download failed with HTTP ${response.statusCode()}")

        val isPartialResume = attemptedRangeRequest && response.statusCode() == 206 && resumeFromBytes > 0L
        val startingBytes = if (isPartialResume) resumeFromBytes else 0L
        if (!isPartialResume && tempFile.exists()) tempFile.delete()

        val totalBytes = resolveTotalBytes(
            startingBytes = startingBytes,
            isPartialResume = isPartialResume,
            contentRangeHeader = response.headers().firstValue("Content-Range").orElse(null),
            contentLength = response.headers().firstValue("Content-Length").orElse(null)?.toLongOrNull(),
        )
        var downloadedBytes = startingBytes
        report(downloadedBytes, totalBytes, true)
        response.body().use { input ->
            FileOutputStream(tempFile, isPartialResume).use { output ->
                val buffer = ByteArray(256 * 1024)
                while (true) {
                    ensureActive()
                    val read = input.read(buffer)
                    if (read <= 0) break
                    output.write(buffer, 0, read)
                    downloadedBytes += read.toLong()
                    report(downloadedBytes, totalBytes, false)
                }
                output.flush()
            }
        }
        report(downloadedBytes, totalBytes, true)
    }

    actual fun removeFile(localFileUri: String?): Boolean {
        if (localFileUri.isNullOrBlank()) return false
        val file = localFileUri.toLocalFileOrNull() ?: return false
        return runCatching { file.delete() }.getOrDefault(false)
    }

    actual fun removePartialFile(destinationFileName: String): Boolean {
        File(downloadsDir, "$destinationFileName.part.json").delete()
        val tempFile = File(downloadsDir, "$destinationFileName.part")
        if (!tempFile.exists()) return true
        return runCatching { tempFile.delete() }.getOrDefault(false)
    }

    actual fun resolveLocalFileUri(localFileUri: String?, destinationFileName: String): String? {
        localFileUri
            ?.toLocalFileOrNull()
            ?.takeIf { it.exists() }
            ?.let { return it.toURI().toString() }

        val fileName = destinationFileName.trim().takeIf { it.isNotBlank() }
            ?: localFileUri?.toLocalFileOrNull()?.name?.takeIf { it.isNotBlank() }
            ?: return null
        return (File(downloadsDir, fileName).takeIf { it.exists() } ?: File(legacyDir, fileName).takeIf { it.exists() })
            ?.toURI()?.toString()
    }

    actual fun openDownloadsDirectory(): Boolean {
        val directory = downloadsDir
        val desktop = runCatching { Desktop.getDesktop() }.getOrNull()

        if (desktop != null && Desktop.isDesktopSupported() && desktop.isSupported(Desktop.Action.OPEN)) {
            val opened = runCatching { desktop.open(directory) }.isSuccess
            if (opened) return true
        }

        return openDirectoryWithPlatformCommand(directory)
    }

    private fun sendDownloadRequest(
        request: DownloadPlatformRequest,
        rangeStart: Long?,
    ): HttpResponse<java.io.InputStream> {
        val builder = HttpRequest.newBuilder()
            .uri(URI(request.sourceUrl))
            .timeout(Duration.ofSeconds(60))
            .GET()
        request.sourceHeaders.forEach { (key, value) ->
            if (key.isNotBlank() && value.isNotBlank()) {
                builder.header(key, value)
            }
        }
        if (rangeStart != null && rangeStart > 0L) {
            builder.header("Range", "bytes=$rangeStart-")
        }
        return desktopDownloadHttpClient.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream())
    }
}

private fun openDirectoryWithPlatformCommand(directory: File): Boolean {
    val osName = System.getProperty("os.name").orEmpty().lowercase()
    val command = when {
        osName.contains("mac") -> listOf("open", directory.absolutePath)
        osName.contains("win") -> listOf("explorer", directory.absolutePath)
        else -> listOf("xdg-open", directory.absolutePath)
    }
    return runCatching { ProcessBuilder(command).start() }.isSuccess
}

private class DesktopDownloadsTaskHandle(
    private val job: Job,
) : DownloadsTaskHandle {
    override fun cancel() {
        job.cancel()
    }
}

private fun String.toLocalFileOrNull(): File? =
    runCatching {
        if (startsWith("file:")) {
            File(URI(this))
        } else {
            File(this)
        }
    }.getOrNull()

private fun resolveTotalBytes(
    startingBytes: Long,
    isPartialResume: Boolean,
    contentRangeHeader: String?,
    contentLength: Long?,
): Long? {
    parseContentRangeTotal(contentRangeHeader)?.let { return it }
    val normalizedLength = contentLength?.takeIf { it > 0L } ?: return null
    return if (isPartialResume && startingBytes > 0L) {
        startingBytes + normalizedLength
    } else {
        normalizedLength
    }
}

private fun parseContentRangeTotal(headerValue: String?): Long? {
    val value = headerValue?.trim().orEmpty()
    if (value.isBlank()) return null
    val slashIndex = value.lastIndexOf('/')
    if (slashIndex == -1 || slashIndex == value.lastIndex) return null
    val totalPart = value.substring(slashIndex + 1).trim()
    if (totalPart == "*") return null
    return totalPart.toLongOrNull()?.takeIf { it > 0L }
}

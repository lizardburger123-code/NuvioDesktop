package com.nuvio.app.features.player.desktop

import java.awt.Desktop
import java.io.File

/**
 * The person's own subtitle files: Documents/Nuvio Subtitles. The player saves the subtitle it is
 * showing there (to send off for fixes) and offers whatever is in the folder to load back.
 */
internal object DesktopSubtitleFiles {
    private val EXTENSIONS = setOf("srt", "vtt", "ass", "ssa", "sub")
    private const val MAX_LISTED = 12

    data class Item(val path: String, val name: String)

    @Volatile
    var items: List<Item> = emptyList()
        private set

    val folder: File
        get() {
            val home = File(System.getProperty("user.home").orEmpty())
            val documents = File(home, "Documents").takeIf { it.isDirectory } ?: home
            return File(documents, "Nuvio Subtitles")
        }

    fun isSubtitle(file: File): Boolean = file.extension.lowercase() in EXTENSIONS

    /** Re-reads the folder, newest first. */
    fun refresh(): List<Item> {
        val found = runCatching {
            folder.listFiles { file -> file.isFile && isSubtitle(file) }
                .orEmpty()
                .sortedByDescending { it.lastModified() }
                .take(MAX_LISTED)
                .map { Item(path = it.absolutePath, name = it.name) }
        }.getOrDefault(emptyList())
        items = found
        return found
    }

    /** Writes [body] as UTF-8 under a name built from the title, never overwriting another file. */
    fun save(title: String, language: String, extension: String, body: String): File {
        val directory = folder.also { it.mkdirs() }
        val safeTitle = title.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), " ").replace(Regex("\\s+"), " ").trim().take(90).ifBlank { "Subtitle" }
        val tag = language.trim().take(12).replace(Regex("[^\\p{L}\\p{N}-]"), "")
        val base = if (tag.isBlank()) safeTitle else "$safeTitle [$tag]"
        val ext = extension.lowercase().takeIf { it in EXTENSIONS } ?: "srt"
        var file = File(directory, "$base.$ext")
        var copy = 2
        while (file.exists() && runCatching { file.readText(Charsets.UTF_8) }.getOrNull() != body) {
            file = File(directory, "$base ($copy).$ext")
            copy++
        }
        file.writeText(body, Charsets.UTF_8)
        refresh()
        return file
    }

    fun openFolder() {
        runCatching {
            val directory = folder.also { it.mkdirs() }
            Desktop.getDesktop().open(directory)
        }
    }

    /** Shows the saved file selected in Explorer where that is possible, else just opens the folder. */
    fun reveal(file: File) {
        val shown = runCatching {
            if (System.getProperty("os.name").orEmpty().startsWith("Windows", ignoreCase = true)) {
                ProcessBuilder("explorer.exe", "/select,${file.absolutePath}").start()
                true
            } else {
                false
            }
        }.getOrDefault(false)
        if (!shown) openFolder()
    }
}

package com.nuvio.app.core.storage

import java.io.File

/** Showing files and folders in the system's file manager, on each desktop. */
internal object DesktopFileManager {
    private val os = System.getProperty("os.name").orEmpty().lowercase()
    private val windows get() = os.startsWith("windows")
    private val mac get() = os.contains("mac")

    private fun run(vararg command: String): Boolean = runCatching {
        ProcessBuilder(*command)
            .redirectOutput(ProcessBuilder.Redirect.DISCARD)
            .redirectError(ProcessBuilder.Redirect.DISCARD)
            .start()
    }.isSuccess

    /** Opens the folder holding [file] with the file selected where the file manager can do that. */
    fun reveal(file: File): Boolean {
        if (!file.exists()) return openFolder(file.parentFile ?: return false)
        return when {
            windows -> run("explorer.exe", "/select,${file.absolutePath}")
            mac -> run("open", "-R", file.absolutePath)
            // The freedesktop file-manager interface (Files, Dolphin, Nemo, Thunar); else the folder.
            else -> runCatching {
                val shown = ProcessBuilder(
                    "dbus-send", "--session", "--print-reply", "--dest=org.freedesktop.FileManager1",
                    "/org/freedesktop/FileManager1", "org.freedesktop.FileManager1.ShowItems",
                    "array:string:${file.toURI().toASCIIString()}", "string:",
                ).redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start()
                shown.waitFor(3, java.util.concurrent.TimeUnit.SECONDS) && shown.exitValue() == 0
            }.getOrDefault(false) || openFolder(file.parentFile ?: return false)
        }
    }

    fun openFolder(folder: File): Boolean = when {
        windows -> run("explorer.exe", folder.absolutePath)
        mac -> run("open", folder.absolutePath)
        else -> run("xdg-open", folder.absolutePath)
    }
}

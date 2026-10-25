package com.nuvio.app.features.player.desktop

import com.nuvio.app.shell.SubtitleResult

/** Subtitle fonts the player offers, in the order the page shows them (events send the index). */
internal object DesktopSubtitleFonts {
    val names = listOf(
        "Cairo",
        "Tajawal",
        "Almarai",
        "IBM Plex Sans Arabic",
        "Noto Kufi Arabic",
        "Noto Naskh Arabic",
        "Readex Pro",
        "Changa",
        "Amiri",
        "Segoe UI",
        "Tahoma",
        "Arial",
        "Sakkal Majalla",
        "Traditional Arabic",
    )
}

/** State of the player's "Search online" subtitle rail. One player exists at a time. */
internal object DesktopSubtitleSearchUi {
    @Volatile var status: String = "idle" // idle | loading | done | error
        private set
    @Volatile var message: String = ""
        private set
    @Volatile var mode: Int = 0
        private set
    @Volatile var results: List<SubtitleResult> = emptyList()
        private set
    @Volatile var loadingIndex: Int = -1
        private set
    @Volatile var loadedIndex: Int = -1
        private set
    @Volatile var revision: Long = 0
        private set

    @Synchronized
    fun begin(mode: Int) {
        this.mode = mode
        status = "loading"
        message = ""
        results = emptyList()
        loadingIndex = -1
        loadedIndex = -1
        revision++
    }

    @Synchronized
    fun finish(found: List<SubtitleResult>, configuredSources: Int) {
        results = found
        status = "done"
        message = when {
            found.isNotEmpty() -> ""
            configuredSources == 0 ->
                "Nothing found on Podnapisi. Add a free OpenSubtitles, SubDL or SubSource key in Settings › Subtitles to search more sites."
            else -> "No subtitles found for this title in these languages."
        }
        revision++
    }

    @Synchronized
    fun fail(text: String) {
        status = "error"
        message = text
        revision++
    }

    @Synchronized
    fun loading(index: Int) {
        loadingIndex = index
        message = ""
        revision++
    }

    @Synchronized
    fun loaded(index: Int) {
        loadingIndex = -1
        loadedIndex = index
        revision++
    }

    @Synchronized
    fun loadFailed(index: Int, text: String) {
        if (loadingIndex == index) loadingIndex = -1
        message = text
        revision++
    }

    /** A new video starts with an empty search. */
    @Synchronized
    fun reset() {
        status = "idle"
        message = ""
        results = emptyList()
        loadingIndex = -1
        loadedIndex = -1
        revision++
    }
}

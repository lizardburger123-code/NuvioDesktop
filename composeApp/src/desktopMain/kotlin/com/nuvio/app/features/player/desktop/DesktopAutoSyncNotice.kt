package com.nuvio.app.features.player.desktop

/** Latest AutoSync message for the player page; the page shows a toast whenever [id] changes. */
internal object DesktopAutoSyncNotice {
    @Volatile
    var message: String = ""
        private set

    @Volatile
    var id: Long = 0L
        private set

    @Synchronized
    fun post(text: String) {
        message = text
        id += 1
    }
}

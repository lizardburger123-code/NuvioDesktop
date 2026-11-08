package com.nuvio.app.features.player.desktop

/** The other subtitles of the current title, offered as timing references in the player. */
internal object DesktopSyncReferenceUi {
    data class Item(val url: String, val language: String, val label: String)

    @Volatile
    var items: List<Item> = emptyList()
}

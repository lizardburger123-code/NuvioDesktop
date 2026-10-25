package com.nuvio.app.features.player.desktop

import com.nuvio.app.core.storage.DesktopStorage

/**
 * Subtitle placement for the desktop HTML subtitle layer.
 *
 * align: "center" | "left" | "right" ("right" is the MBC 2 style).
 * x / y: percentages of the video picture, or null for the alignment's home position.
 * Clamping is applied again by the player page before use.
 */
internal data class DesktopSubtitleLayout(
    val align: String = ALIGN_CENTER,
    val x: Float? = null,
    val y: Float? = null,
) {
    companion object {
        const val ALIGN_CENTER = "center"
        const val ALIGN_LEFT = "left"
        const val ALIGN_RIGHT = "right"

        fun alignFromCode(code: Int): String = when (code) {
            1 -> ALIGN_LEFT
            2 -> ALIGN_RIGHT
            else -> ALIGN_CENTER
        }
    }
}

internal object DesktopSubtitleLayoutStorage {
    private const val AlignKey = "subtitle_align"
    private const val XKey = "subtitle_position_x"
    private const val YKey = "subtitle_position_y"

    private val store = DesktopStorage.store("nuvio_subtitle_layout")

    @Volatile
    private var cached: DesktopSubtitleLayout? = null

    fun load(): DesktopSubtitleLayout {
        cached?.let { return it }
        val align = when (store.getString(AlignKey)) {
            DesktopSubtitleLayout.ALIGN_LEFT -> DesktopSubtitleLayout.ALIGN_LEFT
            DesktopSubtitleLayout.ALIGN_RIGHT -> DesktopSubtitleLayout.ALIGN_RIGHT
            else -> DesktopSubtitleLayout.ALIGN_CENTER
        }
        val layout = DesktopSubtitleLayout(
            align = align,
            x = store.getFloat(XKey)?.takeIf { it.isFinite() },
            y = store.getFloat(YKey)?.takeIf { it.isFinite() },
        )
        cached = layout
        return layout
    }

    /** Changing alignment always sends the subtitle home, so stored x/y are cleared. */
    fun saveAlign(align: String) {
        store.putString(AlignKey, align)
        store.removeAll(listOf(XKey, YKey))
        cached = DesktopSubtitleLayout(align = align)
    }

    fun savePosition(x: Float?, y: Float?) {
        val current = load()
        if (x != null && x.isFinite()) store.putFloat(XKey, x) else store.remove(XKey)
        if (y != null && y.isFinite()) store.putFloat(YKey, y) else store.remove(YKey)
        cached = current.copy(x = x?.takeIf { it.isFinite() }, y = y?.takeIf { it.isFinite() })
    }

    fun resetPosition() {
        store.removeAll(listOf(XKey, YKey))
        cached = load().copy(x = null, y = null)
    }
}

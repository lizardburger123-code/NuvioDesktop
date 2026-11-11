package com.nuvio.app.features.player.desktop

/**
 * The trophy pop-up inside the player: when a film or a season is finished while it plays, the
 * app hands its cards here and the player's controls page shows them over the video, the way a
 * console does. With no player open, [post] says so and the app shows them itself.
 */
internal object DesktopTrophyPop {
    @Volatile var version: Long = 0L
        private set
    /** A JSON array of cards, already worded by the app. */
    @Volatile var cards: String = "[]"
        private set

    @Volatile private var owner: Any? = null
    @Volatile private var refresh: (() -> Unit)? = null

    @Synchronized fun attach(player: Any, onPosted: () -> Unit) {
        owner = player
        refresh = onPosted
    }

    @Synchronized fun detach(player: Any) {
        if (owner !== player) return
        owner = null
        refresh = null
    }

    /** True when a player is open and will show [cardsJson]. */
    @Synchronized fun post(cardsJson: String): Boolean {
        val show = refresh ?: return false
        cards = cardsJson
        version += 1
        show()
        return true
    }
}

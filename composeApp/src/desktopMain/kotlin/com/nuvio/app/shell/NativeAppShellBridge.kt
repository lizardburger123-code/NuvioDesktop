package com.nuvio.app.shell

import com.nuvio.app.features.player.desktop.NativePlayerBridge

/** Receives the page's messages on the shell's UI thread. Must stay a named class for JNI lookup. */
internal interface NativeAppShellSink {
    fun onShellMessage(message: String)
}

/**
 * The app shell is a WebView2 child window of the main window (Windows only). It lives in the same
 * native library as the player, so loading goes through [NativePlayerBridge].
 */
internal object NativeAppShellBridge {
    fun ensureLoaded() = NativePlayerBridge.ensureLoaded()

    external fun createShell(hostHwnd: Long, pageUrl: String, sink: NativeAppShellSink): Long
    external fun setShellVisible(handle: Long, visible: Boolean)
    external fun layoutShell(handle: Long)
    external fun focusShell(handle: Long)
    external fun postShellMessage(handle: Long, message: String)
    external fun disposeShell(handle: Long)
}

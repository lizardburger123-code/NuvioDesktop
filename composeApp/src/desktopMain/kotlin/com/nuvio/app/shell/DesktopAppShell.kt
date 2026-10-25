package com.nuvio.app.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.touchlab.kermit.Logger
import com.nuvio.app.core.shell.AppShellActions
import com.nuvio.app.core.shell.AppShellOverride
import com.nuvio.app.core.storage.DesktopCache
import com.nuvio.app.features.player.desktop.AwtNativeViewResolver
import com.nuvio.app.features.player.desktop.toggleDesktopAppFullscreen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.awt.Desktop
import java.awt.Window
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent
import java.awt.event.WindowAdapter
import java.awt.event.WindowEvent
import java.net.URI
import java.net.URL
import javax.swing.SwingUtilities

private val ShellGround = Color(0xFF07070B)

/**
 * Hosts the web interface (webui/) over the main window in place of the classic tabs.
 * The WebView2 window is created once and only hidden while other routes (details opened from
 * classic screens, sources, the player) are on screen, so the page keeps its state.
 */
internal class DesktopAppShell(private val window: Window) : AppShellOverride, ShellHost {
    private val log = Logger.withTag("DesktopAppShell")
    private val rpc = ShellRpc(this)

    @Volatile private var handle: Long = 0L
    @Volatile private var actions: AppShellActions? = null
    @Volatile private var visible = false
    private var creating = false

    /** Saved choice to keep the classic interface. */
    private var classicSaved by mutableStateOf(ShellAppearanceStore.classicInterface())
    /** Classic screens opened from the shell for something it doesn't have yet. */
    private var classicVisit by mutableStateOf(false)
    private var failure by mutableStateOf<String?>(null)

    private val sink = object : NativeAppShellSink {
        override fun onShellMessage(message: String) {
            runCatching { rpc.handle(message) }.onFailure { log.w(it) { "shell message failed" } }
        }
    }

    private val resizeListener = object : ComponentAdapter() {
        override fun componentResized(e: ComponentEvent?) = relayout()
        override fun componentShown(e: ComponentEvent?) = relayout()
    }
    private val windowListener = object : WindowAdapter() {
        override fun windowClosed(e: WindowEvent?) = dispose()
        override fun windowStateChanged(e: WindowEvent?) = relayout()
    }

    init {
        window.addComponentListener(resizeListener)
        window.addWindowListener(windowListener)
        window.addWindowStateListener(windowListener)
    }

    @Composable
    override fun TabsContent(active: Boolean, actions: AppShellActions, classic: @Composable () -> Unit) {
        SideEffect { this.actions = actions }
        val useClassic = classicSaved || classicVisit || failure != null
        if (useClassic) {
            LaunchedEffect(Unit) { setVisible(false) }
            Box(Modifier.fillMaxSize()) {
                classic()
                if (active && failure == null) {
                    ShellPill(
                        label = if (classicVisit) "Back to the new interface" else "Try the new interface",
                        modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp),
                    ) {
                        if (classicVisit) classicVisit = false else setClassicInterface(false)
                    }
                }
            }
            return
        }

        Box(Modifier.fillMaxSize().background(ShellGround))
        LaunchedEffect(active) {
            if (active) {
                ensureCreated()
                setVisible(true)
            } else {
                setVisible(false)
            }
        }
        DisposableEffect(Unit) {
            onDispose { setVisible(false) }
        }
    }

    @Composable
    private fun ShellPill(label: String, modifier: Modifier, onClick: () -> Unit) {
        Box(
            modifier
                .clip(RoundedCornerShape(50))
                .background(Color(0xE61A1A24))
                .clickable(onClick = onClick)
                .padding(horizontal = 18.dp, vertical = 11.dp),
        ) {
            Text(label, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        }
    }

    private suspend fun ensureCreated() {
        if (handle != 0L || creating || failure != null) return
        creating = true
        try {
            val hwnd = AwtNativeViewResolver.resolveNativeViewPointer(window)
            val created = withContext(Dispatchers.IO) {
                NativeAppShellBridge.ensureLoaded()
                NativeAppShellBridge.createShell(hwnd, pageUrl(), sink)
            }
            check(created != 0L) { "The interface window could not be created." }
            handle = created
            NativeAppShellBridge.layoutShell(created)
        } catch (error: Throwable) {
            log.e(error) { "new interface unavailable, using the classic one" }
            failure = error.message ?: error::class.simpleName
        } finally {
            creating = false
        }
    }

    private fun setVisible(show: Boolean) {
        visible = show
        val h = handle
        if (h == 0L) return
        if (show) NativeAppShellBridge.layoutShell(h)
        NativeAppShellBridge.setShellVisible(h, show)
        if (show) NativeAppShellBridge.focusShell(h)
    }

    private fun relayout() {
        val h = handle
        if (h != 0L && visible) NativeAppShellBridge.layoutShell(h)
    }

    // ---- ShellHost ---------------------------------------------------------------------------

    override fun post(json: String) {
        val h = handle
        if (h != 0L) NativeAppShellBridge.postShellMessage(h, json)
    }

    override fun actions(): AppShellActions? = actions

    override fun openClassic(tabName: String, settingsPage: String?) {
        SwingUtilities.invokeLater {
            classicVisit = true
            actions?.openClassicTab(tabName, settingsPage)
        }
    }

    override fun setClassicInterface(enabled: Boolean) {
        SwingUtilities.invokeLater {
            ShellAppearanceStore.setClassicInterface(enabled)
            classicSaved = enabled
            classicVisit = false
            if (!enabled) actions?.openClassicTab("Home", null)
        }
    }

    override fun toggleFullscreen() {
        SwingUtilities.invokeLater { toggleDesktopAppFullscreen(window) }
    }

    override fun openUrl(url: String) {
        Thread {
            runCatching { Desktop.getDesktop().browse(URI(url)) }.onFailure { log.w(it) { "couldn't open $url" } }
        }.apply { isDaemon = true }.start()
    }

    fun dispose() {
        window.removeComponentListener(resizeListener)
        window.removeWindowListener(windowListener)
        window.removeWindowStateListener(windowListener)
        rpc.dispose()
        val h = handle
        handle = 0L
        if (h != 0L) runCatching { NativeAppShellBridge.disposeShell(h) }
    }

    private fun pageUrl(): String {
        val index = DesktopAppShell::class.java.getResourceAsStream("/app-ui/files.txt")
            ?.use { it.readBytes().toString(Charsets.UTF_8) }
            ?: error("The interface files are missing from this build.")
        val resources = linkedMapOf<String, URL>()
        index.lineSequence().map(String::trim).filter(String::isNotEmpty).forEach { name ->
            val url = DesktopAppShell::class.java.getResource("/app-ui/$name") ?: error("Missing interface file $name.")
            resources[name] = url
        }
        val root = DesktopCache.installVersionedResources("app-ui", resources)
        return root.resolve("index.html").toUri().toASCIIString()
    }
}

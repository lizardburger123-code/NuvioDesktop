package com.nuvio.app.shell

import co.touchlab.kermit.Logger
import com.nuvio.app.core.storage.DesktopCache
import com.nuvio.app.core.storage.DesktopStorage
import java.io.BufferedWriter
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** One interface window: WebView2 inside the player bridge on Windows, a helper process on Linux. */
internal interface AppShellWindow {
    fun setVisible(visible: Boolean)
    fun layout()
    fun focus()
    fun post(json: String)
    fun dispose()
}

internal class WindowsAppShellWindow(private val handle: Long) : AppShellWindow {
    override fun setVisible(visible: Boolean) = NativeAppShellBridge.setShellVisible(handle, visible)
    override fun layout() = NativeAppShellBridge.layoutShell(handle)
    override fun focus() = NativeAppShellBridge.focusShell(handle)
    override fun post(json: String) = NativeAppShellBridge.postShellMessage(handle, json)
    override fun dispose() = NativeAppShellBridge.disposeShell(handle)

    companion object {
        fun create(hostHwnd: Long, pageUrl: String, sink: NativeAppShellSink): WindowsAppShellWindow {
            NativeAppShellBridge.ensureLoaded()
            val handle = NativeAppShellBridge.createShell(hostHwnd, pageUrl, sink)
            check(handle != 0L) { "The interface window could not be created." }
            return WindowsAppShellWindow(handle)
        }
    }
}

/**
 * Linux: the interface runs in `nuvio-shell-host` (native/linux/shell_host.c), a WebKitGTK window
 * the helper makes a child of the app's X11 window. Commands and the page's messages travel as
 * lines over the helper's stdin and stdout. A helper that dies takes only the new interface with
 * it: [onGone] lets the app fall back to the classic one.
 */
internal class LinuxAppShellWindow private constructor(
    private val process: Process,
    private val sink: NativeAppShellSink,
    private val onGone: (String) -> Unit,
) : AppShellWindow {
    private val log = Logger.withTag("LinuxAppShell")
    private val outbox = LinkedBlockingQueue<String>()
    private val created = CountDownLatch(1)
    @Volatile private var failure: String? = null
    @Volatile private var disposed = false

    private fun start() {
        thread(name = "nuvio-shell-out", isDaemon = true) {
            runCatching {
                process.outputStream.bufferedWriter(Charsets.UTF_8).use { writer: BufferedWriter ->
                    while (true) {
                        val line = outbox.take()
                        writer.write(line)
                        writer.write("\n")
                        // Send what is queued in one go, then flush.
                        while (true) {
                            val more = outbox.poll() ?: break
                            writer.write(more)
                            writer.write("\n")
                        }
                        writer.flush()
                        if (line == "Q") break
                    }
                }
            }
        }
        thread(name = "nuvio-shell-in", isDaemon = true) {
            runCatching {
                process.inputStream.bufferedReader(Charsets.UTF_8).forEachLine { line ->
                    if (!line.startsWith("M")) return@forEachLine
                    val message = line.substring(1)
                    if (created.count > 0L) {
                        if (message.startsWith("{\"event\":\"created\"")) created.countDown()
                        if (message.startsWith("{\"event\":\"failed\"")) {
                            failure = "The interface window could not be created ($message)."
                            created.countDown()
                        }
                    }
                    runCatching { sink.onShellMessage(message) }.onFailure { log.w(it) { "shell message failed" } }
                }
            }
            val code = runCatching { process.waitFor() }.getOrDefault(-1)
            if (created.count > 0L) {
                failure = "The interface helper stopped while starting (exit $code)."
                created.countDown()
            }
            if (!disposed) {
                log.w { "interface helper exited with $code" }
                onGone("The interface helper stopped (exit $code).")
            }
        }
    }

    private fun send(line: String) {
        if (!disposed) outbox.offer(line)
    }

    override fun setVisible(visible: Boolean) = send(if (visible) "V1" else "V0")
    override fun layout() = send("L")
    override fun focus() = send("F")
    override fun post(json: String) = send("P" + json.replace("\n", " "))

    override fun dispose() {
        if (disposed) return
        outbox.offer("Q")
        disposed = true
        thread(name = "nuvio-shell-stop", isDaemon = true) {
            if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly()
        }
    }

    companion object {
        private const val Name = "nuvio-shell-host"

        fun create(hostXid: Long, pageUrl: String, sink: NativeAppShellSink, onGone: (String) -> Unit): LinuxAppShellWindow {
            val helper = helper()
            val data = DesktopStorage.rootDir.resolve("webview-shell").toFile().apply { mkdirs() }
            val builder = ProcessBuilder(helper.absolutePath, hostXid.toString(), pageUrl, data.absolutePath)
                .redirectError(ProcessBuilder.Redirect.INHERIT)
            builder.environment().apply {
                // The interface needs WebKit's compositor (3D, blur). NUVIO_SHELL_SOFTWARE=1 is the
                // way out on a graphics driver where that shows a blank window.
                if (System.getenv("NUVIO_SHELL_SOFTWARE") != null) {
                    put("WEBKIT_DISABLE_COMPOSITING_MODE", "1")
                } else {
                    remove("WEBKIT_DISABLE_COMPOSITING_MODE")
                }
                put("GDK_BACKEND", "x11")
            }
            val process = builder.start()
            val window = LinuxAppShellWindow(process, sink, onGone)
            window.start()
            if (!window.created.await(15, TimeUnit.SECONDS)) {
                window.disposed = true
                process.destroyForcibly()
                error("The interface helper did not answer.")
            }
            window.failure?.let { reason ->
                window.disposed = true
                process.destroyForcibly()
                error(reason)
            }
            return window
        }

        /** The helper binary: beside the packaged app, from a local build, or unpacked from the jar. */
        private fun helper(): File {
            System.getProperty("compose.application.resources.dir")?.takeIf(String::isNotBlank)?.let { dir ->
                File(dir, "native/linux/$Name").takeIf(File::isFile)?.let { return it.executable() }
            }
            listOf(File("composeApp/build/native/linux/$Name"), File("build/native/linux/$Name"))
                .firstOrNull(File::isFile)?.let { return it.executable() }
            val url = LinuxAppShellWindow::class.java.getResource("/native/linux/$Name")
                ?: error("This build has no interface helper ($Name).")
            val directory = DesktopCache.installVersionedResources("native-shell-host/linux", mapOf(Name to url))
            return directory.resolve(Name).toFile().executable()
        }

        private fun File.executable(): File = apply {
            if (!canExecute()) check(setExecutable(true)) { "Couldn't make $absolutePath runnable." }
        }
    }
}

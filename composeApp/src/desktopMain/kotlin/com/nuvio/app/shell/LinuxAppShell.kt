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
 * How the Linux helper draws the page (see shell_host.c): "gpu", "shm" or "software".
 *
 * NVIDIA's own driver shows a black window with WebKit's GPU paths in an embedded X11 window, so
 * it gets "software". Everything else (AMD, Intel) composites on the GPU and hands frames over
 * through shared memory ("shm"), the path that does not depend on sharing GPU buffers between
 * processes. NUVIO_SHELL_RENDER overrides the choice; a helper that kept crashing in a GPU mode
 * is started again in "software", and that is remembered for the next launches.
 */
internal object LinuxShellRender {
    private val modes = setOf("gpu", "shm", "software")
    @Volatile private var settled: String? = null

    private fun marker(): File = DesktopStorage.rootDir.resolve("webview-shell").resolve("render-mode").toFile()

    fun mode(): String {
        System.getenv("NUVIO_SHELL_RENDER")?.trim()?.lowercase()?.takeIf { it in modes }?.let { return it }
        if (System.getenv("NUVIO_SHELL_SOFTWARE") != null) return "software"
        settled?.let { return it }
        runCatching { marker().takeIf(File::isFile)?.readText()?.trim() }.getOrNull()
            ?.takeIf { it in modes }?.let { return it }
        return if (nvidiaDriver()) "software" else "shm"
    }

    private fun nvidiaDriver(): Boolean =
        runCatching { File("/sys/module/nvidia").exists() || File("/proc/driver/nvidia/version").exists() }.getOrDefault(false)

    /** After a helper in [lost] mode was lost: true when there is a safer mode to start it again in. */
    fun stepDown(lost: String): Boolean {
        if (lost == "software") return false
        settled = "software"
        runCatching { marker().apply { parentFile?.mkdirs() }.writeText("software\n") }
        return true
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
    /** The drawing mode this helper runs in. */
    val mode: String,
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
                    } else if (message.startsWith("{\"event\":\"failed\"") && !disposed) {
                        // The page cannot be kept alive (its process keeps crashing, or it no
                        // longer loads): this helper is of no more use.
                        log.w { "interface helper gave up: $message" }
                        disposed = true
                        process.destroyForcibly()
                        onGone("The interface stopped working ($message).")
                        return@forEachLine
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
            val mode = LinuxShellRender.mode()
            val builder = ProcessBuilder(helper.absolutePath, hostXid.toString(), pageUrl, data.absolutePath)
                .redirectError(ProcessBuilder.Redirect.INHERIT)
            builder.environment().apply {
                // The helper turns this into WebKit's own switches (and clears the player's).
                put("NUVIO_SHELL_RENDER", mode)
                put("GDK_BACKEND", "x11")
            }
            Logger.withTag("LinuxAppShell").i { "starting the interface helper, drawing mode $mode" }
            val process = builder.start()
            val window = LinuxAppShellWindow(process, sink, mode, onGone)
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

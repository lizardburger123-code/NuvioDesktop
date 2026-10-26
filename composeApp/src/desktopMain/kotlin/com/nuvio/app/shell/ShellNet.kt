package com.nuvio.app.shell

import co.touchlab.kermit.Logger
import com.nuvio.app.core.storage.DesktopStorage
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import okhttp3.Dns
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketAddress
import java.net.URI
import java.net.UnknownHostException
import java.security.KeyPairGenerator
import java.time.Instant
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

private val netJson = Json { ignoreUnknownKeys = true }
private fun JsonElement?.netObj(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
private fun JsonObject.netStr(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/**
 * "Unblock sites": a small proxy inside Nuvio that every part of the app goes through while it's
 * on — addon requests, posters and pictures in the interface, and the video player. It
 *  - looks names up over encrypted DNS (Cloudflare / Google by IP), so a name the provider blocks
 *    still resolves;
 *  - splits the TLS hello that carries the site name, so filters that read the name miss it;
 *  - or sends everything through Cloudflare WARP (built-in, free) or your own proxy / VPN.
 * Off by default; nothing changes until it's switched on.
 */
internal object ShellNet {
    enum class Mode(val id: String) {
        OFF("off"), UNBLOCK("unblock"), WARP("warp"), CUSTOM("custom");

        companion object {
            fun of(id: String?) = entries.firstOrNull { it.id == id } ?: OFF
        }
    }

    private val log = Logger.withTag("ShellNet")
    private val store by lazy { DesktopStorage.store("nuvio_shell") }
    private const val PreferredPort = 47231
    private val loopback: InetAddress = InetAddress.getLoopbackAddress()

    @Volatile var mode: Mode = Mode.OFF
        private set
    @Volatile var customProxy: String = ""
        private set
    @Volatile var port: Int = 0
        private set
    /** The interface (WebView) reads the proxy once at launch; this says whether it did. */
    @Volatile private var interfaceProxied = false

    internal val pool = Executors.newCachedThreadPool { runnable -> Thread(runnable, "nuvio-net").apply { isDaemon = true } }
    private var server: ServerSocket? = null

    /** First thing at launch, before any HTTP client exists. */
    fun install() {
        runCatching {
            mode = Mode.of(store.getString("net_mode"))
            customProxy = store.getString("net_proxy").orEmpty()
        }
        runCatching { ProxySelector.setDefault(Selector(ProxySelector.getDefault())) }
        // Always up: the interface falls back to it for pictures that won't load directly.
        runCatching { start() }.onFailure { log.w(it) { "local proxy didn't start" } }
        if (mode != Mode.OFF) {
            interfaceProxied = port > 0
            if (mode == Mode.WARP) pool.execute { runCatching { ShellWarp.ensureRunning() }.onFailure { log.w(it) { "WARP didn't start" } } }
        }
        writeProxyFile()
    }

    fun settings(): JsonElement = buildJsonObject {
        put("mode", mode.id)
        put("proxy", customProxy)
        put("port", port)
        put("restartForPictures", (mode != Mode.OFF) != interfaceProxied)
        put("warp", buildJsonObject {
            put("available", ShellWarp.available())
            put("state", ShellWarp.state)
            ShellWarp.error?.let { put("error", it) }
        })
    }

    fun apply(newMode: Mode, proxy: String?): JsonElement {
        if (newMode == Mode.CUSTOM) {
            val value = proxy?.trim().orEmpty()
            require(value.isNotEmpty()) { "Paste your proxy first, for example socks5://127.0.0.1:1080." }
            parseProxy(value) // throws with a readable message when it can't be used
            customProxy = value
            store.putString("net_proxy", value)
        }
        mode = newMode
        store.putString("net_mode", newMode.id)
        if (newMode != Mode.OFF) start()
        if (newMode == Mode.WARP) {
            pool.execute { runCatching { ShellWarp.ensureRunning() }.onFailure { log.w(it) { "WARP didn't start" } } }
        } else {
            ShellWarp.stop()
        }
        writeProxyFile()
        Doh.clear()
        return settings()
    }

    /** Fetch a link the way the app would now, and say how it went. */
    fun test(url: String): JsonElement {
        val target = url.trim().ifEmpty { "https://v3-cinemeta.strem.io/manifest.json" }
        require(target.startsWith("http://") || target.startsWith("https://")) { "Use a full link that starts with https://" }
        val builder = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).followRedirects(true)
        if (mode != Mode.OFF && port > 0) builder.proxy(Proxy(Proxy.Type.HTTP, InetSocketAddress(loopback, port))) else builder.proxy(Proxy.NO_PROXY)
        val started = System.currentTimeMillis()
        return try {
            builder.build().newCall(Request.Builder().url(target).header("User-Agent", BrowserAgent).get().build()).execute().use { response ->
                val bytes = response.body?.byteStream()?.let { stream -> val buffer = ByteArray(65_536); stream.read(buffer).coerceAtLeast(0) } ?: 0
                buildJsonObject {
                    put("ok", response.code in 200..399)
                    put("status", response.code)
                    put("ms", System.currentTimeMillis() - started)
                    put("bytes", bytes)
                }
            }
        } catch (error: Exception) {
            buildJsonObject {
                put("ok", false)
                put("ms", System.currentTimeMillis() - started)
                put("error", error.message ?: error.javaClass.simpleName)
            }
        }
    }

    // ---- Proxy server --------------------------------------------------------------------------

    @Synchronized
    private fun start() {
        if (server != null) return
        val socket = runCatching { ServerSocket(PreferredPort, 256, loopback) }.getOrNull()
            ?: ServerSocket(0, 256, loopback)
        server = socket
        port = socket.localPort
        Thread({ acceptLoop(socket) }, "nuvio-net-accept").apply { isDaemon = true }.start()
        log.i { "unblock proxy on 127.0.0.1:$port" }
    }

    private fun acceptLoop(socket: ServerSocket) {
        while (!socket.isClosed) {
            val client = try {
                socket.accept()
            } catch (_: IOException) {
                if (socket.isClosed) return
                Thread.sleep(50)
                continue
            }
            pool.execute {
                try {
                    handle(client)
                } catch (_: Exception) {
                } finally {
                    runCatching { client.close() }
                }
            }
        }
    }

    private fun handle(client: Socket) {
        client.tcpNoDelay = true
        client.soTimeout = 30_000
        val input = BufferedInputStream(client.getInputStream(), 32 * 1024)
        val head = readHead(input) ?: return
        val lines = String(head, Charsets.ISO_8859_1).split("\r\n")
        val parts = lines.first().split(" ")
        if (parts.size < 3) return
        val (method, target, version) = Triple(parts[0], parts[1], parts[2])
        val out = client.getOutputStream()
        if (method == "GET" && target.startsWith("/img?")) {
            serveImage(target, out)
            return
        }
        if (method.equals("CONNECT", ignoreCase = true)) {
            val (host, port) = hostPort(target, 443)
            val upstream = try {
                open(host, port)
            } catch (error: Exception) {
                log.d { "CONNECT $host failed: ${error.message}" }
                out.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                out.flush()
                return
            }
            out.write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray())
            out.flush()
            client.soTimeout = 0
            relay(client, input, upstream, host, tls = port == 443 && mode == Mode.UNBLOCK)
        } else {
            val uri = runCatching { URI(target) }.getOrNull() ?: return
            val host = uri.host ?: return
            val port = if (uri.port > 0) uri.port else 80
            val path = (uri.rawPath?.ifEmpty { null } ?: "/") + (uri.rawQuery?.let { "?$it" } ?: "")
            val kept = lines.drop(1).filter { line ->
                line.isNotEmpty() && !line.startsWith("Proxy-", ignoreCase = true) &&
                    !line.startsWith("Connection:", ignoreCase = true) && !line.startsWith("Keep-Alive:", ignoreCase = true)
            }
            val rebuilt = buildString {
                append(method).append(' ').append(path).append(' ').append(version).append("\r\n")
                kept.forEach { append(it).append("\r\n") }
                append("Connection: close\r\n\r\n")
            }
            val upstream = try {
                open(host, port)
            } catch (error: Exception) {
                out.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                out.flush()
                return
            }
            upstream.getOutputStream().apply { write(rebuilt.toByteArray(Charsets.ISO_8859_1)); flush() }
            client.soTimeout = 0
            relay(client, input, upstream, host, tls = false)
        }
    }

    private val imageClient by lazy {
        OkHttpClient.Builder().connectTimeout(12, TimeUnit.SECONDS).readTimeout(25, TimeUnit.SECONDS).followRedirects(true).build()
    }

    /**
     * Pictures the interface couldn't load (plain http, hotlink-protected, or blocked): fetched
     * here with a browser's headers and the unblock route, then handed back from 127.0.0.1.
     */
    private fun serveImage(target: String, out: OutputStream) {
        try {
            val url = java.net.URLDecoder.decode(target.substringAfter("u=").substringBefore("&"), Charsets.UTF_8)
            require(url.startsWith("http://") || url.startsWith("https://"))
            val origin = url.substringBefore("://") + "://" + url.substringAfter("://").substringBefore("/") + "/"
            val request = Request.Builder().url(url)
                .header("User-Agent", BrowserAgent)
                .header("Referer", origin)
                .header("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
                .get().build()
            imageClient.newCall(request).execute().use { response ->
                val bytes = response.body?.bytes() ?: ByteArray(0)
                val type = response.header("Content-Type") ?: "image/jpeg"
                out.write(("HTTP/1.1 ${response.code} OK\r\nContent-Type: $type\r\nContent-Length: ${bytes.size}\r\n" +
                    "Cache-Control: max-age=86400\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n").toByteArray())
                out.write(bytes)
                out.flush()
            }
        } catch (_: Exception) {
            out.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
            out.flush()
        }
    }

    /** Both directions until the server is done; the client's end half-closes so replies finish. */
    private fun relay(client: Socket, clientIn: InputStream, upstream: Socket, host: String, tls: Boolean) {
        val recordSplit = AtomicBoolean(false)
        pool.execute {
            try {
                val upOut = upstream.getOutputStream()
                if (tls) recordSplit.set(Hello.forward(clientIn, upOut, host))
                copy(clientIn, upOut)
                runCatching { upstream.shutdownOutput() }
            } catch (_: Exception) {
                runCatching { upstream.close() }
            }
        }
        var received = 0L
        try {
            received = copy(upstream.getInputStream(), client.getOutputStream())
        } catch (_: Exception) {
        }
        // A server that hangs up on a split hello without a word gets the plain split next time.
        if (recordSplit.get() && received == 0L) Hello.avoidRecordSplit(host)
        runCatching { upstream.close() }
        runCatching { client.close() }
    }

    private fun copy(input: InputStream, output: OutputStream): Long {
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            output.write(buffer, 0, n)
            output.flush()
            total += n
        }
        return total
    }

    private fun readHead(input: InputStream): ByteArray? {
        val out = ByteArrayOutputStream(1024)
        var match = 0
        while (out.size() < 64 * 1024) {
            val b = input.read()
            if (b < 0) return null
            out.write(b)
            match = when {
                (match == 0 || match == 2) && b == '\r'.code -> match + 1
                (match == 1 || match == 3) && b == '\n'.code -> match + 1
                b == '\r'.code -> 1
                else -> 0
            }
            if (match == 4) return out.toByteArray()
        }
        return null
    }

    private fun hostPort(target: String, defaultPort: Int): Pair<String, Int> {
        if (target.startsWith("[")) {
            val host = target.substringAfter("[").substringBefore("]")
            val port = target.substringAfter("]:", "").toIntOrNull() ?: defaultPort
            return host to port
        }
        val host = target.substringBeforeLast(":")
        val port = target.substringAfterLast(":", "").toIntOrNull()
        return if (port == null) target to defaultPort else host to port
    }

    // ---- Where a connection goes ---------------------------------------------------------------

    private fun open(host: String, port: Int): Socket = when (mode) {
        Mode.WARP -> Socks.connect(InetSocketAddress(loopback, ShellWarp.ensureRunning()), host, port, null, null)
        Mode.CUSTOM -> {
            val proxy = parseProxy(customProxy)
            val address = InetSocketAddress(proxy.host, proxy.port)
            if (proxy.socks) Socks.connect(address, host, port, proxy.user, proxy.password)
            else httpConnect(address, host, port, proxy.user, proxy.password)
        }
        Mode.UNBLOCK -> direct(host, port, Doh.resolve(host))
        Mode.OFF -> direct(host, port, InetAddress.getAllByName(host).toList())
    }

    private fun direct(host: String, port: Int, addresses: List<InetAddress>): Socket {
        var last: Exception? = null
        for (address in addresses.sortedBy { if (it is Inet4Address) 0 else 1 }.take(4)) {
            try {
                return Socket(Proxy.NO_PROXY).apply {
                    tcpNoDelay = true
                    connect(InetSocketAddress(address, port), 10_000)
                }
            } catch (error: Exception) {
                last = error
            }
        }
        throw last ?: UnknownHostException(host)
    }

    private fun httpConnect(proxy: InetSocketAddress, host: String, port: Int, user: String?, password: String?): Socket {
        val socket = Socket(Proxy.NO_PROXY).apply { tcpNoDelay = true; connect(proxy, 10_000); soTimeout = 15_000 }
        val auth = user?.let { "Proxy-Authorization: Basic ${Base64.getEncoder().encodeToString("$it:${password.orEmpty()}".toByteArray())}\r\n" }.orEmpty()
        socket.getOutputStream().apply {
            write("CONNECT $host:$port HTTP/1.1\r\nHost: $host:$port\r\n$auth\r\n".toByteArray(Charsets.ISO_8859_1))
            flush()
        }
        val head = readHead(socket.getInputStream()) ?: run { socket.close(); error("Your proxy closed the connection.") }
        val status = String(head, Charsets.ISO_8859_1).substringBefore("\r\n")
        if (status.split(" ").getOrNull(1) != "200") {
            socket.close()
            error("Your proxy refused: $status")
        }
        socket.soTimeout = 0
        return socket
    }

    data class ProxySpec(val socks: Boolean, val host: String, val port: Int, val user: String?, val password: String?)

    fun parseProxy(raw: String): ProxySpec {
        val value = raw.trim().let { if ("://" in it) it else "socks5://$it" }
        val uri = runCatching { URI(value) }.getOrNull() ?: error("That proxy link isn't valid.")
        val scheme = uri.scheme?.lowercase()
        val socks = when (scheme) {
            "socks", "socks5", "socks5h" -> true
            "http", "https" -> false
            else -> error("Use a socks5:// or http:// proxy link.")
        }
        val host = uri.host ?: error("The proxy link needs a host, like socks5://127.0.0.1:1080.")
        val port = uri.port.takeIf { it > 0 } ?: if (socks) 1080 else 8080
        val info = uri.rawUserInfo?.split(":", limit = 2)
        val decode = { s: String -> java.net.URLDecoder.decode(s, Charsets.UTF_8) }
        return ProxySpec(socks, host, port, info?.getOrNull(0)?.let(decode), info?.getOrNull(1)?.let(decode))
    }

    // ---- How the rest of the app gets here -----------------------------------------------------

    private class Selector(private val fallback: ProxySelector?) : ProxySelector() {
        override fun select(uri: URI?): List<Proxy> {
            val current = port
            val host = uri?.host
            val scheme = uri?.scheme?.lowercase()
            if (mode == Mode.OFF || current == 0 || host == null || isLocal(host) || (scheme != "http" && scheme != "https")) {
                return fallback?.select(uri) ?: listOf(Proxy.NO_PROXY)
            }
            return listOf(Proxy(Proxy.Type.HTTP, InetSocketAddress(InetAddress.getLoopbackAddress(), current)))
        }

        override fun connectFailed(uri: URI?, sa: SocketAddress?, ioe: IOException?) {
            runCatching { fallback?.connectFailed(uri, sa, ioe) }
        }
    }

    fun isLocal(host: String): Boolean {
        val h = host.lowercase().trim('[', ']')
        if (h == "localhost" || h == "::1" || h.endsWith(".local") || h.endsWith(".localhost")) return true
        if (h.startsWith("127.") || h.startsWith("10.") || h.startsWith("192.168.") || h.startsWith("169.254.")) return true
        if (h.startsWith("172.")) h.split(".").getOrNull(1)?.toIntOrNull()?.let { if (it in 16..31) return true }
        return false
    }

    /** The player (mpv) and the interface (WebView) read this file to use the proxy. */
    private fun writeProxyFile() {
        runCatching {
            val dir = netDir()
            val file = File(dir, "proxy.txt")
            if (mode != Mode.OFF && port > 0) file.writeText("http://127.0.0.1:$port") else file.delete()
        }
    }

    fun netDir(): File = File(System.getenv("LOCALAPPDATA") ?: System.getProperty("java.io.tmpdir"), "Nuvio${File.separator}net").apply { mkdirs() }

    const val BrowserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"

    // ---- Encrypted DNS -------------------------------------------------------------------------

    internal object Doh : Dns {
        private val cache = ConcurrentHashMap<String, Pair<List<InetAddress>, Long>>()
        private val client by lazy {
            OkHttpClient.Builder().proxy(Proxy.NO_PROXY).connectTimeout(5, TimeUnit.SECONDS).readTimeout(6, TimeUnit.SECONDS).build()
        }
        private val endpoints = listOf(
            "https://1.1.1.1/dns-query?name=%s&type=A",
            "https://8.8.8.8/resolve?name=%s&type=A",
            "https://1.0.0.1/dns-query?name=%s&type=A",
            "https://8.8.4.4/resolve?name=%s&type=A",
        )
        private val ipv4 = Regex("""^\d{1,3}(\.\d{1,3}){3}$""")

        fun clear() = cache.clear()

        override fun lookup(hostname: String): List<InetAddress> = resolve(hostname)

        fun resolve(host: String): List<InetAddress> {
            if (ipv4.matches(host) || ':' in host) return listOf(InetAddress.getByName(host))
            if (isLocal(host)) return InetAddress.getAllByName(host).toList()
            cache[host]?.let { (addresses, until) -> if (System.currentTimeMillis() < until) return addresses }
            for (endpoint in endpoints) {
                val (ips, ttl) = runCatching { query(endpoint.format(java.net.URLEncoder.encode(host, Charsets.UTF_8))) }.getOrNull() ?: continue
                if (ips.isEmpty()) continue
                val addresses = ips.map { InetAddress.getByAddress(host, InetAddress.getByName(it).address) }
                cache[host] = addresses to System.currentTimeMillis() + ttl.coerceIn(60L, 3600L) * 1000L
                return addresses
            }
            return InetAddress.getAllByName(host).toList()
        }

        private fun query(url: String): Pair<List<String>, Long> {
            val request = Request.Builder().url(url).header("accept", "application/dns-json").get().build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return emptyList<String>() to 0L
                val root = netJson.parseToJsonElement(response.body?.string().orEmpty()).netObj()
                val answers = (root["Answer"] as? JsonArray).orEmpty().map { it.netObj() }
                    .filter { it.netStr("type") == "1" }
                val ips = answers.mapNotNull { it.netStr("data") }.filter { ipv4.matches(it) }
                val ttl = answers.mapNotNull { it.netStr("TTL")?.toLongOrNull() }.minOrNull() ?: 300
                return ips to ttl
            }
        }
    }

    // ---- TLS hello splitting -------------------------------------------------------------------

    private object Hello {
        private val noRecordSplit = ConcurrentHashMap.newKeySet<String>()

        fun avoidRecordSplit(host: String) {
            noRecordSplit += host
        }

        /** Sends the client's first TLS record in pieces. Returns whether it split the record itself. */
        fun forward(input: InputStream, out: OutputStream, host: String): Boolean {
            val first = ByteArray(16 * 1024)
            var size = input.read(first)
            if (size <= 0) return false
            if (size >= 5 && first[0].toInt() == 0x16) {
                val recordLength = u16(first, 3)
                // Read the whole hello (it may arrive in a few pieces).
                while (size < 5 + recordLength && size < first.size) {
                    val n = input.read(first, size, minOf(first.size - size, 5 + recordLength - size))
                    if (n <= 0) break
                    size += n
                }
            }
            val data = first.copyOf(size)
            if (data.size < 6 || data[0].toInt() != 0x16) {
                out.write(data)
                out.flush()
                return false
            }
            val recordEnd = minOf(data.size, 5 + u16(data, 3))
            val sni = sniOffset(data)
            val cut = (if (sni in 6 until recordEnd) sni + 1 else 6).coerceIn(6, maxOf(6, recordEnd - 1))
            val complete = recordEnd == 5 + u16(data, 3)
            if (complete && cut < recordEnd && host !in noRecordSplit) {
                val one = record(data, data.copyOfRange(5, cut))
                val two = record(data, data.copyOfRange(cut, recordEnd))
                out.write(one, 0, 1); out.flush(); pause()
                out.write(one, 1, one.size - 1); out.flush(); pause()
                out.write(two)
                if (data.size > recordEnd) out.write(data, recordEnd, data.size - recordEnd)
                out.flush()
                return true
            }
            out.write(data, 0, 1); out.flush(); pause()
            out.write(data, 1, cut - 1); out.flush(); pause()
            out.write(data, cut, data.size - cut); out.flush()
            return false
        }

        private fun pause() = runCatching { Thread.sleep(2) }

        private fun record(original: ByteArray, payload: ByteArray): ByteArray = ByteArray(5 + payload.size).also {
            it[0] = 0x16
            it[1] = original[1]
            it[2] = original[2]
            it[3] = (payload.size shr 8).toByte()
            it[4] = payload.size.toByte()
            payload.copyInto(it, 5)
        }

        private fun u16(d: ByteArray, at: Int) = ((d[at].toInt() and 0xff) shl 8) or (d[at + 1].toInt() and 0xff)

        /** Where the site name starts inside the hello, or -1. */
        private fun sniOffset(d: ByteArray): Int {
            try {
                var i = 5
                if (d[i].toInt() != 1) return -1
                i += 4
                i += 2 + 32
                i += 1 + (d[i].toInt() and 0xff)
                i += 2 + u16(d, i)
                i += 1 + (d[i].toInt() and 0xff)
                val end = i + 2 + u16(d, i)
                i += 2
                while (i + 4 <= end && i + 4 <= d.size) {
                    val type = u16(d, i)
                    val length = u16(d, i + 2)
                    if (type == 0) return (i + 9).takeIf { it < d.size } ?: -1
                    i += 4 + length
                }
            } catch (_: IndexOutOfBoundsException) {
            }
            return -1
        }
    }

    // ---- SOCKS5 --------------------------------------------------------------------------------

    internal object Socks {
        fun connect(proxy: InetSocketAddress, host: String, port: Int, user: String?, password: String?): Socket {
            val socket = Socket(Proxy.NO_PROXY).apply { tcpNoDelay = true; connect(proxy, 10_000); soTimeout = 20_000 }
            try {
                val out = socket.getOutputStream()
                val input = DataInputStream(socket.getInputStream())
                out.write(if (user != null) byteArrayOf(5, 2, 0, 2) else byteArrayOf(5, 1, 0))
                out.flush()
                if (input.readUnsignedByte() != 5) error("That isn't a SOCKS5 proxy.")
                when (input.readUnsignedByte()) {
                    0 -> Unit
                    2 -> {
                        val u = user.orEmpty().toByteArray()
                        val p = password.orEmpty().toByteArray()
                        out.write(byteArrayOf(1, u.size.toByte()) + u + byteArrayOf(p.size.toByte()) + p)
                        out.flush()
                        input.readUnsignedByte()
                        if (input.readUnsignedByte() != 0) error("The proxy didn't accept the user name or password.")
                    }
                    else -> error("The proxy wants a sign-in Nuvio doesn't support.")
                }
                val name = host.toByteArray()
                out.write(byteArrayOf(5, 1, 0, 3, name.size.toByte()) + name + byteArrayOf((port shr 8).toByte(), port.toByte()))
                out.flush()
                input.readUnsignedByte()
                val reply = input.readUnsignedByte()
                input.readUnsignedByte()
                val skip = when (input.readUnsignedByte()) {
                    1 -> 4
                    4 -> 16
                    3 -> input.readUnsignedByte()
                    else -> 0
                }
                input.readFully(ByteArray(skip + 2))
                if (reply != 0) error("The proxy couldn't reach $host (code $reply).")
                socket.soTimeout = 0
                return socket
            } catch (error: Exception) {
                runCatching { socket.close() }
                throw error
            }
        }
    }
}

/**
 * Cloudflare WARP, free, built in: a WireGuard tunnel run by the bundled wireproxy, which offers
 * it to Nuvio as a local SOCKS5 proxy. The device registers with WARP once (no account).
 */
internal object ShellWarp {
    private val log = Logger.withTag("ShellWarp")
    private val store by lazy { DesktopStorage.store("nuvio_shell") }
    private const val PeerKey = "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo="
    private const val Api = "https://api.cloudflareclient.com/v0a1922"

    @Volatile private var process: Process? = null
    @Volatile private var socksPort = 0
    @Volatile var state: String = "off"
        private set
    @Volatile var error: String? = null
        private set
    private val hooked = AtomicBoolean(false)

    fun available(): Boolean = ShellWarp::class.java.getResource("/net/wireproxy.exe") != null

    @Synchronized
    fun ensureRunning(): Int {
        val running = process
        if (running != null && running.isAlive && socksPort > 0) return socksPort
        if (!available()) fail("WARP isn't included in this build of Nuvio.")
        state = "starting"
        error = null
        try {
            val dir = ShellNet.netDir()
            val exe = File(dir, "wireproxy.exe")
            ShellWarp::class.java.getResourceAsStream("/net/wireproxy.exe")!!.use { input ->
                val bytes = input.readBytes()
                if (!exe.exists() || exe.length() != bytes.size.toLong()) exe.writeBytes(bytes)
            }
            val account = account()
            val port = ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { it.localPort }
            val config = File(dir, "warp.conf")
            config.writeText(
                """
                [Interface]
                PrivateKey = ${account.privateKey}
                Address = ${account.address}/32
                DNS = 1.1.1.1
                MTU = 1280

                [Peer]
                PublicKey = ${account.peerKey}
                Endpoint = ${account.endpoint}
                KeepAlive = 25

                [Socks5]
                BindAddress = 127.0.0.1:$port
                """.trimIndent() + "\n",
            )
            val started = ProcessBuilder(exe.absolutePath, "-s", "-c", config.absolutePath)
                .redirectErrorStream(true)
                .redirectOutput(File(dir, "wireproxy.log"))
                .start()
            process = started
            if (hooked.compareAndSet(false, true)) Runtime.getRuntime().addShutdownHook(Thread { process?.destroy() })
            val deadline = System.currentTimeMillis() + 15_000
            while (System.currentTimeMillis() < deadline) {
                if (!started.isAlive) fail("WARP stopped right away (see ${File(dir, "wireproxy.log").absolutePath}).")
                val up = runCatching {
                    Socket(Proxy.NO_PROXY).use { it.connect(InetSocketAddress(InetAddress.getLoopbackAddress(), port), 400) }
                }.isSuccess
                if (up) {
                    socksPort = port
                    state = "on"
                    log.i { "WARP up on 127.0.0.1:$port" }
                    return port
                }
                Thread.sleep(250)
            }
            started.destroy()
            fail("WARP didn't come up in time.")
        } catch (failure: Exception) {
            state = "failed"
            error = failure.message
            throw failure
        }
    }

    @Synchronized
    fun stop() {
        process?.destroy()
        process = null
        socksPort = 0
        state = "off"
        error = null
    }

    private fun fail(message: String): Nothing {
        state = "failed"
        error = message
        throw IllegalStateException(message)
    }

    private data class Account(val privateKey: String, val address: String, val peerKey: String, val endpoint: String)

    private fun account(): Account {
        val saved = store.getString("warp_account")?.split("|")
        if (saved != null && saved.size == 4) return Account(saved[0], saved[1], saved[2], saved[3])
        val pair = KeyPairGenerator.getInstance("X25519").generateKeyPair()
        val publicKey = pair.public.encoded.takeLast(32).toByteArray()
        val privateKey = pair.private.encoded.takeLast(32).toByteArray()
        val encoder = Base64.getEncoder()
        val body = buildJsonObject {
            put("key", encoder.encodeToString(publicKey))
            put("install_id", "")
            put("fcm_token", "")
            put("tos", Instant.now().toString())
            put("model", "PC")
            put("serial_number", "")
            put("locale", "en_US")
        }.toString()
        // Registration resolves over encrypted DNS so it works where the name is blocked.
        val client = OkHttpClient.Builder().proxy(Proxy.NO_PROXY).dns(ShellNet.Doh)
            .connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()
        val request = Request.Builder().url("$Api/reg")
            .header("User-Agent", "okhttp/3.12.1")
            .header("CF-Client-Version", "a-6.3-1922")
            .post(body.toRequestBody("application/json; charset=UTF-8".toMediaType()))
            .build()
        val root = client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) fail("WARP sign-up was refused (${response.code}).")
            netJson.parseToJsonElement(text).netObj()
        }
        val config = root["config"].netObj()
        val peer = (config["peers"] as? JsonArray)?.firstOrNull().netObj()
        val peerKey = peer.netStr("public_key") ?: PeerKey
        val v4 = peer["endpoint"].netObj().netStr("v4")?.substringBeforeLast(":")?.takeIf { it.isNotBlank() } ?: "162.159.192.1"
        val address = config["interface"].netObj()["addresses"].netObj().netStr("v4") ?: "172.16.0.2"
        // Make sure the tunnel is switched on for this device (it is by default; harmless if so).
        val id = root.netStr("id")
        val token = root.netStr("token")
        if (id != null && token != null) {
            runCatching {
                client.newCall(
                    Request.Builder().url("$Api/reg/$id")
                        .header("User-Agent", "okhttp/3.12.1")
                        .header("CF-Client-Version", "a-6.3-1922")
                        .header("Authorization", "Bearer $token")
                        .patch("""{"warp_enabled":true}""".toRequestBody("application/json; charset=UTF-8".toMediaType()))
                        .build(),
                ).execute().close()
            }
        }
        val account = Account(encoder.encodeToString(privateKey), address, peerKey, "$v4:2408")
        store.putString("warp_account", listOf(account.privateKey, account.address, account.peerKey, account.endpoint).joinToString("|"))
        return account
    }
}

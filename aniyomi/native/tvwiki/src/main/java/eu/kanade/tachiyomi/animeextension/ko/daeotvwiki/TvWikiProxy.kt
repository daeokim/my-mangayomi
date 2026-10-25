package eu.kanade.tachiyomi.animeextension.ko.daeotvwiki

import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.io.BufferedOutputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Loopback-only proxy: rewrites HLS references and decodes this site's JSON key envelopes. */
internal object TvWikiProxy {
    private data class Resource(val url: String, val key: Boolean)
    private class Session(val client: OkHttpClient, val headers: Headers) {
        var usedAt = System.nanoTime()
        val resources = LinkedHashMap<String, Resource>()
        val reverse = HashMap<Resource, String>()
        // The master playlist fetched by open(): (requested URL, final URL for relative references, body).
        // TVWiki now issues playlist URLs with a token that may be single-use, so it is never fetched twice.
        @Volatile var primed: Triple<String, String, ByteArray>? = null
    }
    private val sessions = LinkedHashMap<String, Session>()
    private var server: ServerSocket? = null
    private val pool = ThreadPoolExecutor(4, 8, 30, TimeUnit.SECONDS, ArrayBlockingQueue(16), { r ->
        Thread(r, "Daeo-HLS-request").apply { isDaemon = true }
    }).apply { allowCoreThreadTimeOut(true) }
    fun open(client: OkHttpClient, playlist: String, headers: Headers): String {
        require(playlist.toHttpUrl().isHttps) { "HLS에는 HTTPS 주소가 필요합니다." }
        val session = Session(client.newBuilder().callTimeout(45, TimeUnit.SECONDS).build(), headers)
        val id = UUID.randomUUID().toString()
        val url = synchronized(this) {
            start(); prune()
            while (sessions.size >= 8) sessions.remove(sessions.keys.first())
            sessions[id] = session
            route(id, playlist, false)
        }
        // Do not hold the session lock during network I/O: existing playback must continue.
        try {
            session.client.newCall(Request.Builder().url(playlist).headers(headers).build()).execute().use { r ->
                require(r.isSuccessful && r.body!!.source().peek().readUtf8(7) == "#EXTM3U") { "사이트 재생목록을 불러오지 못했습니다." }
                val source = r.body!!.source()
                require(!source.request(2L * 1024 * 1024 + 1)) { "재생목록이 너무 큽니다." }
                session.primed = Triple(playlist, r.request.url.toString(), source.readByteArray())
                DeviceLog.e("tvwiki open OK ${r.request.url} " + String(session.primed!!.third, Charsets.UTF_8).lineSequence().take(6).joinToString(" | "))
            }
        } catch (error: Exception) {
            DeviceLog.e("tvwiki open FAILED $playlist ${error.javaClass.simpleName}: ${error.message}")
            synchronized(this) { sessions.remove(id) }
            throw error
        }
        return url
    }
    private fun start() {
        if (server != null) return
        val socket = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        server = socket
        Thread({
            while (!socket.isClosed) {
                val connection = try { socket.accept() } catch (_: Exception) { break }
                try { pool.execute { connection.use { runCatching { handle(it) } } } }
                catch (_: Exception) { connection.close() }
            }
        }, "Daeo-HLS-listener").apply { isDaemon = true; start() }
    }
    private fun prune() {
        val oldest = System.nanoTime() - TimeUnit.HOURS.toNanos(4)
        sessions.entries.removeAll { it.value.usedAt < oldest }
    }
    @Synchronized private fun route(id: String, url: String, key: Boolean): String {
        val parsed = url.toHttpUrl()
        require(parsed.isHttps && parsed.username.isEmpty() && parsed.password.isEmpty()) { "HLS 주소 오류" }
        val session = sessions[id] ?: error("재생 세션이 만료되었습니다.")
        val resource = Resource(url, key)
        val token = session.reverse[resource] ?: UUID.randomUUID().toString().also {
            require(session.resources.size < 20000) { "재생목록 리소스 한도 초과" }
            session.resources[it] = resource
            session.reverse[resource] = it
        }
        // A .m3u8 suffix keeps native players' format inference compatible.
        return "http://127.0.0.1:${server!!.localPort}/$id/$token/${if (key) "key.bin" else "stream.m3u8"}"
    }
    private fun handle(socket: Socket) {
        socket.soTimeout = 15000
        val input = socket.getInputStream().bufferedReader(Charsets.US_ASCII)
        val first = input.readLine() ?: return
        require(first.length < 8192)
        val words = first.split(' ')
        val out = BufferedOutputStream(socket.getOutputStream())
        if (words.size != 3 || words[0] !in listOf("GET", "HEAD")) { reply(out, 405, "text/plain", "Method not allowed".toByteArray()); return }
        val requestHeaders = HashMap<String, String>()
        var length = 0
        while (true) {
            val line = input.readLine() ?: return
            length += line.length
            require(length < 16384)
            if (line.isEmpty()) break
            val colon = line.indexOf(':')
            if (colon > 0) requestHeaders[line.substring(0, colon).lowercase()] = line.substring(colon + 1).trim()
        }
        val parts = words[1].split('?')[0].trim('/').split('/')
        if (parts.size != 3) { reply(out, 404, "text/plain", byteArrayOf()); return }
        val (session, resource) = synchronized(this) {
            prune()
            val s = sessions[parts[0]]
            s?.usedAt = System.nanoTime()
            Pair(s, s?.resources?.get(parts[1]))
        }
        if (session == null || resource == null) { reply(out, 404, "text/plain", byteArrayOf()); return }
        val primed = session.primed
        if (!resource.key && primed != null && primed.first == resource.url) {
            val output = runCatching {
                TvWikiParsing.rewritePlaylist(String(primed.third, Charsets.UTF_8), primed.second) { url, key -> route(parts[0], url, key) }.toByteArray()
            }.getOrNull()
            if (output != null) { reply(out, 200, "application/vnd.apple.mpegurl", output, words[0] == "HEAD"); return }
        }
        try {
            val builder = Request.Builder().url(resource.url).headers(session.headers).header("Accept-Encoding", "identity")
            requestHeaders["range"]?.takeIf { Regex("bytes=\\d*-\\d*").matches(it) }?.let { builder.header("Range", it) }
            session.client.newCall(builder.build()).execute().use { response ->
                val body = response.body ?: error("Empty response")
                if (!response.isSuccessful) {
                    DeviceLog.e("tvwiki proxy ${if (resource.key) "key" else "media"} ${resource.url} -> HTTP ${response.code} ${response.header("Server").orEmpty()} " +
                        DeviceLog.snippet(runCatching { val peek = body.source().peek(); peek.request(4096); peek.readUtf8(minOf(4096L, peek.buffer.size)) }.getOrNull()))
                    reply(out, response.code, "text/plain", "영상 서버 요청 실패".toByteArray()); return
                }
                val source = body.source()
                val playlist = !resource.key && source.request(7) && source.peek().readUtf8(7) == "#EXTM3U"
                if (resource.key || playlist) {
                    require(body.contentLength() <= 2 * 1024 * 1024)
                    val limited = source.readByteArray( minOf(2 * 1024 * 1024L, if (body.contentLength() >= 0) body.contentLength() else 0L))
                    // Unknown/chunked bodies need a bounded read too.
                    val bytes = if (body.contentLength() >= 0) limited else {
                        val buffer = okio.Buffer()
                        while (!source.exhausted()) {
                            val n = source.read(buffer, 8192)
                            if (n < 0) break
                            require(buffer.size <= 2 * 1024 * 1024)
                        }
                        buffer.readByteArray()
                    }
                    val output = if (resource.key) TvWikiParsing.decodeKey(bytes) else TvWikiParsing.rewritePlaylist(String(bytes, Charsets.UTF_8), response.request.url.toString()) { url, key -> route(parts[0], url, key) }.toByteArray()
                    reply(out, 200, if (resource.key) "application/octet-stream" else "application/vnd.apple.mpegurl", output, words[0] == "HEAD")
                } else {
                    val contentType = response.header("Content-Type") ?: "application/octet-stream"
                    header(out, response.code, contentType, body.contentLength(), response.header("Content-Range"))
                    if (words[0] != "HEAD") body.byteStream().copyTo(out)
                    out.flush()
                }
            }
        } catch (error: Exception) {
            DeviceLog.e("tvwiki proxy ${resource.url} failed ${error.javaClass.simpleName}: ${error.message}")
            runCatching { reply(out, 502, "text/plain", "영상 중계 요청 실패".toByteArray()) }
        }
    }
    private fun header(out: OutputStream, code: Int, type: String, length: Long, range: String? = null) {
        val h = StringBuilder("HTTP/1.1 $code ${if (code < 400) "OK" else "Error"}\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Type: $type\r\n")
        if (length >= 0) h.append("Content-Length: $length\r\n")
        if (range != null) h.append("Content-Range: $range\r\n")
        h.append("\r\n")
        out.write(h.toString().toByteArray(Charsets.US_ASCII))
    }
    private fun reply(out: OutputStream, code: Int, type: String, bytes: ByteArray, head: Boolean = false) {
        header(out, code, type, bytes.size.toLong())
        if (!head) out.write(bytes)
        out.flush()
    }
}

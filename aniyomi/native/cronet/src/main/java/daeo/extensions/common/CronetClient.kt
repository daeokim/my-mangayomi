package daeo.extensions.common

import android.content.Context
import android.os.Build
import android.os.Process
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okio.source
import okio.buffer
import org.chromium.net.CronetEngine
import org.chromium.net.impl.NativeCronetEngineBuilderWithLibraryLoaderImpl
import java.io.File
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.CRC32
import java.util.zip.ZipFile

/** Source-owned Chromium transport. Host image loaders and the external player keep their own clients. */
object CronetClient {
    private val engines = ConcurrentHashMap<String, CronetEngine>()
    private val watchdog = Executors.newSingleThreadScheduledExecutor { task -> Thread(task, "daeo-cronet-cancel").apply { isDaemon = true } }

    fun create(upstream: OkHttpClient, extensionPackage: String): OkHttpClient = upstream.newBuilder()
        .addInterceptor(Transport(upstream.cookieJar, upstream.followRedirects, upstream.followSslRedirects) { url ->
            try {
                engine(extensionPackage).openConnection(url) as HttpURLConnection
            } catch (e: LinkageError) {
                throw IOException("Cronet native initialization failed; update the extension and restart Aniyomi", e)
            } catch (e: ReflectiveOperationException) {
                throw IOException("Cronet application context unavailable; restart Aniyomi", e)
            }
        }).build()

    /** OkHttp builder copies interceptors: reconfigure this application transport as well. */
    fun withoutRedirects(upstream: OkHttpClient): OkHttpClient {
        val builder = upstream.newBuilder().followRedirects(false).followSslRedirects(false)
        for (index in builder.interceptors().indices) {
            val interceptor = builder.interceptors()[index]
            if (interceptor is Transport) builder.interceptors()[index] = interceptor.withoutRedirects()
        }
        return builder.build()
    }

    private fun engine(pkg: String): CronetEngine = engines.getOrPut(pkg) {
        synchronized(engines) {
            engines[pkg] ?: run {
                val context = Class.forName("android.app.ActivityThread").getMethod("currentApplication").invoke(null) as? Context
                    ?: throw IOException("Cronet: Android application context unavailable")
                CronetEngine.Builder(NativeCronetEngineBuilderWithLibraryLoaderImpl(context))
                    .setLibraryLoader(object : CronetEngine.Builder.LibraryLoader() {
                        override fun loadLibrary(name: String) = loadNative(context, pkg, name)
                    }).enableHttp2(true).enableQuic(true).enableBrotli(true).build()
                    .also { engines[pkg] = it }
            }
        }
    }

    /** Extensions are loaded from another APK; System.loadLibrary would search the host APK. */
    private fun loadNative(context: Context, pkg: String, name: String) {
        require(name.matches(Regex("[A-Za-z0-9._-]+"))) { "Invalid native library name" }
        val apk = context.packageManager.getApplicationInfo(pkg, 0).sourceDir
        val abis = if (Process.is64Bit()) Build.SUPPORTED_64_BIT_ABIS else Build.SUPPORTED_32_BIT_ABIS
        ZipFile(apk).use { zip ->
            val entry = abis.asSequence().mapNotNull { zip.getEntry("lib/$it/lib$name.so") }.firstOrNull()
                ?: throw IOException("Cronet: unsupported process ABI")
            val directory = File(context.codeCacheDir, "daeo-cronet/$pkg/${entry.crc}")
            if (!directory.isDirectory && !directory.mkdirs()) throw IOException("Cronet: cannot create native cache")
            val library = File(directory, "lib$name.so")
            synchronized((pkg + name).intern()) {
                fun valid(): Boolean {
                    if (!library.isFile || library.length() != entry.size) return false
                    val crc = CRC32()
                    library.inputStream().use { input -> val buffer = ByteArray(32768); while (true) { val n = input.read(buffer); if (n < 0) break; crc.update(buffer, 0, n) } }
                    return crc.value == entry.crc
                }
                if (!valid()) {
                    val temp = File.createTempFile("cronet-", ".so", directory)
                    try {
                        zip.getInputStream(entry).use { input -> temp.outputStream().use { out -> input.copyTo(out); out.fd.sync() } }
                        if (temp.length() != entry.size) throw IOException("Cronet: incomplete native library")
                        if (!temp.setReadable(true, true) || !temp.setExecutable(true, true) || !temp.setWritable(false, false)) throw IOException("Cronet: native cache permissions")
                        if (!temp.renameTo(library)) throw IOException("Cronet: cannot install native cache")
                        if (!valid()) { library.delete(); throw IOException("Cronet: native library checksum mismatch") }
                    } finally { temp.delete() }
                }
                System.load(library.absolutePath)
            }
        }
    }

    internal class Transport(
        private val cookies: CookieJar,
        private val followRedirects: Boolean,
        private val followSslRedirects: Boolean,
        private val open: (URL) -> HttpURLConnection,
    ) : Interceptor {
        fun withoutRedirects() = Transport(cookies, false, false, open)
        override fun intercept(chain: Interceptor.Chain): Response {
            var request = chain.request()
            val started = System.nanoTime()
            val callTimeout = chain.call().timeout()
            val duration = callTimeout.timeoutNanos()
            val deadline = minOf(if (duration > 0) started + duration else Long.MAX_VALUE,
                if (callTimeout.hasDeadline()) callTimeout.deadlineNanoTime() else Long.MAX_VALUE)
            repeat(9) { hop ->
                if (chain.call().isCanceled()) throw IOException("Canceled")
                val connection = open(request.url.toUrl())
                var owned = false
                val receivedHeaders = VolatileFlag()
                val headerBudget = maxOf(chain.connectTimeoutMillis(), chain.readTimeoutMillis()).toLong()
                val headerDeadline = if (headerBudget > 0) System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(headerBudget) else Long.MAX_VALUE
                val cancel = watchdog.scheduleAtFixedRate({
                    if (chain.call().isCanceled() || System.nanoTime() >= deadline || (!receivedHeaders.value && System.nanoTime() >= headerDeadline)) connection.disconnect()
                }, 0, 100, TimeUnit.MILLISECONDS)
                try {
                    connection.instanceFollowRedirects = false
                    connection.useCaches = false
                    connection.readTimeout = chain.readTimeoutMillis()
                    connection.requestMethod = request.method
                    for (i in 0 until request.headers.size) {
                        val name = request.headers.name(i)
                        // Chromium owns framing and decompression; never forward hop-by-hop framing.
                        if (name.lowercase() !in setOf("host", "connection", "content-length", "transfer-encoding", "accept-encoding")) connection.addRequestProperty(name, request.headers.value(i))
                    }
                    if (request.header("Cookie") == null) {
                        val values = cookies.loadForRequest(request.url)
                        if (values.isNotEmpty()) connection.setRequestProperty("Cookie", values.joinToString("; ") { "${it.name}=${it.value}" })
                    }
                    request.body?.let { body ->
                        if (body.isDuplex() || body.isOneShot()) throw IOException("Cronet does not support duplex/one-shot source requests")
                        if (request.header("Content-Type") == null) body.contentType()?.let { connection.setRequestProperty("Content-Type", it.toString()) }
                        if (body.contentLength() > 8L * 1024 * 1024) throw IOException("Cronet source upload exceeds 8 MiB")
                        val data = okio.Buffer(); body.writeTo(data)
                        if (data.size > 8L * 1024 * 1024) throw IOException("Cronet source upload exceeds 8 MiB")
                        connection.doOutput = true
                        connection.setFixedLengthStreamingMode(data.size)
                        connection.outputStream.use { out -> data.inputStream().use { it.copyTo(out) } }
                    }
                    val code = connection.responseCode
                    receivedHeaders.value = true
                    if (chain.call().isCanceled()) throw IOException("Canceled")
                    if (System.nanoTime() >= deadline || System.nanoTime() >= headerDeadline) throw java.net.SocketTimeoutException("Cronet response timeout")
                    val headers = Headers.Builder()
                    for ((name, values) in connection.headerFields) if (name != null) for (value in values) {
                        if (!name.equals("Content-Encoding", true) && !(connection.contentEncoding != null && name.equals("Content-Length", true))) headers.add(name, value)
                    }
                    val builtHeaders = headers.build()
                    cookies.saveFromResponse(request.url, Cookie.parseAll(request.url, builtHeaders))
                    val next = redirect(request, code, builtHeaders["Location"], followRedirects, followSslRedirects)
                    if (next != null) {
                        if (hop == 8) throw IOException("Too many Cronet redirects")
                        request = next
                    } else {
                        // Cronet intentionally exposes no body for an unfollowed redirect.
                        val redirectStatus = code in 300..399 && code != 304
                        val input = if (redirectStatus) null else if (code >= 400) connection.errorStream else connection.inputStream
                        val stream = object : FilterInputStream(input ?: object : InputStream() { override fun read() = -1 }) {
                            override fun close() { try { super.close() } finally { cancel.cancel(false); connection.disconnect() } }
                        }
                        val source = stream.source().buffer()
                        if (redirectStatus) headers.removeAll("Content-Length")
                        val responseHeaders = headers.build()
                        val length = if (redirectStatus) 0L else if (connection.contentEncoding == null) builtHeaders["Content-Length"]?.toLongOrNull() ?: -1L else -1L
                        val body = object : ResponseBody() {
                            override fun contentType() = builtHeaders["Content-Type"]?.toMediaTypeOrNull()
                            override fun contentLength() = length
                            override fun source() = source
                        }
                        val response = Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code)
                            .message(connection.responseMessage.orEmpty()).headers(responseHeaders).body(body)
                            .sentRequestAtMillis(System.currentTimeMillis()).receivedResponseAtMillis(System.currentTimeMillis()).build()
                        owned = true
                        return response
                    }
                } catch (e: Exception) {
                    if (e is IOException) throw e
                    throw IOException("Cronet request failed: ${e.message}", e)
                } finally {
                    if (!owned) { cancel.cancel(false); connection.disconnect() }
                }
            }
            throw IOException("Too many Cronet redirects")
        }
    }

    private class VolatileFlag { @Volatile var value = false }

    internal fun redirect(request: Request, code: Int, location: String?, follow: Boolean, ssl: Boolean): Request? {
        if (!follow || code !in listOf(300, 301, 302, 303, 307, 308)) return null
        val target = location?.let(request.url::resolve) ?: return null
        if (target.scheme != request.url.scheme && !ssl) return null
        val builder = request.newBuilder().url(target)
        if (code == 303 && request.method != "HEAD" || code in listOf(300, 301, 302) && request.method !in listOf("GET", "HEAD")) {
            builder.method("GET", null).removeHeader("Content-Length").removeHeader("Content-Type").removeHeader("Transfer-Encoding")
        }
        if (target.scheme != request.url.scheme || target.host != request.url.host || target.port != request.url.port) {
            for (name in listOf("Authorization", "Proxy-Authorization", "Cookie", "Origin", "Referer", "X-Anilife-Playback", "X-Anilife-Player", "X-Anilife-Delivery")) builder.removeHeader(name)
        }
        return builder.build()
    }
}

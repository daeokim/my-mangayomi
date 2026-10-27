package daeo.extensions.common

import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
import okio.ForwardingSource
import okio.buffer
import java.io.IOException
import java.net.ConnectException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException

/** One verified-TLS host-client attempt after Chromium transport failure; never replays writes or access failures. */
internal class CronetFallback(
    private val upstream: OkHttpClient,
    private val watchdog: ScheduledExecutorService,
) : Interceptor {
    fun withoutRedirects() = CronetFallback(upstream.newBuilder().followRedirects(false).followSslRedirects(false).build(), watchdog)

    override fun intercept(chain: Interceptor.Chain): Response {
        val started = System.nanoTime()
        try {
            return chain.proceed(chain.request())
        } catch (primary: IOException) {
            if (chain.call().isCanceled() || !eligible(chain.request(), primary)) throw primary
            val original = chain.call().timeout()
            val now = System.nanoTime()
            var budget = TimeUnit.SECONDS.toNanos(30)
            if (original.timeoutNanos() > 0) budget = minOf(budget, original.timeoutNanos() - (now - started))
            if (original.hasDeadline()) budget = minOf(budget, original.deadlineNanoTime() - now)
            if (budget <= 0) throw primary
            val originalRequest = chain.request()
            val fallbackClient = upstream.newBuilder().addNetworkInterceptor { redirected ->
                val target = redirected.request()
                val sameOrigin = target.url.scheme == originalRequest.url.scheme && target.url.host == originalRequest.url.host &&
                    target.url.port == originalRequest.url.port
                val safe = if (sameOrigin) target else target.newBuilder().apply {
                    for (name in PRIVATE_HEADERS) removeHeader(name)
                }.build()
                redirected.proceed(safe)
            }.build()
            val fallback = fallbackClient.newCall(originalRequest)
            fallback.timeout().timeout(budget, TimeUnit.NANOSECONDS)
            val cancel = watchdog.scheduleAtFixedRate({ if (chain.call().isCanceled()) fallback.cancel() }, 0, 100, TimeUnit.MILLISECONDS)
            try {
                val response = fallback.execute()
                val body = response.body
                if (body == null) { cancel.cancel(false); return response }
                val guarded = object : ResponseBody() {
                    private val source = object : ForwardingSource(body.source()) {
                        override fun close() { try { super.close() } finally { cancel.cancel(false) } }
                    }.buffer()
                    override fun contentType() = body.contentType()
                    override fun contentLength() = body.contentLength()
                    override fun source() = source
                }
                return response.newBuilder().body(guarded).build()
            } catch (secondary: IOException) {
                cancel.cancel(false)
                secondary.addSuppressed(primary)
                throw secondary
            } catch (secondary: Exception) {
                cancel.cancel(false)
                throw IOException("Host network request failed", secondary).apply { addSuppressed(primary) }
            }
        }
    }

    companion object {
        private val PRIVATE_HEADERS = setOf("Authorization", "Proxy-Authorization", "Cookie", "Origin", "Referer",
            "X-Anilife-Playback", "X-Anilife-Player", "X-Anilife-Delivery")
        internal fun eligible(request: Request, error: IOException): Boolean {
            if (request.method !in setOf("GET", "HEAD") || request.body != null) return false
            val causes = generateSequence<Throwable>(error) { it.cause }.take(12).toList()
            if (causes.any { it is SSLException || it is java.security.cert.CertificateException ||
                    it is java.util.concurrent.CancellationException || it is SecurityException }) return false
            val text = causes.joinToString(" ") { it.message.orEmpty() }
            if (text.contains("Retryable=false", true) || text.contains("cloudflare", true) ||
                text.contains("challenge", true) || HTTP_ERROR.containsMatchIn(text)) return false
            val codes = CODE.findAll(text).map { it.groupValues[1].uppercase() }.toList()
            if (codes.any { it.startsWith("ERR_CERT_") || it.startsWith("ERR_SSL_") }) return false
            return causes.any { it is SocketException || it is SocketTimeoutException || it is ConnectException || it is UnknownHostException } ||
                codes.any { it in TRANSIENT }
        }
        private val CODE = Regex("\\bnet::(ERR_[A-Z0-9_]+)\\b", RegexOption.IGNORE_CASE)
        private val HTTP_ERROR = Regex("\\bHTTP(?: error)?\\s*[:=]?\\s*[45]\\d\\d\\b", RegexOption.IGNORE_CASE)
        private val TRANSIENT = setOf("ERR_CONNECTION_RESET", "ERR_CONNECTION_CLOSED", "ERR_CONNECTION_REFUSED",
            "ERR_CONNECTION_ABORTED", "ERR_TIMED_OUT", "ERR_CONNECTION_TIMED_OUT", "ERR_NAME_NOT_RESOLVED",
            "ERR_ADDRESS_UNREACHABLE", "ERR_INTERNET_DISCONNECTED", "ERR_NETWORK_CHANGED")
    }
}

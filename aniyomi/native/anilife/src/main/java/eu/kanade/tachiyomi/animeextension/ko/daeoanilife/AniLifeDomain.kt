package eu.kanade.tachiyomi.animeextension.ko.daeoanilife

import android.content.Context
import daeo.extensions.common.CronetClient
import daeo.extensions.common.SiteDomain
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

internal interface LifeDomainStore {
    fun read(): String?
    fun write(origin: String)
}

/** Same preference namespace as this source; no app or other extension settings are changed. */
internal class LifeDomainPreferences : LifeDomainStore {
    private val preferences by lazy {
        val context = Class.forName("android.app.ActivityThread").getMethod("currentApplication").invoke(null) as? Context
            ?: throw IOException("애니라이프 앱 설정을 열 수 없습니다.")
        context.getSharedPreferences("source_850164079243120202", Context.MODE_PRIVATE)
    }
    override fun read(): String? = preferences.getString("auto_domain", null)
    override fun write(origin: String) { preferences.edit().putString("auto_domain", origin).apply() }
}

/** Forward registry hints are validated on the phone; stale hints cannot undo a saved discovery. */
internal class AniLifeDomain(private val store: LifeDomainStore) {
    @Volatile var current = runCatching { normalize(store.read()) }.getOrNull() ?: SEED
        private set
    private var checkedAt = 0L
    private var failedAt = 0L
    private var failedOrigin: String? = null

    @Synchronized fun remember(value: String): String {
        val origin = normalize(value) ?: return current
        if (number(origin) < number(current)) return current
        if (origin != current) { current = origin; store.write(origin) }
        return current
    }
    fun registryCandidate(json: String): String? = runCatching {
        val d = JSONObject(json).getJSONObject("domains").getJSONObject("anilife")
        if (d.optString("status") !in listOf("healthy", "protected")) return null
        normalize(d.getString("baseUrl"))?.takeIf { number(it) > number(current) }
    }.getOrNull()

    private fun registry(client: OkHttpClient): String? = runCatching {
        val request = Request.Builder().url(SiteDomain.REGISTRY).header("Cache-Control", "no-cache").build()
        client.newBuilder().callTimeout(5, TimeUnit.SECONDS).build().newCall(request).execute().use { response ->
            if (response.isSuccessful) bounded(response)?.let(::registryCandidate) else null
        }
    }.getOrNull()

    @Synchronized fun resolve(client: OkHttpClient): String {
        val now = System.nanoTime()
        if (checkedAt == 0L || now - checkedAt >= TimeUnit.MINUTES.toNanos(10)) {
            checkedAt = now
            registry(client)?.let { probe(client, it) }
        }
        return current
    }

    @Synchronized fun recover(failed: String, preferred: () -> String?, probe: (String) -> Boolean): String? {
        val origin = normalize(failed) ?: return null
        if (number(current) > number(origin)) return current // Another request/registry already advanced it.
        val now = System.nanoTime()
        if (failedOrigin == origin && now - failedAt < TimeUnit.MINUTES.toNanos(1)) return null
        val remote = preferred()?.let(::normalize)?.takeIf { number(it) > number(current) }
        val candidates = (listOfNotNull(remote) + nextOrigins(current)).distinct().take(5)
        for (candidate in candidates) if (probe(candidate)) {
            failedOrigin = null
            return remember(candidate)
        }
        failedOrigin = origin; failedAt = now
        return null
    }
    fun recover(client: OkHttpClient, failed: String): String? = recover(failed, { registry(client) }) { probe(client, it) }

    private fun probe(upstream: OkHttpClient, origin: String): Boolean = runCatching {
        // Cronet is an application interceptor, so its redirects must also be disabled.
        val client = CronetClient.withoutRedirects(upstream).newBuilder()
            .connectTimeout(2, TimeUnit.SECONDS).readTimeout(3, TimeUnit.SECONDS).callTimeout(4, TimeUnit.SECONDS).build()
        var url = (origin + CATALOG).toHttpUrl()
        repeat(3) { hop ->
            val base = "https://${url.host}"
            val request = Request.Builder().url(url).header("User-Agent", SiteDomain.USER_AGENT)
                .header("Accept", "application/json, text/plain, */*").header("Accept-Language", "ko-KR,ko;q=0.9,en;q=0.8")
                .header("Referer", "$base/tags").header("Origin", base).build()
            client.newCall(request).execute().use { response ->
                if (response.code in listOf(301, 302, 303, 307, 308)) {
                    val target = response.header("Location")?.let(url::resolve) ?: return false
                    val targetOrigin = AniLifeDomain.origin(target) ?: return false
                    if (hop == 2 || number(targetOrigin) < number(origin)) return false
                    url = target; return@use
                }
                if (!response.isSuccessful) return false
                val body = bounded(response) ?: return false
                if (!validCatalog(body)) return false
                // Save the verified redirect destination, not the obsolete requested hostname.
                remember(base)
                return true
            }
        }
        false
    }.getOrDefault(false)

    companion object {
        const val SEED = "https://anilife01.tv"
        const val CATALOG = "/api/anime?page=1&limit=1&sort=latest&v=catalog-media-2"
        private val host = Regex("(?:www\\.)?anilife(\\d+)\\.tv")
        fun normalize(value: String?): String? {
            val url = value?.toHttpUrlOrNull() ?: return null
            val n = host.matchEntire(url.host)?.groupValues?.get(1)?.toIntOrNull() ?: return null
            if (!url.isHttps || url.port != 443 || url.username.isNotEmpty() || url.password.isNotEmpty() ||
                url.encodedPath != "/" || url.query != null || url.fragment != null || n !in 1..999999) return null
            return "https://${url.host}"
        }
        fun origin(url: HttpUrl): String? = normalize(url.newBuilder().encodedPath("/").query(null).fragment(null).build().toString())
        fun number(origin: String): Int = host.matchEntire(origin.toHttpUrl().host)!!.groupValues[1].toInt()
        fun nextOrigins(origin: String): List<String> {
            val base = normalize(origin) ?: return emptyList()
            val n = number(base)
            return (1..minOf(5, 999999 - n)).map { "https://anilife${(n + it).toString().padStart(2, '0')}.tv" }
        }
        fun bounded(response: Response): String? {
            val source = response.body?.source() ?: return null
            return if (source.request(256L * 1024 + 1)) null else source.readUtf8()
        }
        fun validCatalog(body: String): Boolean = runCatching {
            val data = JSONObject(body)
            val items = data.getJSONArray("items")
            items.length() > 0 && data.getJSONObject("pagination").getInt("pages") >= 1 && (0 until items.length()).all { i ->
                val item = items.getJSONObject(i)
                Regex("[A-Za-z0-9_-]+").matches(item.getString("id")) && item.getString("title").isNotBlank() &&
                    Regex("^(?:https://|/).+").matches(item.getString("image"))
            }
        }.getOrDefault(false)
    }
}

internal class LifeDomainMoved : IOException("애니라이프 주소가 변경되어 새 주소에서 재시도합니다.")

/** GETs are replayed once. Playback restarts the whole session, never forwarding old credentials. */
internal class LifeDomainInterceptor(private val domain: AniLifeDomain, private val transport: OkHttpClient) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val origin = AniLifeDomain.origin(request.url) ?: return chain.proceed(request)
        if (request.method != "GET" && !(request.method == "POST" && request.url.encodedPath == "/api/playback/session")) return chain.proceed(request)
        var response: Response? = null
        var failure: IOException? = null
        try {
            response = chain.proceed(request)
            if (response.code != 403) return response
        } catch (error: IOException) {
            if (chain.call().isCanceled()) throw error
            failure = error
        }
        val next = domain.recover(transport, origin)
        if (next == null) return response ?: throw failure!!
        response?.close()
        if (chain.call().isCanceled()) throw IOException("Canceled")
        if (request.url.encodedPath.startsWith("/api/playback/")) throw LifeDomainMoved()
        val url = request.url.newBuilder().host(next.toHttpUrl().host).build()
        val retry = request.newBuilder().url(url).removeHeader("Authorization").removeHeader("Cookie")
        for (name in listOf("Origin", "Referer")) request.header(name)?.let { old ->
            if (old == origin || old.startsWith("$origin/")) retry.header(name, next + old.removePrefix(origin)) else retry.removeHeader(name)
        }
        return chain.proceed(retry.build())
    }
}

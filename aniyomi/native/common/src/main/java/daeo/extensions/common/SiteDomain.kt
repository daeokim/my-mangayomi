package daeo.extensions.common

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** A failed or older registry response never discards the last usable origin. */
class SiteDomain(private val key: String, seed: String, private val host: Regex) {
    @Volatile var current = seed
        private set
    private var checkedAt = 0L

    fun candidate(json: String): String? = runCatching {
        val value = JSONObject(json).getJSONObject("domains").getJSONObject(key).getString("baseUrl")
        val url = value.toHttpUrlOrNull() ?: return null
        val match = host.matchEntire(url.host) ?: return null
        if (!url.isHttps || url.port != 443 || url.username.isNotEmpty() || url.password.isNotEmpty() ||
            url.encodedPath != "/" || url.query != null || url.fragment != null) return null
        val old = host.matchEntire(current.toHttpUrlOrNull()!!.host)!!.groupValues[1].toIntOrNull() ?: 0
        val next = match.groupValues[1].toIntOrNull() ?: 0
        if (next < old || next > 999999) return null
        "https://${url.host}"
    }.getOrNull()

    @Synchronized fun resolve(client: OkHttpClient): String {
        val now = System.nanoTime()
        if (checkedAt != 0L && now - checkedAt < TimeUnit.MINUTES.toNanos(10)) return current
        try {
            client.newBuilder().callTimeout(8, TimeUnit.SECONDS).build().newCall(
                Request.Builder().url(REGISTRY).header("Cache-Control", "no-cache").build()
            ).execute().use { response ->
                if (response.isSuccessful) {
                    val body = response.body ?: return@use
                    val source = body.source()
                    if (!source.request(256L * 1024 + 1)) candidate(source.readUtf8())?.let { current = it }
                }
            }
        } catch (_: Exception) { /* Preserve the last validated origin. */ }
        checkedAt = now
        return current
    }

    companion object {
        const val REGISTRY = "https://daeokim.github.io/my-mangayomi/domains.json"
        const val USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    }
}

package eu.kanade.tachiyomi.animeextension.ko.daeoanilife

import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import java.util.concurrent.TimeUnit

internal data class LifeDelivery(val streams: List<Pair<String, String>>, val subtitle: String?, val referer: String)

/** Session credentials are sent only to validated first-party playback endpoints. */
internal class AniLifeDelivery {
    private data class Session(val token: String, val cookie: String, val expires: Long, val origin: String)
    @Volatile private var saved: Session? = null
    @Synchronized private fun session(client: OkHttpClient, origin: String, referer: String, headers: Headers): Session {
        saved?.takeIf { it.origin == origin && it.expires > System.currentTimeMillis() + 30_000 }?.let { return it }
        val req = Request.Builder().url("$origin/api/playback/session").headers(headers).header("Origin", origin)
            .header("Referer", referer).header("X-Anilife-Player", "1").post(FormBody.Builder().build()).build()
        return client.newCall(req).execute().use { response ->
            require(response.isSuccessful) { "애니라이프 재생 세션 HTTP ${response.code}" }
            val j = JSONObject(response.body!!.string()); val token = j.optString("token")
            require(token.isNotBlank()) { j.optString("error", "재생 세션을 받지 못했습니다.") }
            Session(token, response.headers.values("Set-Cookie").joinToString("; ") { it.substringBefore(';') }, j.optLong("expiresAt") * 1000, origin).also { saved = it }
        }
    }
    fun resolve(upstream: OkHttpClient, origin: String, path: String, headers: Headers): LifeDelivery {
        require(Regex("/api/playback/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+").matches(path)) { "애니라이프 회차 주소 오류" }
        val parts = path.split('/'); val referer = "$origin/content/${parts[3]}/${parts[4]}"
        // Never follow a redirect with first-party tokens or session cookies attached.
        val client = upstream.newBuilder().followRedirects(false).followSslRedirects(false).callTimeout(30, TimeUnit.SECONDS).build()
        var failure = "영상 주소를 받지 못했습니다."
        repeat(2) { attempt ->
            val s = session(client, origin, referer, headers)
            val url = (origin + path).toHttpUrl().newBuilder().addQueryParameter("request", "${System.currentTimeMillis()}-$attempt").build()
            val request = Request.Builder().url(url).headers(headers).header("Referer", referer).header("Origin", origin)
                .header("X-Anilife-Playback", s.token).header("X-Anilife-Delivery", "source-v1")
                .apply { if (s.cookie.isNotBlank()) header("Cookie", s.cookie) }.build()
            client.newCall(request).execute().use { response ->
                val j = runCatching { JSONObject(response.body!!.string()) }.getOrNull()
                if (response.isSuccessful && j != null) {
                    fun address(field: String) = j.optString(field).takeIf { it.isNotBlank() && it != "null" }?.let { origin.toHttpUrl().resolve(it) }?.takeIf { it.isHttps }?.toString()
                    val streams = listOf("videoUrl" to "자동 (HLS)", "backupUrl" to "보조 영상").mapNotNull { (field, label) -> address(field)?.let { it to label } }.distinctBy { it.first }
                    if (streams.isNotEmpty()) return LifeDelivery(streams, address("subtitleUrl"), referer)
                }
                failure = j?.optString("error")?.takeIf(String::isNotBlank) ?: "애니라이프 재생 HTTP ${response.code}"
            }
            saved = null
        }
        error(failure)
    }
}

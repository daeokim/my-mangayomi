package eu.kanade.tachiyomi.animeextension.ko.daeotvwiki

import okhttp3.Headers
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import org.json.JSONTokener
import java.io.IOException

/** Read the session's player configuration; get_episode.hls_url can carry an older CDN token. */
internal object TvWikiPlayer {
    data class Media(val url: String, val headers: Headers)
    private const val MAX_PAGE_BYTES = 2L * 1024 * 1024
    private val scripts = Regex("<script\\b[^>]*>([\\s\\S]*?)</script\\s*>", RegexOption.IGNORE_CASE)
    private val assignment = Regex("^\\s*window\\.TVP_CONFIG\\s*=")

    fun open(client: OkHttpClient, base: String, session: JSONObject, episodeId: String, headers: Headers, referer: String): Media {
        val site = secureUrl(base)
        val player = site.resolve(session.getString("player_url")) ?: throw IOException("플레이어 주소 오류")
        secureUrl(player.toString())
        val signedPlayer = player.newBuilder().setQueryParameter("t", session.getString("t"))
            .setQueryParameter("sig", session.getString("sig")).build()
        val request = Request.Builder().url(signedPlayer).headers(headers)
            .removeHeader("Cookie").removeHeader("Authorization")
            .header("Referer", referer).header("Origin", origin(site)).header("Accept", "text/html").build()
        return client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("티비위키 플레이어 HTTP ${response.code}")
            val source = response.body?.source() ?: throw IOException("플레이어 응답이 없습니다")
            if (source.request(MAX_PAGE_BYTES + 1)) throw IOException("플레이어 응답이 너무 큽니다")
            parse(source.readUtf8(), response.request.url.toString(), episodeId, headers)
        }
    }

    fun parse(html: String, playerUrl: String, episodeId: String, headers: Headers): Media {
        val player = secureUrl(playerUrl)
        val configs = scripts.findAll(html).mapNotNull { script ->
            val data = script.groupValues[1]
            assignment.find(data)?.let { match ->
                try { JSONTokener(data.substring(match.range.last + 1)).nextValue() as? JSONObject }
                catch (_: Exception) { throw IOException("플레이어 설정 형식 오류") }
            }
        }.toList()
        if (configs.size != 1) throw IOException("플레이어 영상 설정을 찾지 못했습니다")
        val config = configs.single()
        if (episodeId.isBlank() || config.optString("idx") != episodeId) throw IOException("플레이어 회차 정보가 일치하지 않습니다")
        val media = secureUrl(config.optString("src"))
        // The observed player declares Referrer-Policy: origin. Never expose its signed t/sig URL to the CDN.
        val mediaHeaders = headers.newBuilder().removeAll("Cookie").removeAll("Authorization")
            .set("Referer", origin(player) + "/").set("Origin", origin(player)).set("Accept", "*/*").build()
        return Media(media.toString(), mediaHeaders)
    }

    private fun secureUrl(value: String): HttpUrl = value.toHttpUrlOrNull()?.takeIf {
        it.isHttps && it.username.isEmpty() && it.password.isEmpty()
    } ?: throw IOException("안전한 플레이어·영상 주소가 필요합니다")

    private fun origin(url: HttpUrl) = url.newBuilder().encodedPath("/").query(null).fragment(null).build().toString().removeSuffix("/")
}

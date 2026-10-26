package eu.kanade.tachiyomi.animeextension.ko.daeotvwiki

import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

internal class TvWikiPlaybackException(message: String) : IOException(message)

/** Try each site-provided session once, including validation of its first media resources. */
internal object TvWikiPlayback {
    fun open(client: OkHttpClient, base: String, referer: String, headers: Headers, episode: JSONObject): String {
        require(episode.optString("hls_url").isNotBlank()) { "영상 주소가 없습니다." }
        val sessionClient = client.newBuilder().callTimeout(10, TimeUnit.SECONDS).build()
        val tried = mutableSetOf<String>()
        var failure = "재생 세션을 만들지 못했습니다."
        for (field in listOf("session_data1", "session_data2")) {
            val value = episode.opt(field)
            if (value == null || value == JSONObject.NULL) continue
            val payload = if (value is String) value else value.toString()
            if (payload.isBlank() || !tried.add(payload)) continue
            try {
                val result = sessionClient.newCall(Request.Builder().url("$base/api/create_session.php").headers(headers)
                    .header("Referer", referer).header("Origin", base).header("Accept", "application/json")
                    .post(payload.toRequestBody("application/json; charset=utf-8".toMediaType())).build()).execute().use { r ->
                    DeviceLog.e("tvwiki create_session $field -> HTTP ${r.code}")
                    if (!r.isSuccessful) throw TvWikiPlaybackException("재생 세션 요청 실패 (HTTP ${r.code})")
                    JSONObject(r.body!!.string())
                }
                if (!result.optBoolean("success") || listOf("player_url", "t", "sig").any { result.optString(it).isBlank() }) {
                    throw TvWikiPlaybackException("재생 세션 응답 형식 오류")
                }
                val player = base.toHttpUrl().resolve(result.getString("player_url"))!!.newBuilder()
                    .addQueryParameter("t", result.getString("t")).addQueryParameter("sig", result.getString("sig")).build()
                require(player.isHttps) { "안전하지 않은 플레이어 주소" }
                val playlist = player.resolve(episode.getString("hls_url")) ?: error("영상 주소 오류")
                val videoHeaders = headers.newBuilder().set("Referer", player.toString())
                    .set("Origin", "${player.scheme}://${player.host}").set("Accept", "*/*").build()
                DeviceLog.e("tvwiki player=${player.host} playlist=${playlist.host}${playlist.encodedPath}")
                return TvWikiProxy.open(client, playlist.toString(), videoHeaders, validateMedia = true)
            } catch (error: Exception) {
                failure = if (error is TvWikiPlaybackException) error.message!! else "연결 또는 응답 처리 오류 (${error.javaClass.simpleName})"
                DeviceLog.e("tvwiki playback $field failed: $failure")
            }
        }
        throw TvWikiPlaybackException("티비위키 재생 준비 실패: $failure")
    }
}

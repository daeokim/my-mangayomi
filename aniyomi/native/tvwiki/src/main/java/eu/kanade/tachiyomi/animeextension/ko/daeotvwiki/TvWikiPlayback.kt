package eu.kanade.tachiyomi.animeextension.ko.daeotvwiki

import org.json.JSONObject
import java.io.IOException

/** Keeps the host's site-check cause intact so Dtoon can offer the actual video host in WebView. */
class TvWikiPlaybackException(message: String, cause: Throwable?) : IOException(message, cause)

internal object TvWikiPlayback {
    fun <T> resolve(
        episode: JSONObject,
        createSession: (field: String, payload: String) -> JSONObject?,
        open: (JSONObject) -> T,
        onFailure: (field: String, stage: String, error: Exception) -> Unit = { _, _, _ -> },
    ): T {
        val tried = mutableSetOf<String>()
        var failure: Exception? = null
        var failedStage = "세션 생성"
        for (field in listOf("session_data1", "session_data2")) {
            val value = episode.opt(field)
            if (value == null || value == JSONObject.NULL) continue
            val payload = value.toString()
            if (payload.isBlank() || !tried.add(payload)) continue
            var stage = "세션 생성"
            try {
                val session = createSession(field, payload) ?: throw IOException("사이트에서 재생 세션을 제공하지 않았습니다")
                require(session.optBoolean("success") && listOf("player_url", "t", "sig").all { session.optString(it).isNotBlank() }) {
                    "재생 세션 응답 형식 오류"
                }
                stage = "영상 서버"
                return open(session)
            } catch (error: Exception) {
                onFailure(field, stage, error)
                failure = error
                failedStage = stage
                if (needsSiteCheck(error)) {
                    throw TvWikiPlaybackException("티비위키 $stage 사이트 확인이 필요합니다. 웹에서 확인한 뒤 회차를 다시 열어 주세요.", error)
                }
            }
        }
        throw TvWikiPlaybackException("티비위키 재생 준비 실패: $failedStage · 연결 또는 응답 처리 오류", failure)
    }

    private fun needsSiteCheck(error: Throwable) = generateSequence(error) { it.cause }.take(12).any {
        it.javaClass.simpleName == "WebViewChallengeException" ||
            it.message.orEmpty().let { text -> text.contains("cloudflare", true) || text.contains("challenge", true) }
    }
}

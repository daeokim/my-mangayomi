package eu.kanade.tachiyomi.animeextension.ko.daeotvwiki

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class TvWikiPlaybackTest {
    private fun session(player: String = "/player") = JSONObject().put("success", true).put("player_url", player).put("t", "token").put("sig", "signature")
    private fun episode() = JSONObject().put("session_data1", "first").put("session_data2", "second")

    @Test fun alternateSessionIsTriedWhenTheFirstPlaylistFails() {
        val created = mutableListOf<String>()
        var opens = 0
        val result = TvWikiPlayback.resolve(episode(), { _, payload -> created += payload; session() }, {
            if (++opens == 1) throw IOException("invalid playlist")
            "playable"
        })
        assertEquals("playable", result); assertEquals(listOf("first", "second"), created); assertEquals(2, opens)
    }
    @Test fun failedSessionCreationCanUseTheSecondDistinctPayload() {
        val result = TvWikiPlayback.resolve(episode(), { field, _ -> if (field == "session_data1") null else session() }, { "playable" })
        assertEquals("playable", result)
    }
    @Test fun protectionIsNotRepeatedAndTheOriginalCauseIsPreserved() {
        val original = IOException("Cloudflare를 통과하지 못했습니다")
        var attempts = 0
        try {
            TvWikiPlayback.resolve(episode(), { _, _ -> attempts++; session() }, { throw original })
            fail("Expected site check")
        } catch (error: TvWikiPlaybackException) {
            assertSame(original, error.cause); assertTrue(error.message!!.contains("영상 서버")); assertEquals(1, attempts)
            assertFalse(error.message!!.contains("token"))
        }
    }
    @Test fun duplicatePayloadsAreNotRepeatedAndMalformedSessionIsRejected() {
        var calls = 0
        try {
            TvWikiPlayback.resolve(episode().put("session_data2", "first"), { _, _ -> calls++; JSONObject().put("success", true) }, { fail("Invalid session must not reach video host") })
            fail("Expected failure")
        } catch (error: TvWikiPlaybackException) { assertEquals(1, calls); assertNotNull(error.cause) }
    }
}

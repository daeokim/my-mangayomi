package eu.kanade.tachiyomi.animeextension.ko.daeotvwiki

import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.net.Proxy

class TvWikiPlayerTest {
    private val page = "https://player.example:8443/player/short?t=private&sig=private"
    private val fresh = "https://cdn.example/v/e/content/c.html?token=fresh&expires=200"
    private fun config(src: String = fresh, idx: String = "406784640") =
        "<script>window.TVP_CONFIG=" + JSONObject().put("idx", idx).put("src", src)
            .put("iosOld", JSONObject().put("auth", "nested-token")).put("title", "a } quoted \\\" title") + ";</script>"
    private fun session() = JSONObject().put("success", true).put("player_url", "https://player.example:8443/player/short")
        .put("t", "private").put("sig", "private")
    private fun response(request: Request, text: String, code: Int = 200) = Response.Builder()
        .request(request).protocol(Protocol.HTTP_1_1).message("test").code(code).body(text.toResponseBody()).build()
    private fun rejected(block: () -> Unit) {
        try { block(); fail("Expected rejection") } catch (_: IOException) { }
    }

    @Test fun playerConfigurationSuppliesFreshTokenAndOriginOnlyMediaHeaders() {
        val calls = mutableListOf<Request>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            calls += chain.request(); response(chain.request(), config())
        }.build()
        val input = Headers.Builder().add("User-Agent", "test-agent").add("Cookie", "source-secret")
            .add("Authorization", "source-secret").build()
        val media = TvWikiPlayer.open(client, "https://tvwiki.example", session(), "406784640", input, "https://tvwiki.example/animation/10760/406784640")
        assertEquals(1, calls.size); assertEquals(page, calls.single().url.toString())
        assertEquals("https://tvwiki.example", calls.single().header("Origin"))
        assertNull(calls.single().header("Cookie")); assertNull(calls.single().header("Authorization"))
        assertEquals(fresh, media.url)
        assertEquals("https://player.example:8443/", media.headers["Referer"])
        assertEquals("https://player.example:8443", media.headers["Origin"])
        assertEquals("test-agent", media.headers["User-Agent"])
        assertNull(media.headers["Cookie"]); assertNull(media.headers["Authorization"])
        assertFalse(media.headers.toString().contains("private"))
    }

    @Test fun completeSessionFlowReadsPlayerThenPrimesFreshPlaylistOnlyOnce() {
        val requests = mutableListOf<Request>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            requests += chain.request()
            when (chain.request().url.host) {
                "player.example" -> response(chain.request(), config())
                "cdn.example" -> {
                    assertEquals(fresh, chain.request().url.toString())
                    assertEquals("https://player.example:8443/", chain.request().header("Referer"))
                    response(chain.request(), "#EXTM3U\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST\n")
                }
                else -> throw AssertionError("Unexpected host")
            }
        }.build()
        val episode = JSONObject().put("session_data1", "first").put("hls_url", "https://cdn.example/c.html?token=stale")
        val local = TvWikiPlayback.resolve(episode, { _, _ -> session() }, { result ->
            val media = TvWikiPlayer.open(client, "https://tvwiki.example", result, "406784640", Headers.Builder().build(), "https://tvwiki.example/")
            TvWikiProxy.open(client, media.url, media.headers)
        })
        val loopback = OkHttpClient.Builder().proxy(Proxy.NO_PROXY).build()
        repeat(2) { loopback.newCall(Request.Builder().url(local).build()).execute().use { r -> assertEquals(200, r.code); assertTrue(r.body!!.string().startsWith("#EXTM3U")) } }
        assertEquals(listOf("player.example", "cdn.example"), requests.map { it.url.host })
    }

    @Test fun invalidOrMismatchedConfigurationNeverUsesStaleApiUrl() {
        for (html in listOf("<html>missing</html>", "<script>window.TVP_CONFIG=not_json;</script>", config(idx = "other"), config() + config(),
            config(src = "http://cdn.example/video"), config(src = "https://user:password@cdn.example/video"), config(src = "javascript:alert(1)"))) {
            rejected { TvWikiPlayer.parse(html, page, "406784640", Headers.Builder().build()) }
        }
    }

    @Test fun playerHttpFailureOrProtectionStopsBeforeCdnAndPreservesCause() {
        var calls = 0
        val original = IOException("Cloudflare site check needed")
        val client = OkHttpClient.Builder().addInterceptor { calls++; throw original }.build()
        try {
            TvWikiPlayback.resolve(JSONObject().put("session_data1", "first").put("session_data2", "second"), { _, _ -> session() }, {
                TvWikiPlayer.open(client, "https://tvwiki.example", it, "406784640", Headers.Builder().build(), "https://tvwiki.example/")
            })
            fail("Expected site check")
        } catch (e: TvWikiPlaybackException) { assertSame(original, e.cause); assertEquals(1, calls) }
        val denied = OkHttpClient.Builder().addInterceptor { response(it.request(), "forbidden", 403) }.build()
        rejected { TvWikiPlayer.open(denied, "https://tvwiki.example", session(), "406784640", Headers.Builder().build(), "https://tvwiki.example/") }
    }

    @Test fun oversizedPlayerResponseIsRejected() {
        val client = OkHttpClient.Builder().addInterceptor { response(it.request(), " ".repeat(2 * 1024 * 1024 + 1)) }.build()
        rejected { TvWikiPlayer.open(client, "https://tvwiki.example", session(), "406784640", Headers.Builder().build(), "https://tvwiki.example/") }
    }
}

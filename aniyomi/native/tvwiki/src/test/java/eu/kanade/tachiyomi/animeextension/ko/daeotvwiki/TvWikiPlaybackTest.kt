package eu.kanade.tachiyomi.animeextension.ko.daeotvwiki

import okhttp3.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import okio.Buffer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.net.Proxy

class TvWikiPlaybackTest {
    private val local = OkHttpClient.Builder().proxy(Proxy.NO_PROXY).build()
    private fun upstream(test: (MockWebServer, OkHttpClient) -> Unit) {
        val cert = HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
        val serverTls = HandshakeCertificates.Builder().heldCertificate(cert).build()
        val clientTls = HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate).build()
        MockWebServer().use { server ->
            server.useHttps(serverTls.sslSocketFactory(), false); server.start()
            val client = OkHttpClient.Builder().proxy(Proxy.NO_PROXY)
                .sslSocketFactory(clientTls.sslSocketFactory(), clientTls.trustManager).build()
            test(server, client)
        }
    }
    private fun session(server: MockWebServer, name: String) = MockResponse().setBody(
        JSONObject().put("success", true).put("player_url", server.url("/player/$name").toString())
            .put("t", name).put("sig", "test-signature").toString())
    private fun episode(server: MockWebServer) = JSONObject()
        .put("hls_url", server.url("/v/e/c.html?token=once").toString())
        .put("session_data1", JSONObject().put("session", 1))
        .put("session_data2", JSONObject().put("session", 2))
    private fun media(key: Boolean = false) = MockResponse().setBody("#EXTM3U\n" +
        (if (key) "#EXT-X-KEY:METHOD=AES-128,URI=\"/v/key7?token=key-once\"\n" else "") +
        "#EXTINF:2,\nsegment.gif\n#EXT-X-ENDLIST\n")
    private fun read(url: String) = local.newCall(Request.Builder().url(url).build()).execute().use {
        assertEquals(200, it.code); it.body!!.string()
    }
    @Test fun firstSegment403TriesTheSecondSiteSessionBeforeReturningToThePlayer() = upstream { server, client ->
        server.enqueue(session(server, "first")); server.enqueue(media())
        server.enqueue(MockResponse().setResponseCode(403).setBody("Forbidden"))
        server.enqueue(session(server, "second")); server.enqueue(media())
        server.enqueue(MockResponse().setBody("video-data"))
        val url = TvWikiPlayback.open(client, server.url("/").toString().trimEnd('/'), server.url("/episode").toString(),
            Headers.Builder().add("User-Agent", "test-agent").build(), episode(server))
        val segment = read(url).lineSequence().first { it.startsWith("http") }
        assertEquals("video-data", read(segment))
        assertEquals(6, server.requestCount) // Validation is cached; the player never consumes the token twice.
        val requests = (1..6).map { server.takeRequest() }
        assertEquals("POST", requests[0].method); assertEquals("POST", requests[3].method)
        assertTrue(requests[5].getHeader("Referer")!!.contains("/player/second?"))
        assertEquals("test-agent", requests[5].getHeader("User-Agent"))
    }
    @Test fun invalidKeyTriesSecondSessionAndCachesItsKeyAndFirstSegmentIncludingRange() = upstream { server, client ->
        server.enqueue(session(server, "first")); server.enqueue(media(true))
        server.enqueue(MockResponse().setBody("{\"unsupported\":true}"))
        server.enqueue(session(server, "second")); server.enqueue(media(true))
        val key = ByteArray(16) { it.toByte() }
        server.enqueue(MockResponse().setBody(Buffer().write(key)))
        server.enqueue(MockResponse().setBody("0123456789"))
        val url = TvWikiPlayback.open(client, server.url("/").toString().trimEnd('/'), server.url("/episode").toString(),
            Headers.Builder().build(), episode(server))
        val playlist = read(url)
        val keyUrl = Regex("URI=\"([^\"]+)\"").find(playlist)!!.groupValues[1]
        repeat(2) { local.newCall(Request.Builder().url(keyUrl).build()).execute().use { r ->
            assertEquals(200, r.code); assertArrayEquals(key, r.body!!.bytes())
        } }
        val segment = playlist.lineSequence().first { it.startsWith("http") }
        for ((range, expected) in listOf("bytes=2-4" to "234", "bytes=8-" to "89", "bytes=-3" to "789")) {
            local.newCall(Request.Builder().url(segment).header("Range", range).build()).execute().use { r ->
                assertEquals(206, r.code); assertEquals(expected, r.body!!.string())
            }
        }
        local.newCall(Request.Builder().url(segment).header("Range", "bytes=99-100").build()).execute().use { r ->
            assertEquals(416, r.code); assertEquals("bytes */10", r.header("Content-Range"))
        }
        local.newCall(Request.Builder().url(segment).head().build()).execute().use { r ->
            assertEquals(200, r.code); assertEquals("10", r.header("Content-Length")); assertEquals(0, r.body!!.bytes().size)
        }
        assertEquals("0123456789", read(segment))
        assertEquals(7, server.requestCount)
    }
    @Test fun bothSessions403FailOncePerSessionWithAnExplicitError() = upstream { server, client ->
        repeat(2) {
            server.enqueue(session(server, "player$it")); server.enqueue(media())
            server.enqueue(MockResponse().setResponseCode(403).setBody("Forbidden"))
        }
        try {
            TvWikiPlayback.open(client, server.url("/").toString().trimEnd('/'), server.url("/episode").toString(),
                Headers.Builder().build(), episode(server))
            fail("The player must not receive an unusable stream")
        } catch (e: TvWikiPlaybackException) {
            assertTrue(e.message!!.contains("영상 조각 요청 실패 (HTTP 403)"))
            assertFalse(e.message!!.contains("token=")); assertFalse(e.message!!.contains("sig="))
        }
        assertEquals(6, server.requestCount)
    }
    @Test fun duplicateSessionPayloadIsNotRetried() = upstream { server, client ->
        server.enqueue(session(server, "first")); server.enqueue(media())
        server.enqueue(MockResponse().setResponseCode(403).setBody("Forbidden"))
        val data = episode(server).apply { put("session_data2", get("session_data1")) }
        try {
            TvWikiPlayback.open(client, server.url("/").toString().trimEnd('/'), server.url("/episode").toString(),
                Headers.Builder().build(), data)
            fail("Expected 403")
        } catch (_: TvWikiPlaybackException) { }
        assertEquals(3, server.requestCount)
    }
}

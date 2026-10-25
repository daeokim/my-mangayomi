package eu.kanade.tachiyomi.animeextension.ko.daeotvwiki

import okhttp3.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test
import java.net.Proxy

class TvWikiProxyTest {
    @Test fun loopbackProxyHandlesMasterKeySegmentsAndRange() {
        val cert = HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
        val serverTls = HandshakeCertificates.Builder().heldCertificate(cert).build()
        val clientTls = HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate).build()
        MockWebServer().use { upstream ->
            upstream.useHttps(serverTls.sslSocketFactory(), false); upstream.start()
            val remote = OkHttpClient.Builder().proxy(Proxy.NO_PROXY).sslSocketFactory(clientTls.sslSocketFactory(), clientTls.trustManager).build()
            val local = OkHttpClient.Builder().proxy(Proxy.NO_PROXY).build()
            val master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nmedia.m3u8\n"
            upstream.enqueue(MockResponse().setBody(master)) // open() validation, then served from the cache
            val url = TvWikiProxy.open(remote, upstream.url("/master.m3u8").toString(), Headers.Builder().add("Referer", "https://player.example/").build())
            assertTrue(url.startsWith("http://127.0.0.1:"))
            val playlist = local.newCall(Request.Builder().url(url).build()).execute().use { it.body!!.string() }
            val child = playlist.lineSequence().first { it.startsWith("http") }
            upstream.enqueue(MockResponse().setBody("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.php\"\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST\n"))
            val media = local.newCall(Request.Builder().url(child).build()).execute().use { it.body!!.string() }
            val keyUrl = Regex("URI=\"([^\"]+)\"").find(media)!!.groupValues[1]
            upstream.enqueue(MockResponse().setBody(Buffer().write(ByteArray(16) { 7 })))
            local.newCall(Request.Builder().url(keyUrl).build()).execute().use { assertEquals(200, it.code); assertArrayEquals(ByteArray(16) { 7 }, it.body!!.bytes()) }
            val segment = media.lineSequence().first { it.startsWith("http") }
            upstream.enqueue(MockResponse().setResponseCode(206).setHeader("Content-Range", "bytes 2-4/10").setBody("abc"))
            local.newCall(Request.Builder().url(segment).header("Range", "bytes=2-4").build()).execute().use {
                assertEquals(206, it.code); assertEquals("bytes 2-4/10", it.header("Content-Range")); assertEquals("abc", it.body!!.string())
            }
            val requests = (1..4).map { upstream.takeRequest() }
            assertTrue(requests.all { it.getHeader("Referer") == "https://player.example/" })
            assertEquals("bytes=2-4", requests.last().getHeader("Range"))
        }
    }
    @Test fun singleUsePlaylistTokenIsFetchedOnlyOnce() {
        val cert = HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
        val serverTls = HandshakeCertificates.Builder().heldCertificate(cert).build()
        val clientTls = HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate).build()
        MockWebServer().use { upstream ->
            upstream.useHttps(serverTls.sslSocketFactory(), false); upstream.start()
            val remote = OkHttpClient.Builder().proxy(Proxy.NO_PROXY).sslSocketFactory(clientTls.sslSocketFactory(), clientTls.trustManager).build()
            val local = OkHttpClient.Builder().proxy(Proxy.NO_PROXY).build()
            upstream.enqueue(MockResponse().setBody("#EXTM3U\n#EXTINF:6,\nseg.ts\n#EXT-X-ENDLIST\n"))
            upstream.enqueue(MockResponse().setResponseCode(403).setBody("Attention Required"))
            val url = TvWikiProxy.open(remote, upstream.url("/v/e/abc/c.html?token=once&expires=1").toString(), Headers.Builder().build())
            repeat(2) {
                local.newCall(Request.Builder().url(url).build()).execute().use {
                    assertEquals(200, it.code)
                    val body = it.body!!.string()
                    assertTrue(body.startsWith("#EXTM3U")); assertTrue(body.contains("127.0.0.1"))
                }
            }
            assertEquals(1, upstream.requestCount)
        }
    }
}

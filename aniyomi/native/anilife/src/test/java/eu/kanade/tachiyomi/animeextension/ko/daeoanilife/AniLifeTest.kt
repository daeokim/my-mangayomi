package eu.kanade.tachiyomi.animeextension.ko.daeoanilife

import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.Assume.assumeNotNull
import java.io.File
import java.util.concurrent.TimeUnit

class AniLifeTest {
    @Test fun episodesExcludeUnplayableAndForeignPaths() {
        val body = """{"item":{"episodes":[{"playable":true,"number":2,"title":"재회","playbackUrl":"/api/playback/42/2"},{"playable":false,"number":1,"playbackUrl":"/api/playback/42/1"},{"playable":true,"playbackUrl":"https://evil.test/42"},{"playable":true,"playbackUrl":"/api/playback/../42"}]}}"""
        val items = AniLifeParsing.episodes(body)
        assertEquals(1, items.size); assertEquals("2화 · 재회", items.single().title)
    }
    @Test fun listFollowsPaginationAndResolvesImages() {
        val body = """{"items":[{"id":"42","title":"테스트","image":"/42.jpg","description":null,"genres":["판타지"]}],"pagination":{"page":1,"pages":3}}"""
        val (items, next) = AniLifeParsing.list(body, "https://anilife01.tv")
        assertTrue(next); assertEquals("https://anilife01.tv/42.jpg", items.single().image); assertEquals("", items.single().description)
    }
    @Test fun searchNormalizesWidthAndSpaceAndBoundsVariants() {
        assertEquals("abc테스트", AniLifeParsing.normalized("ＡＢＣ 테스트"))
        assertEquals("나의 히어로", AniLifeParsing.searchTerms(" 나의   히어로 ").first())
        assertTrue(AniLifeParsing.searchTerms("긴검색어를생각합니다").size <= 10)
    }
    @Test fun firstPartySessionIsRetriedOnceAndSecretsAreNotVideoHeaders() {
        val certificate = HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
        val serverTls = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val clientTls = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        MockWebServer().use { server ->
            server.useHttps(serverTls.sslSocketFactory(), false); server.start()
            val origin = server.url("/").toString().trimEnd('/')
            server.enqueue(MockResponse().setBody("""{"token":"first","expiresAt":9999999999}""").addHeader("Set-Cookie", "sid=first; HttpOnly; Path=/"))
            server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"expired"}"""))
            server.enqueue(MockResponse().setBody("""{"token":"second","expiresAt":9999999999}""").addHeader("Set-Cookie", "sid=second; HttpOnly; Path=/"))
            server.enqueue(MockResponse().setBody("""{"videoUrl":"https://cdn.test/main.m3u8","backupUrl":"https://cdn.test/backup.mp4","subtitleUrl":"/sub/ko.vtt"}"""))
            val client = OkHttpClient.Builder().sslSocketFactory(clientTls.sslSocketFactory(), clientTls.trustManager).build()
            val delivery = AniLifeDelivery().resolve(client, origin, "/api/playback/42/2", Headers.Builder().add("User-Agent", "test").build())
            assertEquals(2, delivery.streams.size); assertEquals("$origin/sub/ko.vtt", delivery.subtitle)
            val requests = (0..3).map { server.takeRequest(2, TimeUnit.SECONDS)!! }
            assertEquals("POST", requests[0].method); assertEquals("/api/playback/session", requests[0].path)
            assertEquals("1", requests[0].getHeader("X-Anilife-Player"))
            assertEquals("first", requests[1].getHeader("X-Anilife-Playback")); assertEquals("sid=first", requests[1].getHeader("Cookie"))
            assertEquals("second", requests[3].getHeader("X-Anilife-Playback")); assertEquals("source-v1", requests[3].getHeader("X-Anilife-Delivery"))
            assertEquals("$origin/content/42/2", requests[3].getHeader("Referer"))
        }
    }
    @Test fun malformedEpisodeIsRejectedBeforeAnyRequest() {
        for (path in listOf("https://evil.test/play", "/api/playback/../42", "/api/playback/42/2?token=x")) assertThrows(IllegalArgumentException::class.java) {
            AniLifeDelivery().resolve(OkHttpClient(), "https://anilife01.tv", path, Headers.Builder().build())
        }
    }
    @Test fun liveCapturedListAndPlayableEpisodeShapes() {
        val dir = System.getenv("DAEO_OCT16_FIXTURES"); assumeNotNull(dir)
        val (items, _) = AniLifeParsing.list(File(dir, "anilife-list.txt").readText(), "https://anilife01.tv")
        assertEquals(24, items.size)
        assertEquals("/api/playback/2882/2", AniLifeParsing.episodes(File(dir, "anilife-detail.txt").readText()).single().path)
        assertEquals("2882", AniLifeParsing.detailId("/content/2882/1"))
    }
}

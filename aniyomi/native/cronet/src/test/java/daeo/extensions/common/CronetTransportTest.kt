package daeo.extensions.common

import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import java.net.HttpURLConnection
import java.util.concurrent.TimeUnit
import java.util.concurrent.Executors

class CronetTransportTest {
    private fun client(jar: CookieJar = CookieJar.NO_COOKIES, open: (java.net.URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection }): OkHttpClient =
        OkHttpClient.Builder().cookieJar(jar).addInterceptor(CronetClient.Transport(jar, true, true, open)).build()

    @Test fun postPreservesBodyHeadersAndResponse() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("reply").addHeader("Set-Cookie", "session=new; Path=/"))
            var saved = emptyList<Cookie>()
            val jar = object : CookieJar {
                override fun loadForRequest(url: HttpUrl) = listOf(Cookie.Builder().name("old").value("value").hostOnlyDomain(url.host).build())
                override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) { saved = cookies }
            }
            val request = Request.Builder().url(server.url("/session")).header("User-Agent", "source-agent").header("X-Anilife-Player", "1")
                .post("name=한글".toRequestBody("application/x-www-form-urlencoded".toMediaType())).build()
            client(jar).newCall(request).execute().use { assertEquals("reply", it.body!!.string()) }
            val recorded = server.takeRequest()
            assertEquals("POST", recorded.method); assertEquals("name=한글", recorded.body.readUtf8())
            assertEquals("source-agent", recorded.getHeader("User-Agent")); assertEquals("1", recorded.getHeader("X-Anilife-Player"))
            assertEquals("old=value", recorded.getHeader("Cookie")); assertEquals("new", saved.single().value)
        }
    }
    @Test fun explicitCookieWinsOverHostJar() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("ok"))
            val jar = object : CookieJar {
                override fun loadForRequest(url: HttpUrl) = listOf(Cookie.Builder().name("host").value("wrong").hostOnlyDomain(url.host).build())
                override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) = Unit
            }
            client(jar).newCall(Request.Builder().url(server.url("/")).header("Cookie", "playback=correct").build()).execute().close()
            assertEquals("playback=correct", server.takeRequest().getHeader("Cookie"))
        }
    }
    @Test fun redirectStripsCredentialsAndChangesPostOnlyWhenRequired() {
        val request = Request.Builder().url("https://first.example/api").header("Cookie", "secret=1").header("Authorization", "Bearer secret")
            .header("X-Anilife-Playback", "secret").header("X-Anilife-Player", "1").header("X-Anilife-Delivery", "source-v1")
            .header("Origin", "https://first.example").post("body".toRequestBody()).build()
        val cross = CronetClient.redirect(request, 302, "https://other.example/cdn", true, true)!!
        assertEquals("GET", cross.method); assertNull(cross.body)
        for (name in listOf("Cookie", "Authorization", "X-Anilife-Playback", "X-Anilife-Player", "X-Anilife-Delivery", "Origin")) assertNull(name, cross.header(name))
        val same = CronetClient.redirect(request, 307, "/new", true, true)!!
        assertEquals("POST", same.method); assertSame(request.body, same.body); assertEquals("secret", same.header("X-Anilife-Playback"))
        assertNull(CronetClient.redirect(request, 302, "http://first.example/plain", true, false))
        assertNull(CronetClient.redirect(request, 302, "/new", false, false))
    }
    @Test fun noRedirectCloneReturnsOriginalStatus() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", "/must-not-follow"))
            CronetClient.withoutRedirects(client()).newCall(Request.Builder().url(server.url("/session")).build()).execute().use { assertEquals(302, it.code) }
            assertEquals(1, server.requestCount)
        }
    }
    @Test fun cronetRedirectNeverAttemptsUnavailableBody() {
        val c = client(open = { url -> object : HttpURLConnection(url) {
            override fun connect() = Unit
            override fun disconnect() = Unit
            override fun usingProxy() = false
            override fun getResponseCode() = 302
            override fun getResponseMessage() = "Found"
            override fun getHeaderFields() = mapOf("Location" to listOf("/elsewhere"), "Content-Length" to listOf("123"))
            override fun getInputStream(): java.io.InputStream = throw java.io.IOException("Cronet redirect body unavailable")
        } })
        CronetClient.withoutRedirects(c).newCall(Request.Builder().url("https://first.example/session").build()).execute().use {
            assertEquals(302, it.code); assertEquals(0, it.body!!.bytes().size); assertNull(it.header("Content-Length"))
        }
    }
    @Test fun followsRedirectsAndExposesErrorBody() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", "/target"))
            server.enqueue(MockResponse().setResponseCode(403).setBody("denied"))
            client().newCall(Request.Builder().url(server.url("/start")).build()).execute().use { response ->
                assertEquals(403, response.code); assertEquals("/target", response.request.url.encodedPath); assertEquals("denied", response.body!!.string())
            }
        }
    }
    @Test fun responseIsStreamedAndCloseDisconnects() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("first-second").throttleBody(5, 2, TimeUnit.SECONDS))
            val started = System.nanoTime()
            client().newCall(Request.Builder().url(server.url("/segment")).build()).execute().use { response ->
                assertEquals("first", response.body!!.source().readUtf8(5))
                assertTrue("must not buffer the complete segment", System.nanoTime() - started < TimeUnit.SECONDS.toNanos(2))
            }
        }
    }
    @Test fun cancellationStopsPendingHeaders() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeadersDelay(4, TimeUnit.SECONDS).setBody("late"))
            val call = client().newCall(Request.Builder().url(server.url("/")).build())
            val executor = Executors.newSingleThreadExecutor()
            try {
                val result = executor.submit<Boolean> { try { call.execute().close(); false } catch (_: java.io.IOException) { true } }
                assertNotNull(server.takeRequest(1, TimeUnit.SECONDS)); call.cancel()
                assertTrue(result.get(2, TimeUnit.SECONDS))
            } finally { executor.shutdownNow() }
        }
    }
    @Test fun readAndCallTimeoutsAreBounded() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeadersDelay(4, TimeUnit.SECONDS).setBody("late"))
            val c = client().newBuilder().readTimeout(300, TimeUnit.MILLISECONDS).callTimeout(500, TimeUnit.MILLISECONDS).build()
            val started = System.nanoTime()
            try { c.newCall(Request.Builder().url(server.url("/")).build()).execute().close(); fail("Expected timeout") } catch (_: java.io.IOException) {}
            assertTrue(System.nanoTime() - started < TimeUnit.SECONDS.toNanos(2))
        }
    }
}

package daeo.extensions.common

import okhttp3.*
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLHandshakeException

class CronetFallbackTest {
    @Test fun aResetUsesTheHostTransportOnceAndPreservesHeadersAndBody() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("catalogue"))
            val scheduler = Executors.newSingleThreadScheduledExecutor()
            try {
                var primary = 0
                val fallback = OkHttpClient()
                val client = OkHttpClient.Builder().addInterceptor(CronetFallback(fallback, scheduler))
                    .addInterceptor { primary++; throw IOException("CronetUrlRequest: net::ERR_CONNECTION_RESET, Retryable=true") }.build()
                client.newCall(Request.Builder().url(server.url("/catalogue")).header("Referer", "https://site.example/").build()).execute().use {
                    assertEquals("catalogue", it.body!!.string())
                }
                assertEquals(1, primary); assertEquals(1, server.requestCount)
                assertEquals("https://site.example/", server.takeRequest().getHeader("Referer"))
            } finally { scheduler.shutdownNow() }
        }
    }
    @Test fun postProtectionCertificateAndCancelledFailuresAreNotReplayed() {
        val get = Request.Builder().url("https://site.example/").build()
        assertFalse(CronetFallback.eligible(get.newBuilder().post("session".toRequestBody()).build(), IOException("net::ERR_CONNECTION_RESET")))
        listOf(SSLHandshakeException("reset"), IOException("HTTP 403"), IOException("Cloudflare challenge net::ERR_CONNECTION_RESET"),
            IOException("net::ERR_CERT_DATE_INVALID"), IOException("net::ERR_CONNECTION_RESET, Retryable=false"),
            IOException("cancel", java.util.concurrent.CancellationException())).forEach { assertFalse(it.toString(), CronetFallback.eligible(get, it)) }
    }
    @Test fun anHttpResponseDoesNotTriggerTheAlternativeTransport() {
        val scheduler = Executors.newSingleThreadScheduledExecutor()
        try {
            var calls = 0
            val upstream = OkHttpClient.Builder().addInterceptor { calls++; throw AssertionError("No fallback for HTTP status") }.build()
            val client = OkHttpClient.Builder().addInterceptor(CronetFallback(upstream, scheduler)).addInterceptor { chain ->
                Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(403).message("Forbidden")
                    .body(ResponseBody.create(null, "challenge")).build()
            }.build()
            client.newCall(Request.Builder().url("https://site.example/").build()).execute().use { assertEquals(403, it.code) }
            assertEquals(0, calls)
        } finally { scheduler.shutdownNow() }
    }
    @Test fun cancellationStillReachesAWaitingFallbackRequest() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeadersDelay(5, TimeUnit.SECONDS).setBody("late"))
            val scheduler = Executors.newSingleThreadScheduledExecutor()
            val executor = Executors.newSingleThreadExecutor()
            try {
                val client = OkHttpClient.Builder().addInterceptor(CronetFallback(OkHttpClient(), scheduler))
                    .addInterceptor { throw IOException("net::ERR_CONNECTION_RESET") }.build()
                val call = client.newCall(Request.Builder().url(server.url("/")).build())
                val result = executor.submit<Boolean> { try { call.execute().close(); false } catch (_: IOException) { true } }
                assertNotNull(server.takeRequest(2, TimeUnit.SECONDS)); call.cancel()
                assertTrue(result.get(2, TimeUnit.SECONDS))
            } finally { scheduler.shutdownNow(); executor.shutdownNow() }
        }
    }
    @Test fun anUnfollowedRedirectRemainsUnfollowedOnTheAlternativeTransport() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", "/must-not-follow"))
            val scheduler = Executors.newSingleThreadScheduledExecutor()
            try {
                val client = OkHttpClient.Builder().addInterceptor(CronetFallback(OkHttpClient(), scheduler).withoutRedirects())
                    .addInterceptor { throw IOException("net::ERR_CONNECTION_RESET") }.build()
                client.newCall(Request.Builder().url(server.url("/start")).build()).execute().use { assertEquals(302, it.code) }
                assertEquals(1, server.requestCount)
            } finally { scheduler.shutdownNow() }
        }
    }
    @Test fun fallbackDoesNotRestartTheOriginalCallDeadline() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeadersDelay(2, TimeUnit.SECONDS).setBody("late"))
            val scheduler = Executors.newSingleThreadScheduledExecutor()
            try {
                val client = OkHttpClient.Builder().callTimeout(500, TimeUnit.MILLISECONDS)
                    .addInterceptor(CronetFallback(OkHttpClient(), scheduler)).addInterceptor {
                        Thread.sleep(100); throw IOException("net::ERR_CONNECTION_RESET")
                    }.build()
                val start = System.nanoTime()
                try { client.newCall(Request.Builder().url(server.url("/slow")).build()).execute().close(); fail("Expected deadline") }
                catch (_: IOException) { assertTrue(System.nanoTime() - start < TimeUnit.MILLISECONDS.toNanos(1500)) }
            } finally { scheduler.shutdownNow() }
        }
    }
    @Test fun fallbackRedirectDoesNotForwardSourceCredentialsToAnotherOrigin() {
        MockWebServer().use { first -> MockWebServer().use { second ->
            first.enqueue(MockResponse().setResponseCode(302).addHeader("Location", second.url("/video")))
            second.enqueue(MockResponse().setBody("ok"))
            val scheduler = Executors.newSingleThreadScheduledExecutor()
            try {
                val client = OkHttpClient.Builder().addInterceptor(CronetFallback(OkHttpClient(), scheduler))
                    .addInterceptor { throw IOException("net::ERR_CONNECTION_RESET") }.build()
                val request = Request.Builder().url(first.url("/source")).header("Cookie", "session=secret")
                    .header("Authorization", "Bearer secret").header("Origin", "https://source.example")
                    .header("Referer", "https://source.example/?token=secret").header("X-Anilife-Playback", "secret").build()
                client.newCall(request).execute().use { assertEquals("ok", it.body!!.string()) }
                assertEquals("session=secret", first.takeRequest().getHeader("Cookie"))
                val redirected = second.takeRequest()
                for (name in listOf("Cookie", "Authorization", "Origin", "Referer", "X-Anilife-Playback")) assertNull(name, redirected.getHeader(name))
            } finally { scheduler.shutdownNow() }
        } }
    }
}

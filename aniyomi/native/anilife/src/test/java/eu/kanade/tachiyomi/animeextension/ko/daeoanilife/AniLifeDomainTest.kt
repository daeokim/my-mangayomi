package eu.kanade.tachiyomi.animeextension.ko.daeoanilife

import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import java.net.UnknownHostException

class AniLifeDomainTest {
    private class Store(var value: String? = null) : LifeDomainStore {
        var writes = 0
        override fun read() = value
        override fun write(origin: String) { value = origin; writes++ }
    }
    private fun registry(url: String, status: String = "healthy") = """{"domains":{"anilife":{"baseUrl":"$url","status":"$status","lastConfirmedAt":"2026-10-23T00:00:00Z"}}}"""
    private val catalog = """{"items":[{"id":"42","title":"작품","image":"/42.jpg"}],"pagination":{"pages":1}}"""
    private fun reply(request: Request, status: Int, body: String) = Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
        .code(status).message("test").body(body.toResponseBody("application/json".toMediaType())).build()

    @Test fun incrementsAcrossPaddingBoundariesAndNeverExceedsFiveOrMaximum() {
        assertEquals((2..6).map { "https://anilife0$it.tv" }, AniLifeDomain.nextOrigins("https://anilife01.tv"))
        assertEquals("https://anilife10.tv", AniLifeDomain.nextOrigins("https://www.anilife09.tv").first())
        assertEquals("https://anilife100.tv", AniLifeDomain.nextOrigins("https://anilife99.tv").first())
        assertEquals(listOf("https://anilife999999.tv"), AniLifeDomain.nextOrigins("https://anilife999998.tv"))
        assertTrue(AniLifeDomain.nextOrigins("https://anilife999999.tv").isEmpty())
        for (bad in listOf("http://anilife02.tv", "https://anilife02.tv.evil.test", "https://u:p@anilife02.tv", "https://anilife02.tv:444", "https://anilife02.tv/a", "https://anilife02.tv?q=x", "https://anilife00.tv", "https://anilife1000000.tv")) {
            assertNull(bad, AniLifeDomain.normalize(bad)); assertTrue(AniLifeDomain.nextOrigins(bad).isEmpty())
        }
    }
    @Test fun storedPhoneDiscoverySurvivesRestartAndRejectsStaleOrForeignRegistry() {
        val store = Store("https://anilife04.tv"); val domain = AniLifeDomain(store)
        for ((url, status) in listOf("https://anilife01.tv" to "healthy", "https://evil.test" to "healthy"))
            assertNull(domain.registryCandidate(registry(url, status)))
        assertEquals("https://anilife06.tv", domain.registryCandidate(registry("https://anilife06.tv")))
        domain.remember(domain.registryCandidate(registry("https://anilife06.tv"))!!)
        domain.remember("https://anilife05.tv")
        assertEquals("https://anilife06.tv", AniLifeDomain(store).current)
        assertEquals(1, store.writes)
        assertEquals(AniLifeDomain.SEED, AniLifeDomain(Store("https://evil.test")).current)
    }
    @Test fun newerRegistryIsTriedFirstAndIncludedInTheFiveCandidateLimit() {
        val store = Store(); val domain = AniLifeDomain(store); val seen = mutableListOf<String>()
        val result = domain.recover(domain.current, { "https://anilife10.tv" }) { seen += it; it.endsWith("03.tv") }
        assertEquals(listOf("https://anilife10.tv", "https://anilife02.tv", "https://anilife03.tv"), seen)
        assertEquals("https://anilife03.tv", result)
        assertEquals(result, AniLifeDomain(store).current)
    }
    @Test fun allFailuresKeepSavedOriginAndThrottleRepeatedFailedScans() {
        val store = Store("https://anilife04.tv"); val domain = AniLifeDomain(store); val seen = mutableListOf<String>()
        repeat(2) { assertNull(domain.recover(domain.current, { "https://anilife10.tv" }) { seen += it; false }) }
        assertEquals(5, seen.size); assertEquals("https://anilife04.tv", store.value); assertEquals(0, store.writes)
    }
    @Test fun catalogValidationRejectsParkingChallengeEmptyAndMalformedPayloads() {
        assertTrue(AniLifeDomain.validCatalog(catalog))
        for (body in listOf("<html>Just a moment</html>", "{}", """{"items":[],"pagination":{"pages":1}}""", catalog.replace("/42.jpg", "javascript:x"), catalog.replace("42\",\"title", "../42\",\"title")))
            assertFalse(body, AniLifeDomain.validCatalog(body))
    }
    @Test fun registryHintMustValidateOnPhoneEvenWhenActionsMarksItProtected() {
        val store = Store("https://anilife04.tv"); val domain = AniLifeDomain(store)
        val transport = OkHttpClient.Builder().addInterceptor {
            reply(it.request(), 200, if (it.request().url.host == "daeokim.github.io") registry("https://anilife09.tv", "protected") else catalog)
        }.build()
        assertEquals("https://anilife09.tv", domain.resolve(transport))
        assertEquals("https://anilife09.tv", AniLifeDomain(store).current)
    }
    @Test fun failedNewerRegistryHintDoesNotReplacePhoneStore() {
        val store = Store("https://anilife04.tv"); val domain = AniLifeDomain(store)
        val transport = OkHttpClient.Builder().addInterceptor {
            reply(it.request(), 200, if (it.request().url.host == "daeokim.github.io") registry("https://anilife09.tv") else "<html>parking</html>")
        }.build()
        assertEquals("https://anilife04.tv", domain.resolve(transport))
        assertEquals("https://anilife04.tv", store.value); assertEquals(0, store.writes)
    }
    private fun recoveringClient(domain: AniLifeDomain, seen: MutableList<Request>, missing: Boolean = false): OkHttpClient {
        val transport = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request(); seen += request
            when {
                request.url.host == "daeokim.github.io" -> reply(request, 503, "{}")
                request.url.host == "anilife01.tv" && missing -> throw UnknownHostException("test DNS failure")
                request.url.host == "anilife01.tv" -> reply(request, 403, "blocked")
                request.url.host == "anilife02.tv" -> reply(request, 200, "<html>parking</html>")
                request.url.host == "anilife03.tv" -> reply(request, 200, catalog)
                else -> error("unexpected candidate")
            }
        }.build()
        return transport.newBuilder().apply { interceptors().add(0, LifeDomainInterceptor(domain, transport)) }.build()
    }
    @Test fun forbiddenAndDnsFailureProbeCatalogThenReplayOriginalGetWithoutOldCredentials() {
        for (dns in listOf(false, true)) {
            val store = Store(); val domain = AniLifeDomain(store); val seen = mutableListOf<Request>()
            val client = recoveringClient(domain, seen, dns)
            client.newCall(Request.Builder().url("https://anilife01.tv/api/anime/42?detail=1")
                .header("Referer", "https://anilife01.tv/content/42/1").header("Origin", "https://anilife01.tv")
                .header("Authorization", "private-test").header("Cookie", "private-test").build()).execute().use { assertEquals(200, it.code) }
            val retry = seen.last()
            assertEquals("anilife03.tv", retry.url.host); assertEquals("/api/anime/42", retry.url.encodedPath); assertEquals("detail=1", retry.url.encodedQuery)
            assertNull(retry.header("Authorization")); assertNull(retry.header("Cookie"))
            assertEquals("https://anilife03.tv", retry.header("Origin"))
            assertEquals("https://anilife03.tv/content/42/1", retry.header("Referer"))
            assertEquals("https://anilife03.tv", AniLifeDomain(store).current)
        }
    }
    @Test fun playbackMigrationRequiresFreshSessionAndDoesNotReplayOldToken() {
        val domain = AniLifeDomain(Store()); val seen = mutableListOf<Request>()
        val client = recoveringClient(domain, seen)
        assertThrows(LifeDomainMoved::class.java) {
            client.newCall(Request.Builder().url("https://anilife01.tv/api/playback/42/1").header("X-Anilife-Playback", "private-test").build()).execute()
        }
        assertTrue(seen.filter { it.url.host != "anilife01.tv" }.all { it.header("X-Anilife-Playback") == null })
        assertEquals("https://anilife03.tv", domain.current)
    }
    @Test fun onlyFiveCandidatesAreProbedAndForeignRedirectIsNotFollowed() {
        val store = Store(); val domain = AniLifeDomain(store); val seen = mutableListOf<String>()
        val transport = OkHttpClient.Builder().addInterceptor {
            val request = it.request(); seen += request.url.host
            if (request.url.host == "daeokim.github.io") reply(request, 503, "{}")
            else reply(request, 302, "").newBuilder().header("Location", "https://evil.test/api/anime").build()
        }.build()
        // The raw candidate transport returns forbidden redirects.
        assertNull(domain.recover(transport, domain.current))
        assertEquals((2..6).map { "anilife0$it.tv" }, seen.filter { it != "daeokim.github.io" })
        assertNull(store.value); assertEquals(AniLifeDomain.SEED, domain.current)
    }
    @Test fun validatedForwardRedirectPersistsFinalOrigin() {
        val store = Store(); val domain = AniLifeDomain(store)
        val transport = OkHttpClient.Builder().addInterceptor {
            val request = it.request()
            when (request.url.host) {
                "daeokim.github.io" -> reply(request, 503, "{}")
                "anilife02.tv" -> reply(request, 302, "").newBuilder().header("Location", "https://anilife03.tv" + AniLifeDomain.CATALOG).build()
                "anilife03.tv" -> reply(request, 200, catalog)
                else -> error("unexpected origin")
            }
        }.build()
        assertEquals("https://anilife03.tv", domain.recover(transport, domain.current))
        assertEquals("https://anilife03.tv", AniLifeDomain(store).current)
    }
    @Test fun missingChapter404DoesNotStartDomainScanning() {
        val domain = AniLifeDomain(Store()); var calls = 0
        val transport = OkHttpClient.Builder().addInterceptor { calls++; reply(it.request(), 404, "missing") }.build()
        val client = transport.newBuilder().apply { interceptors().add(0, LifeDomainInterceptor(domain, transport)) }.build()
        client.newCall(Request.Builder().url("https://anilife01.tv/api/anime/42").build()).execute().close()
        assertEquals(1, calls); assertEquals(AniLifeDomain.SEED, domain.current)
    }
}

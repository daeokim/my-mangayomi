package eu.kanade.tachiyomi.animeextension.ko.daeotvwiki

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import java.util.Base64

class TvWikiParsingTest {
    @Test fun seriesPathsRebaseOldHostsAndEpisodeLinks() {
        assertEquals("/drama/123", TvWikiParsing.path("https://tvwiki22.net/drama/123/456?foo=1"))
        assertEquals("/kor_movie/9", TvWikiParsing.path("/kor_movie/9"))
        assertNull(TvWikiParsing.path("/advert/9"))
        assertNull(TvWikiParsing.path("javascript:alert(1)"))
        assertNull(TvWikiParsing.path("/drama/12/not-a-number"))
    }
    @Test fun episodePathsRequireThreeParts() {
        assertEquals("/animation/1/2", TvWikiParsing.path("/animation/1/2", true))
        assertNull(TvWikiParsing.path("/drama/1", true))
    }
    @Test fun cardsIgnoreMenusAndKeepSeriesOnce() {
        val html = """<a href='/drama'>메뉴</a><div id='list_type'>
            <div class='box'><a class='img' href='/drama/1/8'><img data-src='/cover.jpg'></a><a class='title2' href='/drama/1/8'>작품</a></div>
            <div class='box'><a class='title' href='/drama/1/9'>작품</a></div>
            <div class='box'><a href='/ads/3'>광고</a></div></div>"""
        val cards = TvWikiParsing.cards(html, "https://tvwiki54.net/")
        assertEquals(1, cards.size); assertEquals("작품", cards[0].title)
        assertEquals("https://tvwiki54.net/cover.jpg", cards[0].image)
    }
    @Test fun distinctEpisodeVariantsArePreserved() {
        val html = """<ul id='other_list'><li><a class='ep-link' href='/drama/1/9'>1화 자막</a></li>
            <li><a class='title' href='/drama/1/10'>1화 더빙</a></li><li><a href='/drama/1/10'>중복</a></li></ul>"""
        assertEquals(2, TvWikiParsing.episodes(html, "https://tvwiki54.net").size)
    }
    @Test fun paginationDoesNotLoopToPreviousPage() {
        assertFalse(TvWikiParsing.hasNext("<a class='pg_next' href='?page=1'>이전</a>", "https://tvwiki54.net/drama", 2))
        assertTrue(TvWikiParsing.hasNext("<div class='pg_wrap'><a href='?page=3'>3</a></div>", "https://tvwiki54.net/drama", 2))
    }
    @Test fun registryRejectsHostConfusionAndRollback() {
        fun body(url: String) = """{"domains":{"tvwiki":{"baseUrl":"$url"}}}"""
        assertEquals("https://tvwiki56.net", TvWikiParsing.registryCandidate(body("https://tvwiki56.net/"), "https://tvwiki55.net"))
        for (url in listOf("https://tvwiki54.net", "http://tvwiki56.net", "https://tvwiki56.net.evil.org", "https://tvwiki56.net/path")) {
            assertNull(TvWikiParsing.registryCandidate(body(url), "https://tvwiki55.net"))
        }
    }
    private fun envelope(permutation: String = "[1,0]"): ByteArray {
        val bytes = (8..15).map { it.toByte() } + listOf(99.toByte()) + (0..7).map { it.toByte() } + listOf(99.toByte())
        return """{"encrypted_key":"${Base64.getEncoder().encodeToString(bytes.toByteArray())}","rule":{"noise_length":1,"segment_sizes":[8,8],"permutation":$permutation,"key_length":16}}""".toByteArray()
    }
    @Test fun keyReconstructionRestoresOriginalOrder() {
        assertArrayEquals(ByteArray(16) { it.toByte() }, TvWikiParsing.decodeKey(envelope()))
    }
    @Test fun standardKeyPassesThrough() {
        val key = ByteArray(16) { 42 }; assertArrayEquals(key, TvWikiParsing.decodeKey(key))
    }
    @Test(expected = IllegalArgumentException::class) fun duplicatePermutationIsRejected() { TvWikiParsing.decodeKey(envelope("[0,0]")) }
    @Test(expected = IllegalArgumentException::class) fun truncatedKeyIsRejected() {
        val obj = JSONObject(String(envelope())).put("encrypted_key", "AA==")
        TvWikiParsing.decodeKey(obj.toString().toByteArray())
    }
    @Test fun playlistRewritesKeysMapsVariantsAndSegments() {
        val requests = mutableListOf<Pair<String, Boolean>>()
        val text = """#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.php?t=x"
#EXT-X-MAP:URI="init.mp4"
#EXT-X-STREAM-INF:BANDWIDTH=1000
high/index.m3u8
#EXTINF:6,
../segment.ts?sig=abc
"""
        val result = TvWikiParsing.rewritePlaylist(text, "https://cdn.example/v/master.m3u8") { url, key -> requests.add(url to key); "http://127.0.0.1/opaque/${requests.size}" }
        assertEquals(4, requests.size)
        assertEquals("https://cdn.example/v/key.php?t=x" to true, requests[0])
        assertEquals("https://cdn.example/segment.ts?sig=abc" to false, requests[3])
        assertFalse(result.contains("sig=abc")); assertTrue(result.contains("#EXT-X-KEY:METHOD=AES-128,URI=\"http://127.0.0.1/opaque/1\""))
    }
    @Test(expected = IllegalArgumentException::class) fun htmlErrorIsNotAPlaylist() {
        TvWikiParsing.rewritePlaylist("<html>blocked</html>", "https://cdn.example/a") { _, _ -> "x" }
    }
    @Test fun capturedLiveShapesWhenProvided() {
        val directory = System.getenv("DAEO_TVWIKI_FIXTURE_DIR")
        org.junit.Assume.assumeTrue(directory != null)
        val root = java.io.File(directory!!)
        for (name in listOf("drama", "popular")) {
            val cards = TvWikiParsing.cards(java.io.File(root, "tvwiki-$name.html").readText(), "https://tvwiki54.net")
            assertTrue("live $name cards", cards.size > 10)
        }
        val episodes = TvWikiParsing.episodes(java.io.File(root, "tvwiki-detail.html").readText(), "https://tvwiki54.net")
        assertTrue(episodes.size > 10)
        assertTrue(episodes.first().name.contains("화"))
        assertArrayEquals(java.io.File(root, "tvwiki-key-reference.bin").readBytes(), TvWikiParsing.decodeKey(java.io.File(root, "tvwiki-key.json").readBytes()))
    }
    @Test fun version7KeyMatchesIndependentReference() {
        val bytes = javaClass.getResourceAsStream("/key-v7.json")!!.readBytes()
        assertArrayEquals(ByteArray(16) { it.toByte() }, TvWikiParsing.decodeKey(bytes))
    }
    @Test(expected = IllegalArgumentException::class) fun version7DuplicateBitPermutationIsRejected() {
        val data = JSONObject(String(javaClass.getResourceAsStream("/key-v7.json")!!.readBytes()))
        data.getJSONArray("layers").getJSONObject(0).getJSONArray("perm").put(0, 0).put(1, 0)
        TvWikiParsing.decodeKey(data.toString().toByteArray())
    }
}

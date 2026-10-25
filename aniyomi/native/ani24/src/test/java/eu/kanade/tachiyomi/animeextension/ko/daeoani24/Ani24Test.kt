package eu.kanade.tachiyomi.animeextension.ko.daeoani24

import org.junit.Assert.*
import org.junit.Test
import org.junit.Assume.assumeNotNull
import java.io.File

class Ani24Test {
    private val base = "https://www.ohli24.net/"
    @Test fun cardsDeduplicateWorkLinksRestoreTruncatedTitleAndRejectNavigation() {
        val body = """<div class="show-item"><a class="show-item-img-link" href="/42/테스트-제목.html"></a><div class="show-item-title">테스트...</div><img data-src="/cover.jpg"></div>
<div class="show-item"><a href="/42/테스트-제목.html">중복</a></div>
<div class="show-item"><a href="/login">로그인</a></div>"""
        val list = Ani24Parsing.cards(body, base)
        assertEquals(1, list.size); assertEquals("테스트 제목", list.single().title); assertEquals(base + "cover.jpg", list.single().image)
    }
    @Test fun episodesKeepDisplayOrderAndServiceDate() {
        val list = Ani24Parsing.episodes("""<div class="eps-box"><div class="eps-item"><a href="/52/테스트-2화.html">2화<span class="eps-date">2026-10-16</span></a></div><div class="eps-item"><a href="/login">로그인</a></div></div>""", base)
        assertEquals(1, list.size); assertEquals("2화", list.single().name); assertEquals("2026-10-16", list.single().date)
    }
    @Test fun jsonpIsParsedAsDataWithoutExecutingCode() {
        assertEquals("<div></div>", Ani24Parsing.jsonp("cb({\"msg\":\"<div></div>\"});"))
        assertThrows(Exception::class.java) { Ani24Parsing.jsonp("alert('bad')") }
    }
    @Test fun packerSubstitutionDoesNotEvaluateTheDecodedJavascript() {
        val packed = "eval(function(p,a,c,k,e,d){}('0(\"1\");',2,2,'FirePlayer|abc'.split('|'),0,{}))"
        assertEquals("FirePlayer(\"abc\");", Ani24Parsing.unpack(packed))
    }
    @Test fun pathAndSearchBounds() {
        assertEquals("/42/a.html", Ani24Parsing.path("https://ohli25.net/42/a.html"))
        assertEquals("/42/a.html", Ani24Parsing.path("https://ani.ohli24.com/42/a.html"))
        assertEquals("/42/a.html", Ani24Parsing.path("/42/a.html"))
        assertThrows(IllegalArgumentException::class.java) { Ani24Parsing.path("https://ani.ohli24.com.evil.test/42/a.html") }
        assertThrows(IllegalArgumentException::class.java) { Ani24Parsing.path("https://evil.test/42/a.html") }
        assertThrows(IllegalArgumentException::class.java) { Ani24Parsing.path("https://user@www.ohli24.net/42/a.html") }
        assertTrue(Ani24Parsing.searchTerms("나의히어로").size <= 10)
        assertTrue(Ani24Parsing.searchTerms("나의히어로").contains("나의 히어로"))
    }
    @Test fun titlesWithAnUnescapedQuestionMarkAreNotDropped() {
        val cards = Ani24Parsing.cards("""<div class="show-item"><a class="show-item-img-link" href="/42/질문-있어?.html"></a><div class="show-item-title">질문...</div></div>""", base)
        assertEquals(1, cards.size)
        assertEquals("질문 있어?", cards.single().title)
        assertTrue(cards.single().path.endsWith("?.html"))
    }
    @Test fun liveCapturedListAndEpisodeShapes() {
        val dir = System.getenv("DAEO_OCT16_FIXTURES"); assumeNotNull(dir)
        val cards = Ani24Parsing.cards(Ani24Parsing.jsonp(File(dir, "ani24-list.txt").readText()), base)
        assertEquals(25, cards.size)
        val episodes = Ani24Parsing.episodes(File(dir, "ani24-detail.txt").readText(), base)
        assertTrue(episodes.size >= 20); assertEquals("26화", episodes.first().name)
    }
    private fun page(props: String) = """<html><script data-page="app" type="application/json">{"component":"x","props":$props}</script></html>"""
    @Test fun weekdayBoardItemsBecomeSeriesCards() {
        val (cards, next) = Ani24Parsing.list(page("""{"items":[{"id":1,"slug":"푸른 상자 2기","title":"푸른 상자 2기","thumbnail":"series/anime/thumbnails/a.jpg"},{"id":1,"slug":"푸른 상자 2기","title":"중복"}]}"""), "https://ani.ohli24.com")
        assertFalse(next); assertEquals(1, cards.size)
        assertEquals("/c/%ED%91%B8%EB%A5%B8%20%EC%83%81%EC%9E%90%202%EA%B8%B0", cards.single().path)
        assertEquals("https://ani.ohli24.com/storage/series/anime/thumbnails/a.jpg", cards.single().image)
    }
    @Test fun paginatedListsReportTheNextPage() {
        val (cards, next) = Ani24Parsing.list(page("""{"comics":{"data":[{"slug":"원피스","title":"원피스","tags_string":"액션"}],"next_page_url":"https://ani.ohli24.com/%EC%99%84%EA%B2%B0?page=2"}}"""), "https://ani.ohli24.com")
        assertTrue(next); assertEquals("액션", cards.single().genres)
        assertFalse(Ani24Parsing.list(page("""{"comics":{"data":[],"next_page_url":null}}"""), "https://ani.ohli24.com").second)
    }
    @Test fun seriesPathMatchesTheSiteLinks() {
        assertEquals("/c/%EB%9E%80%EB%A7%88%201/2%20(2026)", Ani24Parsing.seriesPath("란마 1/2 (2026)"))
        assertEquals("/c/a%3Fb%23c%25", Ani24Parsing.seriesPath("a?b#c%"))
        assertEquals("/c/%EA%B1%B8%EC%A6%88%20&%20x!", Ani24Parsing.seriesPath("걸즈 & x!"))
    }
    @Test fun seriesPageCarriesEpisodesPlayerAndPages() {
        val s = Ani24Parsing.series(page("""{"comic":{"slug":"원피스","title":"원피스","category":"방영중"},"episodes":{"data":[{"id":7,"title":"1203화","published_at":"2026-10-25T09:23:27.000000Z","body":{"url":"https://michealcdn.com/video/757f9aa438b24844d7c7c216c8c4db9d"}}],"last_page":13}}"""))
        assertEquals("원피스", s.comic.getString("title")); assertEquals(13, s.lastPage)
        assertEquals("https://michealcdn.com/video/757f9aa438b24844d7c7c216c8c4db9d", s.episodes.single().getJSONObject("body").getString("url"))
        assertEquals("1줄\n2줄", Ani24Parsing.plain("1줄<br>2줄"))
    }
    @Test fun pagesWithoutInertiaDataAreRejected() {
        assertThrows(IllegalStateException::class.java) { Ani24Parsing.props("<html>old site</html>") }
    }
}

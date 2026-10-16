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
}

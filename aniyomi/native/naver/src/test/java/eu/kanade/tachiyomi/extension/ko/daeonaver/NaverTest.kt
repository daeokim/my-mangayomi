package eu.kanade.tachiyomi.extension.ko.daeonaver

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.Assume.assumeNotNull
import java.io.File
import java.time.Instant
import java.util.TimeZone

class NaverTest {
    @Test fun pathAcceptsQueryReorderingAndRejectsForeignCredentialsAndMissingEpisode() {
        val p = NaverParsing.path("https://m.comic.naver.com/webtoon/detail?no=12&titleId=42&week=mon", true)
        assertEquals("/webtoon/detail?titleId=42&no=12", p.detail)
        for (path in listOf("https://evil.test/webtoon/list?titleId=42", "https://user@comic.naver.com/webtoon/list?titleId=42", "/webtoon/detail?titleId=42", "/other/detail?titleId=42&no=1")) assertThrows(IllegalArgumentException::class.java) { NaverParsing.path(path, true) }
    }
    @Test fun releaseDayRollsAtKorean23AndSundayBoundary() {
        assertEquals("FRIDAY", NaverParsing.releaseDay(Instant.parse("2026-10-16T13:59:59Z").toEpochMilli()))
        assertEquals("SATURDAY", NaverParsing.releaseDay(Instant.parse("2026-10-16T14:00:00Z").toEpochMilli()))
        assertEquals("MONDAY", NaverParsing.releaseDay(Instant.parse("2026-10-18T14:00:00Z").toEpochMilli()))
    }
    @Test fun chaptersRetainLocksAndDatesAndType() {
        val data = JSONObject("""{"articleList":[{"no":2,"subtitle":"두 번째","thumbnailLock":true,"serviceDateDescription":"26.10.16"},{"no":1,"subtitle":"첫 번째","serviceDateDescription":"12:30"}]}""")
        val chapters = NaverParsing.chapters(data, NaverPath("bestChallenge", "42", null), Instant.parse("2026-10-16T14:00:00Z").toEpochMilli())
        assertEquals("/bestChallenge/detail?titleId=42&no=2", chapters[0].path)
        assertTrue(chapters[0].name.contains("🔒")); assertEquals(Instant.parse("2026-10-15T15:00:00Z").toEpochMilli(), chapters[0].date)
        assertEquals(Instant.parse("2026-10-16T03:30:00Z").toEpochMilli(), chapters[1].date)
    }
    @Test fun timeOnlyDateAt2259UsesPublicationTimeInsteadOfFetchTime() {
        val now = Instant.parse("2026-10-16T13:59:59Z").toEpochMilli() // Seoul 22:59:59
        assertEquals(Instant.parse("2026-10-16T13:59:00Z").toEpochMilli(), NaverParsing.date("22:59", now))
        assertEquals(Instant.parse("2026-10-15T14:00:00Z").toEpochMilli(), NaverParsing.date("23:00", now))
    }
    @Test fun timeOnlyDateAt2300StaysOnTheCalendarDay() {
        val now = Instant.parse("2026-10-16T14:00:30Z").toEpochMilli() // Seoul 23:00:30
        assertEquals(Instant.parse("2026-10-16T14:00:00Z").toEpochMilli(), NaverParsing.date("23:00", now))
        assertEquals(Instant.parse("2026-10-16T13:59:00Z").toEpochMilli(), NaverParsing.date("22:59", now))
    }
    @Test fun timeOnlyDateAt0010RollsFutureClockTimeBackOneDay() {
        val originalZone = TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"))
            val now = Instant.parse("2026-10-16T15:10:00Z").toEpochMilli() // Seoul Oct 17 00:10
            assertEquals(now, NaverParsing.date("00:10", now))
            assertEquals(Instant.parse("2026-10-16T14:00:00Z").toEpochMilli(), NaverParsing.date("23:00", now))
            assertEquals(Instant.parse("2026-10-15T15:11:00Z").toEpochMilli(), NaverParsing.date("00:11", now))
        } finally {
            TimeZone.setDefault(originalZone)
        }
    }
    @Test fun timeOnlyDateHandlesYearBoundaryAndRejectsInvalidClockTime() {
        val now = Instant.parse("2026-12-31T15:10:00Z").toEpochMilli() // Seoul Jan 1 00:10
        assertEquals(Instant.parse("2026-12-31T14:00:00Z").toEpochMilli(), NaverParsing.date("23:00", now))
        for (value in listOf("24:00", "12:60", "99:99", "invalid:time")) {
            assertEquals(value, 0L, NaverParsing.date(value, now))
        }
    }
    @Test fun viewerFiltersPlaceholdersAndKeepsLazyImagesInOrder() {
        val html = """<div class="wt_viewer"><img src="/static/agerate/18.png"><img data-src="//image-comic.pstatic.net/one.jpg" src="bg_transparency.gif"><img src="https://image-comic.pstatic.net/two.jpg"><img src="https://image-comic.pstatic.net/one.jpg"></div><img src="https://ads.test/banner.jpg">"""
        assertEquals(listOf("https://image-comic.pstatic.net/one.jpg", "https://image-comic.pstatic.net/two.jpg"), NaverParsing.pages(html, "https://comic.naver.com/webtoon/detail?titleId=42&no=1"))
    }
    @Test fun titleMapsOfficialArtistAndStatusMetadata() {
        val t = NaverParsing.title(JSONObject("""{"titleId":42,"titleName":"제목","communityArtists":[{"name":"작가"}],"finished":true,"curationTagList":[{"tagName":"판타지"}]}"""), "challenge")
        assertEquals("/challenge/list?titleId=42", t.path); assertEquals("작가", t.author); assertEquals("판타지", t.genres); assertTrue(t.finished)
    }
    @Test fun liveCapturedListsChaptersAndFreeViewerShapes() {
        val dir = System.getenv("DAEO_OCT16_FIXTURES"); assumeNotNull(dir)
        val last = JSONObject(File(dir, "naver-last-chapters.txt").readText())
        val chapters = NaverParsing.chapters(last, NaverPath("webtoon", "747271", null))
        assertEquals(7, chapters.size); assertEquals(1f, chapters.last().no)
        assertTrue(NaverParsing.pages(File(dir, "naver-pages.txt").readText(), "https://comic.naver.com/webtoon/detail?titleId=747271&no=1").size > 10)
    }
}

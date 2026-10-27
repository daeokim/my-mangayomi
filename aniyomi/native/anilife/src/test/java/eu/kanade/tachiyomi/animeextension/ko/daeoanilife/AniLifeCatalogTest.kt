package eu.kanade.tachiyomi.animeextension.ko.daeoanilife

import org.junit.Assert.*
import org.junit.Test

class AniLifeCatalogTest {
    @Test fun popularRequestsRankingWithoutSilentlyRestrictingTheWeekday() {
        val url = AniLifeCatalog.popular("https://site.example", 2)
        assertEquals("/api/anime", url.encodedPath); assertEquals("popular", url.queryParameter("sort"))
        assertEquals("2", url.queryParameter("page")); assertNull(url.queryParameter("day")); assertNull(url.queryParameter("status"))
    }
    @Test fun latestUsesUpdatesScopeRatherThanPopularRanking() {
        val url = AniLifeCatalog.latest("https://site.example", 1)
        assertEquals("latest", url.queryParameter("sort")); assertEquals("updates", url.queryParameter("scope"))
    }
    @Test fun explicitSearchAndWeekdayFiltersStillReachTheSource() {
        val url = AniLifeCatalog.url("https://site.example", 3, "score", query = "한글 제목", genre = "액션", year = "2026", status = "완결", day = "화")
        assertEquals("한글 제목", url.queryParameter("q")); assertEquals("화", url.queryParameter("day"))
        assertEquals("완결", url.queryParameter("status")); assertEquals("score", url.queryParameter("sort"))
    }
}

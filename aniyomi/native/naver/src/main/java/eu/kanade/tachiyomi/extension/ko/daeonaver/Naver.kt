package eu.kanade.tachiyomi.extension.ko.daeonaver

import daeo.extensions.common.SiteDomain
import eu.kanade.tachiyomi.source.model.*
import eu.kanade.tachiyomi.source.online.HttpSource
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import rx.Observable
import java.util.concurrent.Callable
import java.util.concurrent.Executors

class Naver : HttpSource() {
    override val id: Long get() = 850164079243120301L
    override val name = "네이버 웹툰"
    override val lang = "ko"
    override val supportsLatest = true
    override val baseUrl = "https://comic.naver.com"
    override fun headersBuilder() = super.headersBuilder().set("User-Agent", SiteDomain.USER_AGENT).set("Referer", "$baseUrl/")
    private fun get(path: String, pairs: List<Pair<String, String>> = emptyList()): Request {
        val url = baseUrl.toHttpUrl().resolve(path)!!.newBuilder()
        pairs.forEach { (k, v) -> url.addQueryParameter(k, v) }
        return Request.Builder().url(url.build()).headers(headers).build()
    }
    private fun json(response: Response): JSONObject {
        require(response.code != 401 && response.code != 403) { "네이버 로그인·연령 확인이 필요한 회차는 앱에서 열람할 수 없습니다. WebView에서 확인해 주세요." }
        require(response.isSuccessful) { "네이버 HTTP ${response.code}" }
        return JSONObject(response.body!!.string())
    }
    private fun release(order: String) = get("/api/webtoon/titlelist/weekday", listOf("week" to NaverParsing.releaseDay().take(3).lowercase(), "order" to order))
    override fun popularMangaRequest(page: Int) = release("ALL_READER")
    override fun latestUpdatesRequest(page: Int) = release("UPDATE")
    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request {
        val type = filters.filterIsInstance<Kind>().firstOrNull()?.value() ?: "webtoon"
        val order = filters.filterIsInstance<Order>().firstOrNull()?.value() ?: "UPDATE"
        if (query.isNotBlank()) return get("/api/search/${type.ifBlank { "webtoon" }}", listOf("keyword" to query.trim(), "page" to page.toString()))
        if (type in listOf("bestChallenge", "challenge")) return get("/api/$type/list", listOf("order" to if (order == "UPDATE") "UPDATE" else "VIEW", "page" to page.toString()))
        if (filters.filterIsInstance<State>().firstOrNull()?.state == 1) return get("/api/webtoon/titlelist/finished", listOf("order" to order, "page" to page.toString()))
        val genre = filters.filterIsInstance<Genre>().firstOrNull()?.value().orEmpty()
        if (genre.isNotBlank()) return get("/api/webtoon/titlelist/genre", listOf("genre" to genre, "order" to order, "page" to page.toString()))
        return get("/api/webtoon/titlelist/weekday", listOf("order" to order))
    }
    private fun mapped(t: NaverTitle) = SManga.create().apply {
        url = t.path; title = t.title; thumbnail_url = t.image; author = t.author; description = t.description; genre = t.genres
        status = when { t.finished -> SManga.COMPLETED; t.rest -> SManga.ON_HIATUS; else -> SManga.ONGOING }
    }
    private fun parse(response: Response, day: String = ""): MangasPage {
        val j = json(response); val path = response.request.url.encodedPath
        val type = if (path.startsWith("/api/search/")) path.substringAfterLast('/') else path.split('/').getOrNull(2)?.takeIf { it in NaverParsing.types } ?: "webtoon"
        val list = if (j.has("titleListMap")) {
            val map = j.getJSONObject("titleListMap")
            val today = NaverParsing.days.indexOf(NaverParsing.releaseDay())
            (if (day.isNotBlank()) listOf(day) else (0..6).map { NaverParsing.days[(today + it) % 7] }).flatMap { NaverParsing.titles(map.optJSONArray(it), "webtoon") }
        } else NaverParsing.titles(j.optJSONArray("titleList") ?: j.optJSONArray("searchList") ?: j.optJSONArray("list"), type)
        val next = j.optJSONObject("pageInfo")?.optInt("nextPage", 0) ?: 0
        return MangasPage(list.distinctBy { it.path }.map(::mapped), next != 0)
    }
    override fun popularMangaParse(response: Response) = parse(response)
    override fun latestUpdatesParse(response: Response) = parse(response)
    override fun searchMangaParse(response: Response) = parse(response)
    override fun fetchSearchManga(page: Int, query: String, filters: FilterList): Observable<MangasPage> = Observable.fromCallable {
        val kind = filters.filterIsInstance<Kind>().firstOrNull()
        if (query.isBlank() || kind?.value() != "") {
            val day = if (query.isBlank()) filters.filterIsInstance<Day>().firstOrNull()?.value().orEmpty() else ""
            return@fromCallable client.newCall(searchMangaRequest(page, query, filters)).execute().use { parse(it, day) }
        }
        val result = mutableListOf<SManga>(); var next = false
        for (type in NaverParsing.types) {
            val req = get("/api/search/$type", listOf("keyword" to query.trim(), "page" to page.toString()))
            val p = client.newCall(req).execute().use(::parse); result.addAll(p.mangas); next = next || p.hasNextPage
        }
        MangasPage(result.distinctBy { it.url }, next)
    }
    override fun mangaDetailsRequest(manga: SManga): Request {
        val p = NaverParsing.path(manga.url)
        return get("/api/article/list/info", listOf("titleId" to p.titleId, "sourceType" to p.type))
    }
    override fun mangaDetailsParse(response: Response): SManga {
        val type = response.request.url.queryParameter("sourceType") ?: "webtoon"
        return mapped(NaverParsing.title(json(response), type)).also { require(it.title.isNotBlank()) { "네이버 작품 정보를 찾지 못했습니다." } }
    }
    override fun chapterListRequest(manga: SManga): Request {
        val p = NaverParsing.path(manga.url)
        return get("/api/article/list", listOf("titleId" to p.titleId, "page" to "1", "sourceType" to p.type))
    }
    override fun chapterListParse(response: Response): List<SChapter> {
        val p = NaverPath(response.request.url.queryParameter("sourceType")!!, response.request.url.queryParameter("titleId")!!, null)
        val first = json(response); val pages = first.optJSONObject("pageInfo")?.optInt("totalPages", 1) ?: 1
        require(pages in 1..1000) { "네이버 회차 페이지 수 오류" }
        val data = mutableListOf(first)
        if (pages > 1) {
            val pool = Executors.newFixedThreadPool(4)
            try {
                // Preserve page order while limiting network concurrency and queued work.
                for (batch in (2..pages).chunked(4)) {
                    val tasks = batch.map { page -> Callable {
                        client.newCall(get("/api/article/list", listOf("titleId" to p.titleId, "page" to page.toString(), "sourceType" to p.type))).execute().use(::json)
                    } }
                    data.addAll(pool.invokeAll(tasks).map { it.get() })
                }
            } finally { pool.shutdownNow() }
        }
        return data.flatMap { NaverParsing.chapters(it, p) }.distinctBy { it.path }.map { c -> SChapter.create().apply { url = c.path; name = c.name; chapter_number = c.no; date_upload = c.date } }
    }
    override fun pageListRequest(chapter: SChapter) = get(NaverParsing.path(chapter.url, true).detail)
    override fun pageListParse(response: Response): List<Page> {
        require(response.isSuccessful) { "네이버 HTTP ${response.code}. 로그인·구매가 필요한 회차는 WebView에서 확인해 주세요." }
        val images = NaverParsing.pages(response.body!!.string(), response.request.url.toString())
        require(images.isNotEmpty()) { "이미지를 찾지 못했습니다. 로그인·연령 확인·구매가 필요한 회차일 수 있습니다." }
        return images.mapIndexed { index, url -> Page(index, "", url) }
    }
    override fun imageUrlParse(response: Response): String = error("네이버 이미지 주소는 회차에서 직접 가져옵니다.")
    override fun getFilterList() = FilterList(Filter.Header("검색어가 있으면 구분만 적용됩니다."), Kind(), State(), Day(), Genre(), Order())
    private class Kind : Filter.Select<String>("구분", arrayOf("전체", "정식 웹툰", "베스트도전", "도전만화"), 1) { fun value() = arrayOf("", "webtoon", "bestChallenge", "challenge")[state] }
    private class State : Filter.Select<String>("연재 상태", arrayOf("연재중", "완결"))
    private class Day : Filter.Select<String>("요일", arrayOf("전체", "월", "화", "수", "목", "금", "토", "일")) { fun value() = if (state == 0) "" else arrayOf("MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY")[state - 1] }
    private class Genre : Filter.Select<String>("장르", arrayOf("전체", "일상", "개그", "판타지", "액션", "드라마", "순정", "감성", "스릴러", "시대극", "스포츠")) { fun value() = arrayOf("", "DAILY", "COMIC", "FANTASY", "ACTION", "DRAMA", "PURE", "SENSIBILITY", "THRILL", "HISTORICAL", "SPORTS")[state] }
    private class Order : Filter.Select<String>("정렬", arrayOf("업데이트순", "인기순", "조회순")) { fun value() = arrayOf("UPDATE", "ALL_READER", "HIT")[state] }
}

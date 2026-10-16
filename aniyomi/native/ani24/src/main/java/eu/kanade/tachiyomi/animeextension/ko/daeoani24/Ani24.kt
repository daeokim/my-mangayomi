package eu.kanade.tachiyomi.animeextension.ko.daeoani24

import daeo.extensions.common.MediaPlaylist
import daeo.extensions.common.SiteDomain
import eu.kanade.tachiyomi.animesource.model.*
import eu.kanade.tachiyomi.animesource.online.AnimeHttpSource
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import org.jsoup.Jsoup
import rx.Observable
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

private val domain = SiteDomain("ani24", "https://www.ohli24.net", Regex("(?:www\\.)?ohli(\\d+)\\.net"))

class Ani24 : AnimeHttpSource() {
    override val id: Long get() = 850164079243120201L
    override val name = "애니24"
    override val lang = "ko"
    override val supportsLatest = true
    override val baseUrl get() = domain.current
    override fun headersBuilder() = super.headersBuilder().set("User-Agent", SiteDomain.USER_AGENT)
    private fun request(url: String, referer: String = "$baseUrl/") = Request.Builder().url(url).headers(headers).header("Referer", referer).header("Origin", referer.toHttpUrl().let { "${it.scheme}://${it.host}" }).build()
    private fun api(page: Int, category: String = "ong", sort: String = "updatetime", genre: String = "", day: String = ""): Request {
        val url = domain.resolve(client).toHttpUrl().newBuilder().addPathSegment("index.php")
        for ((k, v) in listOf("s" to "api", "c" to "api", "m" to "template", "format" to "jsonp", "name" to "$category.html",
            "catid" to when (category) { "movie" -> "2"; "list" -> "1"; else -> "3" }, "order" to sort, "page" to page.toString(), "keyword" to genre, "weeks" to day)) if (v.isNotBlank()) url.addQueryParameter(k, v)
        return request(url.build().toString())
    }
    override fun popularAnimeRequest(page: Int) = api(page, day = Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul")).get(Calendar.DAY_OF_WEEK).toString())
    override fun latestUpdatesRequest(page: Int) = api(page)
    override fun searchAnimeRequest(page: Int, query: String, filters: AnimeFilterList): Request {
        if (query.isNotBlank()) {
            val path = if (page <= 1) "keyword-$query.html" else "keyword-$query-parent_id-0-page-$page.html"
            return request(domain.resolve(client).toHttpUrl().newBuilder().addPathSegment("search").addPathSegment(path).build().toString())
        }
        return api(page, filters.filterIsInstance<Category>().firstOrNull()?.value() ?: "ong", filters.filterIsInstance<Sort>().firstOrNull()?.value() ?: "updatetime",
            filters.filterIsInstance<Genre>().firstOrNull()?.value().orEmpty(), filters.filterIsInstance<Day>().firstOrNull()?.value().orEmpty())
    }
    private fun parse(response: Response): AnimesPage {
        require(response.isSuccessful) { "애니24 HTTP ${response.code}. WebView 접속을 확인해 주세요." }
        val isApi = response.request.url.queryParameter("format") == "jsonp"
        val text = response.body!!.string(); val html = if (isApi) Ani24Parsing.jsonp(text) else text
        val items = Ani24Parsing.cards(html, response.request.url.toString()).map { c -> SAnime.create().apply { url = c.path; title = c.title; thumbnail_url = c.image; genre = c.genres } }
        return AnimesPage(items, Ani24Parsing.hasNext(html, items.size, isApi))
    }
    override fun popularAnimeParse(response: Response) = parse(response)
    override fun latestUpdatesParse(response: Response) = parse(response)
    override fun searchAnimeParse(response: Response) = parse(response)
    override fun fetchSearchAnime(page: Int, query: String, filters: AnimeFilterList): Observable<AnimesPage> = Observable.fromCallable {
        if (query.isBlank()) return@fromCallable client.newCall(searchAnimeRequest(page, query, filters)).execute().use(::parse)
        val target = Ani24Parsing.normalized(query)
        for (term in Ani24Parsing.searchTerms(query).take(if (page == 1) 10 else 1)) {
            val parsed = client.newCall(searchAnimeRequest(page, term, filters)).execute().use(::parse)
            val matched = parsed.animes.filter { Ani24Parsing.normalized(it.title).contains(target) }
            if (matched.isNotEmpty()) return@fromCallable AnimesPage(matched, parsed.hasNextPage)
        }
        AnimesPage(emptyList(), false)
    }
    override suspend fun getSearchAnime(page: Int, query: String, filters: AnimeFilterList): AnimesPage = fetchSearchAnime(page, query, filters).toBlocking().single()
    override fun animeDetailsRequest(anime: SAnime) = request(domain.resolve(client) + Ani24Parsing.path(anime.url))
    override fun animeDetailsParse(response: Response): SAnime {
        require(response.isSuccessful) { "애니24 HTTP ${response.code}" }
        val doc = Jsoup.parse(response.body!!.string(), response.request.url.toString())
        val meta = doc.select(".article-box-meta li").mapNotNull { e -> e.select("span").takeIf { it.isNotEmpty() }?.let { it.first()!!.text().removeSuffix(":") to it.drop(1).joinToString(" ") { it.text() } } }.toMap()
        return SAnime.create().apply {
            url = Ani24Parsing.path(response.request.url.toString())
            title = doc.selectFirst(".list-content .top-movies-list-title h2")?.text().orEmpty().ifBlank { doc.selectFirst("meta[property=og:title]")?.attr("content").orEmpty().substringBefore(" 자막").trim() }
            require(title.isNotBlank()) { "애니24 작품 정보를 찾지 못했습니다." }
            thumbnail_url = doc.selectFirst(".article-box-img img")?.absUrl("src")?.ifBlank { null } ?: doc.selectFirst("meta[property=og:image]")?.absUrl("content")
            author = meta["원작"]; artist = meta["제작사"]; genre = meta["장르"] ?: doc.selectFirst("meta[name=keywords]")?.attr("content")
            description = doc.selectFirst(".movie-coment")?.text()
            val paths = doc.select(".page-breadcrumb a[href]").map { it.absUrl("href").trimEnd('/') }
            status = when { paths.any { it.endsWith("/ing") } -> SAnime.ONGOING; paths.any { it.endsWith("/finished") || it.endsWith("/movie") } -> SAnime.COMPLETED; else -> SAnime.UNKNOWN }
        }
    }
    override fun episodeListRequest(anime: SAnime) = animeDetailsRequest(anime)
    override fun episodeListParse(response: Response) = Ani24Parsing.episodes(response.body!!.string(), response.request.url.toString()).map { e -> SEpisode.create().apply {
        url = e.path; name = e.name
        episode_number = Regex("(\\d+(?:\\.\\d+)?)\\s*(?:화|회)").find(name)?.groupValues?.get(1)?.toFloatOrNull() ?: -1f
        date_upload = runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).apply { timeZone = TimeZone.getTimeZone("Asia/Seoul") }.parse(e.date)?.time }.getOrNull() ?: 0L
    } }
    override fun videoListRequest(episode: SEpisode) = request(domain.resolve(client) + Ani24Parsing.path(episode.url))
    override fun videoListParse(response: Response): List<Video> {
        require(response.isSuccessful) { "애니24 HTTP ${response.code}" }
        val doc = Jsoup.parse(response.body!!.string(), response.request.url.toString())
        val frames = doc.select("iframe[src]")
        val frame = doc.selectFirst("iframe#video[src]") ?: frames.firstOrNull { it.attr("src").contains("/video/") } ?: frames.firstOrNull() ?: error("애니24 플레이어를 찾지 못했습니다.")
        val player = frame.absUrl("src").toHttpUrl()
        require(player.isHttps && player.username.isEmpty() && player.password.isEmpty()) { "플레이어 주소 오류" }
        val origin = "${player.scheme}://${player.host}"
        val playerHeaders = headers.newBuilder().set("Referer", player.toString()).set("Origin", origin).set("X-Requested-With", "XMLHttpRequest").build()
        var hash = player.pathSegments.last()
        if (!Regex("[0-9a-f]{32}", RegexOption.IGNORE_CASE).matches(hash)) {
            val html = client.newCall(Request.Builder().url(player).headers(playerHeaders).build()).execute().use { r -> require(r.isSuccessful) { "플레이어 HTTP ${r.code}" }; r.body!!.string() }
            hash = Regex("FirePlayer\\(\"([^\"]+)\"").find(Ani24Parsing.unpack(html))?.groupValues?.get(1) ?: error("플레이어 식별자를 읽지 못했습니다.")
        }
        require(hash.length <= 512 && hash.none { it.isISOControl() }) { "플레이어 식별자 오류" }
        val url = "$origin/player/index.php".toHttpUrl().newBuilder().addQueryParameter("data", hash).addQueryParameter("do", "getVideo").build()
        val data = client.newCall(Request.Builder().url(url).headers(playerHeaders).post(FormBody.Builder().add("hash", hash).add("r", "").build()).build()).execute().use { r ->
            require(r.isSuccessful) { "영상 요청 HTTP ${r.code}" }; JSONObject(r.body!!.string())
        }
        val video = data.optString("securedLink").ifBlank { data.optString("videoSource") }.toHttpUrl()
        require(video.isHttps) { "영상 주소 오류" }
        val videoOrigin = "${video.scheme}://${video.host}"
        val videoHeaders = headers.newBuilder().set("Accept", "*/*").set("Referer", "$videoOrigin/").set("Origin", videoOrigin).build()
        val playlist = client.newCall(Request.Builder().url(video).headers(videoHeaders).build()).execute().use { r -> require(r.isSuccessful) { "재생목록 HTTP ${r.code}" }; MediaPlaylist.parse(r.body!!.string(), video.toString()) }
        return playlist.variants.map { v -> Video(v.url, "애니24 · ${v.label}", v.url, headers = videoHeaders,
            subtitleTracks = playlist.subtitles.map { Track(it.url, it.label) }, audioTracks = playlist.audio.map { Track(it.url, it.label) }) }
    }
    override fun getFilterList() = AnimeFilterList(Category(), Genre(), Day(), Sort())
    private class Category : AnimeFilter.Select<String>("분류", arrayOf("방영중", "완결", "극장판")) { fun value() = arrayOf("ong", "list", "movie")[state] }
    private class Sort : AnimeFilter.Select<String>("정렬", arrayOf("업데이트", "인기순", "방영일")) { fun value() = arrayOf("updatetime", "air_date", "hits")[state] }
    private class Day : AnimeFilter.Select<String>("요일 (방영중)", arrayOf("전체", "일", "월", "화", "수", "목", "금", "토", "기타")) { fun value() = if (state == 0) "" else state.toString() }
    private class Genre : AnimeFilter.Select<String>("장르", arrayOf("전체", "미스테리", "추리", "거대로봇", "SF", "모험", "백합", "판타지", "이세계", "코미디", "하렘", "학원", "로맨스", "액션", "닌자", "아이돌", "게임", "스포츠", "청춘", "능력", "드라마", "성장", "일상", "연애", "배틀")) { fun value() = if (state == 0) "" else values[state] }
}

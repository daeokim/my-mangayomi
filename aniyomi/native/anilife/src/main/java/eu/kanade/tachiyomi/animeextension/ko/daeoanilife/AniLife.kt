package eu.kanade.tachiyomi.animeextension.ko.daeoanilife

import daeo.extensions.common.SiteDomain
import daeo.extensions.common.CronetClient
import eu.kanade.tachiyomi.animesource.model.*
import eu.kanade.tachiyomi.animesource.online.AnimeHttpSource
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import rx.Observable
import java.util.Calendar
import java.util.TimeZone

class AniLife : AnimeHttpSource() {
    private val domain by lazy { AniLifeDomain(LifeDomainPreferences()) }
    private val transport: OkHttpClient by lazy { CronetClient.create(super.client, "eu.kanade.tachiyomi.animeextension.ko.daeoanilife") }
    override val client: OkHttpClient by lazy {
        transport.newBuilder().apply { interceptors().add(0, LifeDomainInterceptor(domain, transport)) }.build()
    }
    override val id: Long get() = 850164079243120202L
    override val name = "애니라이프"
    override val lang = "ko"
    override val supportsLatest = true
    override val baseUrl get() = domain.current
    override fun headersBuilder() = super.headersBuilder().set("User-Agent", SiteDomain.USER_AGENT)
        .set("Accept", "application/json, text/plain, */*").set("Accept-Language", "ko-KR,ko;q=0.9,en;q=0.8")
    private fun get(url: String, referer: String = "$baseUrl/tags") = Request.Builder().url(url).headers(headers)
        .header("Referer", referer).header("Origin", baseUrl).build()
    private fun catalog(page: Int, sort: String = "latest", scope: String = "", query: String = "", genre: String = "", year: String = "", status: String = "", day: String = ""): Request {
        val url = domain.resolve(transport).toHttpUrl().newBuilder().addPathSegments("api/anime")
            .addQueryParameter("page", page.toString()).addQueryParameter("limit", "24").addQueryParameter("sort", sort)
        for ((k, v) in listOf("scope" to scope, "q" to query, "genre" to genre, "year" to year, "status" to status, "day" to day)) if (v.isNotBlank()) url.addQueryParameter(k, v)
        return get(url.addQueryParameter("v", "catalog-media-2").build().toString())
    }
    override fun popularAnimeRequest(page: Int): Request {
        val index = (Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul")).get(Calendar.DAY_OF_WEEK) + 5) % 7
        return catalog(page, status = "방영중", day = days[index])
    }
    override fun latestUpdatesRequest(page: Int) = catalog(page, scope = "updates")
    override fun searchAnimeRequest(page: Int, query: String, filters: AnimeFilterList): Request = catalog(page,
        sort = filters.filterIsInstance<Sort>().firstOrNull()?.value() ?: "latest", query = query,
        genre = filters.filterIsInstance<Genre>().firstOrNull()?.value().orEmpty(), year = filters.filterIsInstance<Year>().firstOrNull()?.value().orEmpty(),
        status = filters.filterIsInstance<Status>().firstOrNull()?.value().orEmpty(), day = filters.filterIsInstance<Day>().firstOrNull()?.value().orEmpty())
    private fun mapped(item: LifeItem) = SAnime.create().apply {
        url = "/content/${item.id}/1"; title = item.title; thumbnail_url = item.image; author = item.studio
        genre = item.genres; description = item.description
        status = when (item.status) { "완결" -> SAnime.COMPLETED; "방영중" -> SAnime.ONGOING; else -> SAnime.UNKNOWN }
    }
    private fun parse(response: Response): AnimesPage {
        require(response.isSuccessful) { "애니라이프 HTTP ${response.code}. WebView에서 접속을 확인해 주세요." }
        val (items, more) = AniLifeParsing.list(response.body!!.string(), baseUrl)
        return AnimesPage(items.map(::mapped), more)
    }
    override fun popularAnimeParse(response: Response) = parse(response)
    override fun latestUpdatesParse(response: Response) = parse(response)
    override fun searchAnimeParse(response: Response) = parse(response)
    override fun fetchSearchAnime(page: Int, query: String, filters: AnimeFilterList): Observable<AnimesPage> = Observable.fromCallable {
        if (query.isBlank()) return@fromCallable client.newCall(searchAnimeRequest(page, query, filters)).execute().use(::parse)
        val target = AniLifeParsing.normalized(query)
        for (term in AniLifeParsing.searchTerms(query).take(if (page == 1) 10 else 1)) {
            val parsed = client.newCall(searchAnimeRequest(page, term, filters)).execute().use(::parse)
            val matched = parsed.animes.filter { AniLifeParsing.normalized(it.title).contains(target) || AniLifeParsing.normalized(it.author.orEmpty()).contains(target) }
            if (matched.isNotEmpty()) return@fromCallable AnimesPage(matched, term == query && parsed.hasNextPage)
        }
        AnimesPage(emptyList(), false)
    }
    override suspend fun getSearchAnime(page: Int, query: String, filters: AnimeFilterList): AnimesPage = fetchSearchAnime(page, query, filters).toBlocking().single()
    override fun animeDetailsRequest(anime: SAnime): Request {
        val id = AniLifeParsing.detailId(anime.url)
        return get("${domain.resolve(transport)}/api/anime/$id?v=playback-policy-v2", "$baseUrl/content/$id/1")
    }
    override fun animeDetailsParse(response: Response): SAnime = mapped(AniLifeParsing.item(JSONObject(response.body!!.string()).getJSONObject("item"), baseUrl))
    override fun episodeListRequest(anime: SAnime) = animeDetailsRequest(anime)
    override fun episodeListParse(response: Response) = AniLifeParsing.episodes(response.body!!.string()).map { e -> SEpisode.create().apply {
        url = e.path; name = e.title; episode_number = e.number
    } }
    override fun videoListRequest(episode: SEpisode): Request {
        require(Regex("/api/playback/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+").matches(episode.url)) { "회차 주소 오류" }
        return get(domain.resolve(transport) + episode.url)
    }
    private val delivery = AniLifeDelivery()
    override fun fetchVideoList(episode: SEpisode): Observable<List<Video>> = Observable.fromCallable {
        repeat(2) { attempt ->
            val base = domain.resolve(transport)
            try {
                val result = delivery.resolve(client, base, episode.url, headers)
                val videoHeaders = headers.newBuilder().set("Referer", result.referer).set("Origin", base).set("Accept", "*/*").build()
                val tracks = result.subtitle?.let { listOf(Track(it, "사이트 자막")) } ?: emptyList()
                return@fromCallable result.streams.map { (url, label) -> Video(url, label, url, headers = videoHeaders, subtitleTracks = tracks) }
            } catch (moved: LifeDomainMoved) { if (attempt == 1) throw moved }
        }
        error("애니라이프 새 주소에서 재생을 다시 시도해 주세요.")
    }
    override suspend fun getVideoList(episode: SEpisode): List<Video> = fetchVideoList(episode).toBlocking().single()
    override fun videoListParse(response: Response): List<Video> = error("재생 세션은 fetchVideoList에서 처리합니다.")
    override fun getEpisodeUrl(episode: SEpisode): String {
        val p = episode.url.split('/')
        return if (p.size == 5) "$baseUrl/content/${p[3]}/${p[4]}" else baseUrl
    }
    override fun getFilterList() = AnimeFilterList(Genre(), Year(), Status(), Day(), Sort())
    private class Genre : AnimeFilter.Select<String>("장르", genres) { fun value() = if (state == 0) "" else values[state] }
    private class Year : AnimeFilter.Select<String>("연도", arrayOf("전체") + (2026 downTo 1977).map(Int::toString)) { fun value() = if (state == 0) "" else values[state] }
    private class Status : AnimeFilter.Select<String>("상태", arrayOf("전체", "방영중", "완결", "방영예정")) { fun value() = if (state == 0) "" else values[state] }
    private class Day : AnimeFilter.Select<String>("요일", arrayOf("전체") + days) { fun value() = if (state == 0) "" else values[state] }
    private class Sort : AnimeFilter.Select<String>("정렬", arrayOf("최신순", "인기순", "평점순", "이름순")) { fun value() = arrayOf("latest", "popular", "score", "name")[state] }
    companion object {
        private val days = arrayOf("월", "화", "수", "목", "금", "토", "일")
        private val genres = arrayOf("전체", "코미디", "액션", "판타지", "드라마", "로맨스", "일상", "모험", "SF", "초자연", "미스터리", "에치", "스포츠", "음악", "메카", "심리", "호러", "마법소녀", "스릴러", "소년", "학원")
    }
}

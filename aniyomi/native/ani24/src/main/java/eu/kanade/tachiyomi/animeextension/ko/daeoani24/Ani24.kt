package eu.kanade.tachiyomi.animeextension.ko.daeoani24

import daeo.extensions.common.MediaPlaylist
import daeo.extensions.common.SiteDomain
import daeo.extensions.common.CronetClient
import eu.kanade.tachiyomi.animesource.model.*
import eu.kanade.tachiyomi.animesource.online.AnimeHttpSource
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject
import rx.Observable

// The site moved from www.ohli24.net to ani.ohli24.com (2026-10-24); both forms stay valid for registry hints.
private val domain = SiteDomain("ani24", "https://ani.ohli24.com", Regex("(?:www\\.|ani\\.)?ohli(\\d+)\\.(?:net|com)"))

class Ani24 : AnimeHttpSource() {
    override val client: OkHttpClient by lazy { CronetClient.create(super.client, "eu.kanade.tachiyomi.animeextension.ko.daeoani24") }
    override val id: Long get() = 850164079243120201L
    override val name = "애니24"
    override val lang = "ko"
    override val supportsLatest = true
    override val baseUrl get() = domain.current
    override fun headersBuilder() = super.headersBuilder().set("User-Agent", SiteDomain.USER_AGENT)
    private fun request(url: String, referer: String = "$baseUrl/") = Request.Builder().url(url).headers(headers).header("Referer", referer).header("Origin", referer.toHttpUrl().let { "${it.scheme}://${it.host}" }).build()
    // ani.ohli24.com boards: 방영중 (weekday board, one page), 완결 and 극장판 (24 per page), and search.
    private fun board(name: String, page: Int) = request(domain.resolve(client).toHttpUrl().newBuilder().addPathSegment(name)
        .apply { if (page > 1) addQueryParameter("page", page.toString()) }.build().toString())
    override fun popularAnimeRequest(page: Int) = board("방영중", page)
    override fun latestUpdatesRequest(page: Int) = board("방영중", page)
    override fun searchAnimeRequest(page: Int, query: String, filters: AnimeFilterList): Request {
        if (query.isNotBlank()) return request(domain.resolve(client).toHttpUrl().newBuilder().addPathSegments("bbs/search.php")
            .addQueryParameter("stx", query.trim()).apply { if (page > 1) addQueryParameter("page", page.toString()) }.build().toString())
        return board(filters.filterIsInstance<Category>().firstOrNull()?.value() ?: "방영중", page)
    }
    private fun parse(response: Response): AnimesPage {
        require(response.isSuccessful) { "애니24 HTTP ${response.code}. WebView 접속을 확인해 주세요." }
        val (cards, next) = Ani24Parsing.list(response.body!!.string(), baseUrl)
        return AnimesPage(cards.map { c -> SAnime.create().apply { url = c.path; title = c.title; thumbnail_url = c.image; genre = c.genres } }, next)
    }
    override fun popularAnimeParse(response: Response) = parse(response)
    override fun latestUpdatesParse(response: Response) = parse(response)
    override fun searchAnimeParse(response: Response) = parse(response)
    private fun seriesRequest(path: String, page: Int = 1) = request(domain.resolve(client) + Ani24Parsing.path(path).substringBefore('?') + if (page > 1) "?page=$page" else "")
    override fun animeDetailsRequest(anime: SAnime) = seriesRequest(anime.url)
    override fun animeDetailsParse(response: Response): SAnime {
        require(response.isSuccessful) { "애니24 HTTP ${response.code}" }
        val comic = Ani24Parsing.series(response.body!!.string()).comic
        return SAnime.create().apply {
            url = Ani24Parsing.seriesPath(comic.getString("slug"))
            title = comic.optString("title")
            require(title.isNotBlank()) { "애니24 작품 정보를 찾지 못했습니다." }
            thumbnail_url = Ani24Parsing.image(baseUrl, comic.optString("thumbnail"))
            author = comic.optString("author").takeIf { it.isNotBlank() && it != "null" }
            artist = comic.optString("director").takeIf { it.isNotBlank() && it != "null" }
            genre = comic.optString("tags_string").takeIf { it.isNotBlank() }
            description = listOf(Ani24Parsing.plain(comic.optString("description")), comic.optJSONObject("metadata")?.optString("info").orEmpty())
                .filter { it.isNotBlank() && it != "null" }.joinToString("\n\n")
            status = when (comic.optString("category")) { "방영중" -> SAnime.ONGOING; "종영", "완결", "극장판" -> SAnime.COMPLETED; else -> SAnime.UNKNOWN }
        }
    }
    override fun episodeListRequest(anime: SAnime) = seriesRequest(anime.url)
    private fun episodeOf(seriesPath: String, page: Int, e: org.json.JSONObject) = SEpisode.create().apply {
        // The id after '#' finds the episode again; the page is only a hint, since new episodes shift pages.
        url = "$seriesPath?page=$page#${e.getLong("id")}"
        name = e.optString("title").ifBlank { e.optString("slug") }
        episode_number = Regex("(\\d+(?:\\.\\d+)?)\\s*(?:화|회)").find(name)?.groupValues?.get(1)?.toFloatOrNull() ?: -1f
        date_upload = runCatching { java.time.Instant.parse(e.getString("published_at")).toEpochMilli() }.getOrDefault(0L)
    }
    override fun episodeListParse(response: Response): List<SEpisode> {
        require(response.isSuccessful) { "애니24 HTTP ${response.code}" }
        val first = Ani24Parsing.series(response.body!!.string())
        val path = Ani24Parsing.seriesPath(first.comic.getString("slug"))
        val episodes = first.episodes.map { episodeOf(path, 1, it) }.toMutableList()
        for (page in 2..first.lastPage) {
            val next = client.newCall(seriesRequest(path, page)).execute().use { r ->
                require(r.isSuccessful) { "애니24 회차 HTTP ${r.code}" }; Ani24Parsing.series(r.body!!.string())
            }
            episodes += next.episodes.map { episodeOf(path, page, it) }
        }
        return episodes.distinctBy { it.url.substringAfter('#') }
    }
    private fun playerUrl(episode: SEpisode): HttpUrl {
        val path = episode.url.substringBefore('#')
        val id = episode.url.substringAfter('#', "").toLongOrNull() ?: error("애니24 회차 주소가 예전 형식입니다. 작품을 새로고침해 주세요.")
        val hint = path.substringAfter("page=", "1").toIntOrNull() ?: 1
        var last = hint
        val pages = sequence { yield(hint); for (p in 1..50) if (p != hint) yield(p) }
        for (page in pages) {
            if (page > last && page != hint) break
            val series = client.newCall(seriesRequest(path, page)).execute().use { r -> require(r.isSuccessful) { "애니24 회차 HTTP ${r.code}" }; Ani24Parsing.series(r.body!!.string()) }
            last = series.lastPage
            series.episodes.firstOrNull { it.optLong("id") == id }?.let { e ->
                return e.optJSONObject("body")?.optString("url")?.toHttpUrlOrNull() ?: error("애니24 플레이어 주소가 없습니다.")
            }
        }
        error("애니24 회차를 찾지 못했습니다. 작품을 새로고침해 주세요.")
    }
    override fun fetchVideoList(episode: SEpisode): Observable<List<Video>> = Observable.fromCallable { playerVideos(playerUrl(episode)) }
    override suspend fun getVideoList(episode: SEpisode): List<Video> = fetchVideoList(episode).toBlocking().single()
    override fun videoListRequest(episode: SEpisode) = seriesRequest(episode.url)
    override fun videoListParse(response: Response): List<Video> = error("재생 주소는 fetchVideoList에서 처리합니다.")
    private fun playerVideos(player: HttpUrl): List<Video> {
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
    override fun getFilterList() = AnimeFilterList(Category())
    private class Category : AnimeFilter.Select<String>("분류", arrayOf("방영중", "완결", "극장판")) { fun value() = arrayOf("방영중", "완결", "극장판")[state] }
}

package eu.kanade.tachiyomi.animeextension.ko.daeotvwiki

import eu.kanade.tachiyomi.animesource.AnimeSourceFactory
import daeo.extensions.common.CronetClient
import eu.kanade.tachiyomi.animesource.model.*
import eu.kanade.tachiyomi.animesource.online.AnimeHttpSource
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.jsoup.Jsoup
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.concurrent.TimeUnit

class TvWikiFactory : AnimeSourceFactory {
    override fun createSources() = listOf(
        TvWiki("티비위키 영화", "movie", 850164079243120101L),
        TvWiki("티비위키 드라마", "drama", 850164079243120102L),
        TvWiki("티비위키 예능", "ent", 850164079243120103L),
        TvWiki("티비위키 애니", "animation", 850164079243120104L),
    )
}

internal object TvWikiDomain {
    const val REGISTRY = "https://daeokim.github.io/my-mangayomi/domains.json"
    @Volatile var current = "https://tvwiki54.net"
        private set
    private var checkedAt = 0L
    @Synchronized fun resolve(client: OkHttpClient): String {
        val now = System.nanoTime()
        if (now - checkedAt < TimeUnit.MINUTES.toNanos(10) && checkedAt != 0L) return current
        try {
            client.newBuilder().callTimeout(8, TimeUnit.SECONDS).build()
                .newCall(Request.Builder().url(REGISTRY).header("Cache-Control", "no-cache").build()).execute().use { r ->
                    if (r.isSuccessful) TvWikiParsing.registryCandidate(r.body!!.string(), current)?.let { current = it }
                }
        } catch (_: Exception) { /* Keep the last valid address on transient failure. */ }
        checkedAt = now
        return current
    }
}

class TvWiki(override val name: String, private val category: String, override val id: Long) : AnimeHttpSource() {
    override val client: OkHttpClient by lazy { CronetClient.create(super.client, "eu.kanade.tachiyomi.animeextension.ko.daeotvwiki") }
    override fun headersBuilder() = super.headersBuilder().set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
    override val lang = "ko"
    override val supportsLatest = true
    override val baseUrl get() = TvWikiDomain.current
    private fun resolved() = TvWikiDomain.resolve(client)
    private fun get(url: String, referer: String = baseUrl + "/") = Request.Builder().url(url)
        .headers(headers).header("Referer", referer).build()
    override fun popularAnimeRequest(page: Int): Request = get(resolved().toHttpUrl().newBuilder()
        .addPathSegment("popular").addQueryParameter("period", "d").addQueryParameter("sb", category).addQueryParameter("page", page.toString()).build().toString())
    override fun latestUpdatesRequest(page: Int): Request = get("${resolved()}/$category?page=$page")
    override fun searchAnimeRequest(page: Int, query: String, filters: AnimeFilterList): Request {
        val selected = filters.filterIsInstance<CategoryFilter>().firstOrNull()?.value() ?: category
        return get(resolved().toHttpUrl().newBuilder().addPathSegment("search")
            .addQueryParameter("stx", query).addQueryParameter("sst", "subIdx").addQueryParameter("onetable", selected)
            .addQueryParameter("page", page.toString()).build().toString())
    }
    override fun getFilterList() = AnimeFilterList(CategoryFilter(category))
    private fun parseList(response: Response): AnimesPage {
        val html = response.body!!.string()
        val url = response.request.url.toString()
        val items = TvWikiParsing.cards(html, url).map { c -> SAnime.create().apply {
            this.url = c.path; title = c.title; thumbnail_url = c.image; description = c.description
        } }
        if (items.isEmpty() && (response.code == 403 || html.contains("cf-chl-") || html.contains("Just a moment"))) error("사이트 보호 화면입니다. 애니요미 WebView에서 접속을 확인해 주세요.")
        return AnimesPage(items, TvWikiParsing.hasNext(html, url, response.request.url.queryParameter("page")?.toIntOrNull() ?: 1))
    }
    override fun popularAnimeParse(response: Response) = parseList(response)
    override fun latestUpdatesParse(response: Response) = parseList(response)
    override fun searchAnimeParse(response: Response) = parseList(response)
    override fun animeDetailsRequest(anime: SAnime) = get(resolved() + (TvWikiParsing.path(anime.url) ?: error("작품 주소 오류")))
    override fun animeDetailsParse(response: Response): SAnime {
        val doc = Jsoup.parse(response.body!!.string(), response.request.url.toString())
        return SAnime.create().apply {
            url = TvWikiParsing.path(response.request.url.toString()) ?: error("작품 주소 오류")
            title = doc.selectFirst("#bo_v_title .bo_v_tit, h1")?.text().orEmpty().ifBlank { doc.selectFirst("meta[property=og:title]")?.attr("content").orEmpty() }
            require(title.isNotBlank()) { "작품 정보를 찾지 못했습니다. WebView 접속을 확인해 주세요." }
            thumbnail_url = doc.selectFirst("meta[property=og:image]")?.absUrl("content")
            description = doc.selectFirst(".thumb-desc, .view-content .description, #bo_v_con")?.text()
            status = SAnime.UNKNOWN
        }
    }
    override fun episodeListRequest(anime: SAnime) = animeDetailsRequest(anime)
    override fun episodeListParse(response: Response): List<SEpisode> {
        val items = TvWikiParsing.episodes(response.body!!.string(), response.request.url.toString())
        require(items.isNotEmpty()) { "회차 목록을 찾지 못했습니다. WebView 접속을 확인해 주세요." }
        return items.map { item -> SEpisode.create().apply {
            url = item.path; name = item.name
            episode_number = Regex("(\\d+(?:\\.\\d+)?)\\s*(?:회|화)").find(name)?.groupValues?.get(1)?.toFloatOrNull() ?: -1f
            date_upload = Regex("20\\d{2}[-./]\\d{1,2}[-./]\\d{1,2}").find(item.date)?.value?.let {
                runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).parse(it.replace('.', '-').replace('/', '-'))?.time }.getOrNull()
            } ?: 0L
        } }
    }
    override fun videoListRequest(episode: SEpisode): Request {
        val base = resolved()
        val path = TvWikiParsing.path(episode.url, true) ?: error("회차 주소 오류")
        val parts = path.trim('/').split('/')
        return get(base.toHttpUrl().newBuilder().addPathSegments("bbs/get_episode.php")
            .addQueryParameter("bo_table", parts[0]).addQueryParameter("wr_id", parts[1]).addQueryParameter("ep_idx", parts[2]).build().toString(), base + path)
            .newBuilder().header("Accept", "application/json").header("X-Requested-With", "XMLHttpRequest").build()
    }
    override fun videoListParse(response: Response): List<Video> {
        val base = response.request.url.let { "${it.scheme}://${it.host}" }
        val referer = response.request.header("Referer") ?: base + "/"
        val raw = response.body!!.string()
        DeviceLog.e("tvwiki get_episode ${response.request.url} -> HTTP ${response.code} keys=" + runCatching { JSONObject(raw).optJSONObject("episode")?.keys()?.asSequence()?.toList() }.getOrNull())
        val data = JSONObject(raw)
        require(data.optBoolean("success")) { "사이트에서 회차 정보를 제공하지 않았습니다." }
        val episode = data.getJSONObject("episode")
        require(episode.optString("hls_url").isNotBlank()) { "영상 주소가 없습니다." }
        val sessionClient = client.newBuilder().callTimeout(10, TimeUnit.SECONDS).build()
        var session: JSONObject? = null
        val tried = mutableSetOf<String>()
        for (field in listOf("session_data1", "session_data2")) {
            val value = episode.opt(field)
            if (value == null || value == JSONObject.NULL) continue
            val payload = if (value is String) value else value.toString()
            if (payload.isBlank() || !tried.add(payload)) continue
            try {
                sessionClient.newCall(Request.Builder().url("$base/api/create_session.php").headers(headers)
                    .header("Referer", referer).header("Origin", base).header("Accept", "application/json")
                    .post(payload.toRequestBody("application/json; charset=utf-8".toMediaType())).build()).execute().use { r ->
                        DeviceLog.e("tvwiki create_session $field -> HTTP ${r.code}")
                        if (r.isSuccessful) {
                            val result = JSONObject(r.body!!.string())
                            if (result.optBoolean("success") && listOf("player_url", "t", "sig").all { result.optString(it).isNotBlank() }) session = result
                        }
                    }
            } catch (error: Exception) { DeviceLog.e("tvwiki create_session $field ${error.javaClass.simpleName}: ${error.message}") }
            if (session != null) break
        }
        val result = session ?: error("티비위키 재생 세션을 만들지 못했습니다. WebView 접속 후 다시 시도해 주세요.")
        val player = base.toHttpUrl().resolve(result.getString("player_url"))!!.newBuilder()
            .addQueryParameter("t", result.getString("t")).addQueryParameter("sig", result.getString("sig")).build()
        require(player.isHttps) { "안전하지 않은 플레이어 주소" }
        val playlist = player.resolve(episode.getString("hls_url")) ?: error("영상 주소 오류")
        val videoHeaders = headers.newBuilder().set("Referer", player.toString()).set("Origin", "${player.scheme}://${player.host}").set("Accept", "*/*").build()
        DeviceLog.e("tvwiki player=${player.host} playlist=${playlist.host}${playlist.encodedPath}")
        val local = TvWikiProxy.open(client, playlist.toString(), videoHeaders)
        return listOf(Video(local, "자동 (휴대폰 내부 HLS)", local, headers = Headers.Builder().build()))
    }
    private class CategoryFilter(default: String) : AnimeFilter.Select<String>("분류", labels, keys.indexOf(default).coerceAtLeast(0)) {
        fun value() = keys[state]
        companion object {
            val keys = arrayOf("movie", "kor_movie", "drama", "world", "short_drama", "old_drama", "ent", "sisa", "ott_ent", "old_ent", "animation", "ani_movie")
            val labels = arrayOf("영화", "한국영화", "드라마", "해외드라마", "숏폼 드라마", "추억의 드라마", "예능", "시사·다큐", "해외 예능·다큐", "추억의 예능", "애니메이션", "극장판 애니")
        }
    }
}

package eu.kanade.tachiyomi.animeextension.ko.daeotvwiki

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.jsoup.Jsoup
import org.json.JSONObject
import okio.ByteString.Companion.decodeBase64

internal object TvWikiParsing {
    private val categories = setOf("movie", "kor_movie", "drama", "ent", "sisa", "world", "ott_ent", "short_drama", "ani_movie", "animation", "old_ent", "old_drama")
    fun path(value: String, episode: Boolean = false): String? {
        val path = (if (value.startsWith("/")) "https://tvwiki54.net$value" else value).toHttpUrlOrNull()?.encodedPath ?: return null
        val pieces = path.trim('/').split('/')
        if ((if (episode) pieces.size != 3 else pieces.size !in 2..3) || pieces[0] !in categories || pieces.drop(1).any { !it.matches(Regex("[0-9]+")) }) return null
        return "/" + (if (episode) pieces else pieces.take(2)).joinToString("/")
    }
    data class Card(val path: String, val title: String, val image: String?, val description: String?)
    data class Episode(val path: String, val name: String, val date: String)
    fun cards(html: String, base: String): List<Card> {
        val doc = Jsoup.parse(html, base)
        val boxes = doc.select("#list_type .box, #line_type .box, #mov_con_list .box, .slide_popular .box, .slide_drama .box, .slide_movie .box, .slide_ent .box, .slide_ani_movie .box")
        return boxes.mapNotNull { box ->
            val a = box.selectFirst("a.title2[href], a.title[href], a.img[href], a[href]") ?: return@mapNotNull null
            val p = path(a.absUrl("href")) ?: return@mapNotNull null
            val title = box.selectFirst(".title2, .title")?.text()?.trim().orEmpty().ifBlank { a.attr("title").ifBlank { a.text().trim() } }
            if (title.isBlank()) return@mapNotNull null
            val img = box.selectFirst("img")
            val image = listOf("data-original", "data-src", "src").firstNotNullOfOrNull { attr -> img?.absUrl(attr)?.takeIf { it.startsWith("https://") || it.startsWith("http://") } }
            Card(p, title, image, box.selectFirst(".thumb-desc")?.text())
        }.distinctBy { it.path }
    }
    fun episodes(html: String, base: String): List<Episode> {
        val doc = Jsoup.parse(html, base)
        val rows = doc.select("#other_list li")
        return rows.mapNotNull { row ->
            val a = (row.selectFirst("a.title[href]") ?: row.selectFirst("a.ep-link[href], a[href]")) ?: return@mapNotNull null
            val p = path(a.absUrl("href"), true) ?: return@mapNotNull null
            Episode(p, a.text().trim().ifBlank { "회차 ${p.substringAfterLast('/')}" }, row.selectFirst(".date, .datetime, time")?.text().orEmpty())
        }.distinctBy { it.path }
    }
    fun hasNext(html: String, base: String, page: Int): Boolean {
        val doc = Jsoup.parse(html, base)
        return doc.select("a[rel=next], a.pg_next, .pagination a.next, .pg_wrap a, .pagination a").any { a ->
            val next = a.absUrl("href").toHttpUrlOrNull()?.queryParameter("page")?.toIntOrNull()
            next != null && next > page && !a.hasClass("disabled") && a.attr("aria-disabled") != "true"
        }
    }
    fun registryCandidate(json: String, current: String): String? {
        val candidate = JSONObject(json).getJSONObject("domains").getJSONObject("tvwiki").getString("baseUrl").trimEnd('/')
        val pattern = Regex("https://(?:www\\.)?tvwiki([0-9]+)\\.net")
        val number = pattern.matchEntire(candidate)?.groupValues?.get(1)?.toIntOrNull() ?: return null
        val floor = pattern.matchEntire(current)?.groupValues?.get(1)?.toIntOrNull() ?: 54
        return candidate.takeIf { number >= maxOf(54, floor) }
    }
    // The site's key endpoint returns a JSON envelope. Nothing is sent to an external bridge.
    fun decodeKey(body: ByteArray): ByteArray {
        if (body.size == 16) return body
        require(body.size <= 65536) { "영상 키 응답이 너무 큽니다." }
        val data = JSONObject(String(body, Charsets.UTF_8))
        if (data.has("layers")) return TvWikiKey.decode(data)
        val rule = data.getJSONObject("rule")
        val sizes = rule.getJSONArray("segment_sizes")
        val permutation = rule.getJSONArray("permutation")
        val noise = rule.getInt("noise_length")
        val length = rule.optInt("key_length", 16)
        require(length == 16 && noise in 0..4096 && sizes.length() in 1..16 && sizes.length() == permutation.length()) { "영상 키 규칙 오류" }
        val encrypted = data.getString("encrypted_key").decodeBase64()?.toByteArray() ?: error("영상 키 인코딩 오류")
        val pieces = arrayOfNulls<ByteArray>(sizes.length())
        var offset = 0
        for (i in 0 until permutation.length()) {
            val original = permutation.getInt(i)
            require(original in pieces.indices && pieces[original] == null) { "영상 키 순서 오류" }
            val size = sizes.getInt(original)
            require(size in 1..16 && offset + size + noise <= encrypted.size) { "영상 키 조각 오류" }
            pieces[original] = encrypted.copyOfRange(offset, offset + size)
            offset += size + noise
        }
        require(offset == encrypted.size && pieces.sumOf { it!!.size } == length) { "영상 키 길이 오류" }
        return pieces.flatMap { it!!.asIterable() }.toByteArray()
    }
    fun rewritePlaylist(text: String, base: String, route: (String, Boolean) -> String): String {
        require(text.trimStart().startsWith("#EXTM3U")) { "HLS 재생목록 형식 오류" }
        val origin = base.toHttpUrlOrNull() ?: error("HLS 주소 오류")
        val uri = Regex("URI=\"([^\"]+)\"")
        return text.lineSequence().joinToString("\n") { line ->
            when {
                line.startsWith("#") -> uri.replace(line) { m ->
                    val remote = origin.resolve(m.groupValues[1]) ?: error("HLS 리소스 주소 오류")
                    "URI=\"${route(remote.toString(), line.startsWith("#EXT-X-KEY:") || line.startsWith("#EXT-X-SESSION-KEY:"))}\""
                }
                line.isBlank() -> line
                else -> route((origin.resolve(line.trim()) ?: error("HLS 조각 주소 오류")).toString(), false)
            }
        }
    }
}

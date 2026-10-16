package eu.kanade.tachiyomi.extension.ko.daeonaver

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONObject
import org.jsoup.Jsoup
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

internal data class NaverPath(val type: String, val titleId: String, val no: String?) {
    val list get() = "/$type/list?titleId=$titleId"
    val detail get() = "/$type/detail?titleId=$titleId&no=${no ?: error("회차 번호 누락") }"
}
internal data class NaverTitle(val path: String, val title: String, val image: String, val author: String, val description: String, val genres: String, val finished: Boolean, val rest: Boolean)
internal data class NaverChapter(val path: String, val no: Float, val name: String, val date: Long)
internal object NaverParsing {
    val types = arrayOf("webtoon", "bestChallenge", "challenge")
    val days = arrayOf("SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY")
    fun path(value: String, episode: Boolean = false): NaverPath {
        val url = "https://comic.naver.com".toHttpUrlOrNull()!!.resolve(value.replace("&amp;", "&")) ?: error("네이버 주소 오류")
        require(url.isHttps && url.host in listOf("comic.naver.com", "m.comic.naver.com") && url.port == 443 && url.username.isEmpty() && url.password.isEmpty()) { "네이버 주소 오류" }
        val type = url.pathSegments.getOrNull(0) ?: ""
        require(type in types && url.pathSegments.size == 2 && url.pathSegments[1] in listOf("list", "detail")) { "네이버 작품 주소 오류" }
        val id = url.queryParameter("titleId").orEmpty(); val no = url.queryParameter("no")
        require(id.matches(Regex("\\d+")) && (!episode || no?.matches(Regex("\\d+")) == true)) { "네이버 작품·회차 번호 오류" }
        return NaverPath(type, id, no)
    }
    fun title(j: JSONObject, type: String): NaverTitle {
        val authors = j.optJSONArray("communityArtists")?.objects()?.mapNotNull { it.optString("name").takeIf(String::isNotBlank) }.orEmpty()
        val genres = j.optJSONArray("curationTagList")?.objects()?.mapNotNull { it.optString("tagName").takeIf(String::isNotBlank) }.orEmpty()
        return NaverTitle("/$type/list?titleId=${j.get("titleId")}", j.optString("titleName"), j.optString("thumbnailUrl"),
            authors.joinToString(", ").ifBlank { j.optString("displayAuthor").ifBlank { j.optString("author") } }, j.optString("synopsis"), genres.joinToString(", "),
            j.optBoolean("finished") || j.optBoolean("finish"), j.optBoolean("rest"))
    }
    fun titles(a: JSONArray?, type: String) = a?.objects()?.filter { it.has("titleId") && !it.isNull("titleId") }?.map { title(it, type) }?.distinctBy { it.path }.orEmpty()
    fun chapters(j: JSONObject, p: NaverPath, now: Long = System.currentTimeMillis()): List<NaverChapter> = j.optJSONArray("articleList")?.objects()?.mapNotNull { a ->
        if (!a.has("no")) return@mapNotNull null
        val no = a.getInt("no")
        NaverChapter("/${p.type}/detail?titleId=${p.titleId}&no=$no", no.toFloat(), "$no - " + (if (a.optBoolean("thumbnailLock")) "🔒 " else "") + a.optString("subtitle"), date(a.optString("serviceDateDescription"), now))
    }.orEmpty()
    fun date(value: String, now: Long): Long {
        if (value.contains(':')) return now
        val m = Regex("^(\\d{4}|\\d{2})\\.(\\d{2})\\.(\\d{2})").find(value) ?: return 0
        val year = m.groupValues[1].let { if (it.length == 2) "20$it" else it }
        return runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).apply { isLenient = false; timeZone = TimeZone.getTimeZone("Asia/Seoul") }.parse("$year-${m.groupValues[2]}-${m.groupValues[3]}")!!.time }.getOrDefault(0)
    }
    fun releaseDay(now: Long = System.currentTimeMillis()): String {
        val c = Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul")).apply { timeInMillis = now }
        if (c.get(Calendar.HOUR_OF_DAY) >= 23) c.add(Calendar.DAY_OF_MONTH, 1)
        return days[c.get(Calendar.DAY_OF_WEEK) - 1]
    }
    fun pages(html: String, base: String): List<String> = Jsoup.parse(html, base).select(".wt_viewer img, #toonLayer img").mapNotNull { image ->
        val attr = if (image.attr("data-src").isNotBlank()) "data-src" else "src"
        val url = image.absUrl(attr).toHttpUrlOrNull() ?: return@mapNotNull null
        url.toString().takeUnless { url.encodedPath.contains("/static/agerate/") || url.encodedPath.contains("bg_transparency") }
    }.distinct()
    private fun JSONArray.objects() = (0 until length()).mapNotNull { optJSONObject(it) }
}

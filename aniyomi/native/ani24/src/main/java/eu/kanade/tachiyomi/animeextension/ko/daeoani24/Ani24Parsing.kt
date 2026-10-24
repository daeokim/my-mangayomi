package eu.kanade.tachiyomi.animeextension.ko.daeoani24

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import org.jsoup.Jsoup
import java.net.URLDecoder

internal data class AniCard(val path: String, val title: String, val image: String, val genres: String = "")
internal data class AniEpisode(val path: String, val name: String, val date: String)
internal object Ani24Parsing {
    fun path(value: String): String {
        val url = "https://ani.ohli24.com".toHttpUrl().resolve(value.trim()) ?: error("애니24 주소 오류")
        require(url.username.isEmpty() && url.password.isEmpty() && url.port == 443 && Regex("(?:www\\.|ani\\.)?ohli(?:\\d+)\\.(?:net|com)").matches(url.host)) { "애니24 주소 오류" }
        return url.encodedPath + (url.encodedQuery?.let { "?$it" } ?: "")
    }
    fun slug(path: String) = URLDecoder.decode(path.substringAfterLast('/').removeSuffix(".html").replace("+", "%2B"), "UTF-8").replace('-', ' ').trim()
    fun cards(html: String, base: String): List<AniCard> = Jsoup.parse(html, base).select(".show-item").mapNotNull { e ->
        val a = e.selectFirst("a.show-item-img-link[href], a.show-item-tile-link[href], a[href]") ?: return@mapNotNull null
        val p = runCatching { path(a.absUrl("href")) }.getOrNull() ?: return@mapNotNull null
        // The site publishes a few unescaped '?' characters in title slugs.
        // Retain their query tail just as the browser does; the numeric ID is stable.
        if (!Regex("/\\d+/[^/]+").matches(p.substringBefore('?'))) return@mapNotNull null
        val title = e.selectFirst(".show-item-title")?.text().orEmpty()
        val image = e.selectFirst(".show-item-img img, img")
        AniCard(p, title.takeUnless { it.isBlank() || it.endsWith("...") || it.endsWith("…") } ?: slug(p),
            image?.absUrl("data-src")?.ifBlank { image.absUrl("src") }.orEmpty(), e.select(".top-list-body-genre a").joinToString(", ") { it.text() })
    }.distinctBy { it.path }
    fun jsonp(body: String): String {
        val text = body.trim()
        val json = if (text.startsWith('{')) text else text.substringAfter('(', "").substringBeforeLast(')', "")
        return JSONObject(json).getString("msg")
    }
    fun hasNext(html: String, count: Int, api: Boolean): Boolean {
        val d = Jsoup.parse(html)
        val pagination = d.select(".page-numbers")
        return if (pagination.isNotEmpty()) d.select(".page-numbers a").any { it.text().trim() in listOf(">", "다음") } else api && count >= 25
    }
    fun episodes(html: String, base: String) = Jsoup.parse(html, base).select(".eps-box .eps-item a[href]").mapNotNull { a ->
        val p = runCatching { path(a.absUrl("href")) }.getOrNull() ?: return@mapNotNull null
        if (!Regex("/\\d+/[^/]+").matches(p.substringBefore('?'))) return@mapNotNull null
        val date = a.selectFirst(".eps-date")?.text().orEmpty()
        AniEpisode(p, a.text().replace(date, "").trim(), Regex("\\d{4}-\\d{2}-\\d{2}").find(date)?.value.orEmpty())
    }.distinctBy { it.path }
    fun searchTerms(query: String): List<String> {
        val q = query.trim().replace(Regex("\\s+"), " ")
        if (q.contains(' ') || q.length < 2) return listOf(q)
        val variants = mutableListOf(q)
        for (i in 1 until q.length) variants.add(q.take(i) + " " + q.drop(i))
        if (q.length <= 6) for (i in 1 until q.length - 1) for (j in i + 1 until q.length) variants.add(q.take(i) + " " + q.substring(i, j) + " " + q.drop(j))
        return variants.distinct().take(10)
    }
    fun normalized(value: String) = value.lowercase().replace(Regex("[\\s\\p{Punct}·ㆍ・]+"), "")
    /** Decode Dean Edwards' substitution table without evaluating JavaScript. */
    fun unpack(html: String): String {
        val packed = Regex("\\}\\s*\\('((?:\\\\.|[^'])*)',\\s*(\\d+),\\s*(\\d+),\\s*'((?:\\\\.|[^'])*)'\\.split\\('\\|'\\)")
        return packed.findAll(html).mapNotNull { m ->
            val radix = m.groupValues[2].toIntOrNull() ?: return@mapNotNull null
            if (radix !in 2..62) return@mapNotNull null
            val words = m.groupValues[4].split('|')
            if (words.size != m.groupValues[3].toIntOrNull()) return@mapNotNull null
            Regex("\\b\\w+\\b").replace(m.groupValues[1]) { token ->
                val chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
                var number = 0L
                for (c in token.value) { val digit = chars.indexOf(c); if (digit !in 0 until radix || number > Int.MAX_VALUE / radix) { number = -1; break }; number = number * radix + digit }
                words.getOrNull(number.toInt())?.takeIf { it.isNotBlank() } ?: token.value
            }.replace("\\'", "'").replace("\\/", "/")
        }.joinToString(" ").ifBlank { html }
    }
}

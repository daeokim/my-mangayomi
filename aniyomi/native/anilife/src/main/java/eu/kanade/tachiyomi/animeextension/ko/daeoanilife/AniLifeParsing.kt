package eu.kanade.tachiyomi.animeextension.ko.daeoanilife

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer

internal data class LifeItem(val id: String, val title: String, val image: String, val studio: String, val genres: String, val description: String, val status: String)
internal data class LifeEpisode(val path: String, val number: Float, val title: String)
internal object AniLifeParsing {
    fun item(j: JSONObject, base: String) = LifeItem(j.getString("id"), j.getString("title"),
        j.optString("image").takeUnless { it == "null" }.orEmpty().let { if (it.isBlank()) "" else base.toHttpUrl().resolve(it)?.toString().orEmpty() },
        j.optString("studio").takeUnless { it == "null" }.orEmpty(),
        j.optJSONArray("genres").strings().joinToString(", "), j.optString("description").takeUnless { it == "null" }.orEmpty(), j.optString("status"))
    fun list(body: String, base: String): Pair<List<LifeItem>, Boolean> {
        val j = JSONObject(body); val a = j.optJSONArray("items") ?: error("애니라이프 목록 응답 형식 오류")
        val p = j.optJSONObject("pagination")
        return (0 until a.length()).map { item(a.getJSONObject(it), base) }.distinctBy { it.id } to
            ((p?.optInt("page", 1) ?: 1) < (p?.optInt("pages", 1) ?: 1))
    }
    fun episodes(body: String): List<LifeEpisode> {
        val a = JSONObject(body).getJSONObject("item").optJSONArray("episodes") ?: return emptyList()
        return (0 until a.length()).map { a.getJSONObject(it) }.filter { it.optBoolean("playable") }
            .mapNotNull { j ->
                val path = j.optString("playbackUrl")
                if (!Regex("/api/playback/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+").matches(path)) return@mapNotNull null
                val number = j.optDouble("number", 0.0).toFloat()
                LifeEpisode(path, number, "${number.toString().removeSuffix(".0")}화" + j.optString("title").takeIf { it.isNotBlank() && it != "null" }?.let { " · $it" }.orEmpty())
            }.distinctBy { it.path }.sortedByDescending { it.number }
    }
    fun detailId(path: String): String {
        val id = path.substringBefore('?').trim('/').let { if (it.startsWith("content/")) it.split('/').getOrElse(1) { "" } else it }
        require(Regex("[A-Za-z0-9_-]+").matches(id)) { "애니라이프 작품 주소 오류" }
        return id
    }
    fun normalized(value: String) = Normalizer.normalize(value, Normalizer.Form.NFKC).lowercase().replace(Regex("\\s+"), "")
    fun searchTerms(value: String): List<String> {
        val full = Normalizer.normalize(value, Normalizer.Form.NFKC).trim().replace(Regex("\\s+"), " ")
        val compact = normalized(value)
        val width = if (compact.length < 6) 2 else 3
        return (listOf(full) + if (compact.length >= 3) compact.windowed(width) else emptyList()).distinct().take(10)
    }
    private fun JSONArray?.strings() = if (this == null) emptyList() else (0 until length()).map { getString(it) }
}

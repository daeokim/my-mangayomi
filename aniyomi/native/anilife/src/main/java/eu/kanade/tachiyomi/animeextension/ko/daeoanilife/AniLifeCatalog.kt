package eu.kanade.tachiyomi.animeextension.ko.daeoanilife

import okhttp3.HttpUrl.Companion.toHttpUrl

/** Native catalogue tabs describe catalogue-wide ranking, not today's airing schedule. */
internal object AniLifeCatalog {
    fun url(base: String, page: Int, sort: String = "latest", scope: String = "", query: String = "", genre: String = "", year: String = "", status: String = "", day: String = "") =
        base.toHttpUrl().newBuilder().addPathSegments("api/anime")
            .addQueryParameter("page", page.toString()).addQueryParameter("limit", "24").addQueryParameter("sort", sort)
            .apply {
                for ((name, value) in listOf("scope" to scope, "q" to query, "genre" to genre, "year" to year, "status" to status, "day" to day)) {
                    if (value.isNotBlank()) addQueryParameter(name, value)
                }
            }.addQueryParameter("v", "catalog-media-2").build()

    fun popular(base: String, page: Int) = url(base, page, sort = "popular")
    fun latest(base: String, page: Int) = url(base, page, scope = "updates")
}

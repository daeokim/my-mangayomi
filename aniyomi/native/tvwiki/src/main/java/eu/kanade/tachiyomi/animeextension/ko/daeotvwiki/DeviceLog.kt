package eu.kanade.tachiyomi.animeextension.ko.daeotvwiki

/**
 * Error-level lines with tag "DtoonExt" so Aniyomi's crash-log export carries them. Query values that look
 * like credentials (t, sig, token, expires, key) are cut, and bodies are reduced to a short text snippet.
 */
internal object DeviceLog {
    private val secret = Regex("([?&](?:t|sig|token|expires|key|session_data\\d?)=)[^&\\s\"]*", RegexOption.IGNORE_CASE)
    fun redact(value: String) = secret.replace(value) { it.groupValues[1] + "…" }
    fun snippet(body: String?): String {
        if (body.isNullOrEmpty()) return "(empty)"
        val title = Regex("<title[^>]*>([^<]{0,120})", RegexOption.IGNORE_CASE).find(body)?.groupValues?.get(1)?.trim()
        val text = body.replace(Regex("<script[\\s\\S]*?</script>|<style[\\s\\S]*?</style>", RegexOption.IGNORE_CASE), " ")
            .replace(Regex("<[^>]+>"), " ").replace(Regex("\\s+"), " ").trim().take(240)
        return redact((if (title.isNullOrBlank()) "" else "title=\"$title\" ") + text)
    }
    fun e(message: String) { runCatching { android.util.Log.e("DtoonExt", redact(message).take(1500)) } }
}

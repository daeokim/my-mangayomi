package daeo.extensions.common

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

data class MediaTrack(val url: String, val label: String)
data class MediaVariant(val url: String, val label: String, val bandwidth: Long)
data class MediaPlaylist(val variants: List<MediaVariant>, val subtitles: List<MediaTrack>, val audio: List<MediaTrack>) {
    companion object {
        private val attribute = Regex("([A-Z0-9-]+)=(?:\"([^\"]*)\"|([^,]*))")
        fun parse(body: String, base: String): MediaPlaylist {
            require(body.trimStart().startsWith("#EXTM3U")) { "HLS 재생목록이 아닙니다." }
            val url = base.toHttpUrlOrNull() ?: error("재생목록 주소 오류")
            fun resolve(value: String) = url.resolve(value)?.takeIf { it.scheme in listOf("http", "https") }?.toString()
            fun attrs(line: String) = attribute.findAll(line).associate { it.groupValues[1] to it.groupValues[2].ifEmpty { it.groupValues[3] } }
            val lines = body.lineSequence().map { it.trim() }.toList()
            val subs = mutableListOf<MediaTrack>(); val audio = mutableListOf<MediaTrack>(); val variants = mutableListOf<MediaVariant>()
            for ((index, line) in lines.withIndex()) {
                if (line.startsWith("#EXT-X-MEDIA:")) {
                    val a = attrs(line)
                    val track = a["URI"]?.let(::resolve)?.let { MediaTrack(it, a["NAME"] ?: a["LANGUAGE"] ?: "사이트 자막") } ?: continue
                    when (a["TYPE"]) { "SUBTITLES" -> subs.add(track); "AUDIO" -> audio.add(track) }
                }
                if (!line.startsWith("#EXT-X-STREAM-INF:")) continue
                val a = attrs(line)
                if (a["CODECS"]?.split(',')?.all { it.trim().startsWith("mp4a") } == true) continue
                val target = lines.drop(index + 1).firstOrNull { it.isNotEmpty() && !it.startsWith('#') }?.let(::resolve) ?: continue
                val height = a["RESOLUTION"]?.substringAfter('x')?.toIntOrNull()
                variants.add(MediaVariant(target, height?.let { "${it}p" } ?: "자동 (HLS)", a["BANDWIDTH"]?.toLongOrNull() ?: 0))
            }
            if (variants.isEmpty() && lines.none { it.startsWith("#EXT-X-STREAM-INF:") }) variants.add(MediaVariant(base, "자동 (HLS)", 0))
            require(variants.isNotEmpty()) { "사용 가능한 영상 트랙이 없습니다." }
            return MediaPlaylist(variants.distinctBy { it.url }.sortedByDescending { it.bandwidth }, subs.distinct(), audio.distinct())
        }
    }
}

package daeo.extensions.common

import org.junit.Assert.*
import org.junit.Test

class CommonTest {
    @Test fun registryRejectsForeignInsecureAndOlderAddresses() {
        val d = SiteDomain("anilife", "https://anilife01.tv", Regex("(?:www\\.)?anilife(\\d+)\\.tv"))
        fun json(url: String) = """{"domains":{"anilife":{"baseUrl":"$url"}}}"""
        assertEquals("https://anilife02.tv", d.candidate(json("https://anilife02.tv/")))
        for (url in listOf("https://anilife00.tv", "http://anilife02.tv", "https://anilife02.tv.evil.test", "https://user:password@anilife02.tv", "https://anilife02.tv:444", "https://anilife02.tv/path", "https://anilife02.tv/?q=1", "https://anilife02.tv/#x", "https://anilife1000000.tv")) assertNull(url, d.candidate(json(url)))
        assertEquals("https://anilife01.tv", d.current)
    }
    @Test fun ani24UsesTheWholeDomainNumber() {
        val d = SiteDomain("ani24", "https://www.ohli24.net", Regex("(?:www\\.)?ohli(\\d+)\\.net"))
        assertEquals("https://ohli25.net", d.candidate("""{"domains":{"ani24":{"baseUrl":"https://ohli25.net"}}}"""))
        assertNull(d.candidate("""{"domains":{"ani24":{"baseUrl":"https://ohli23.net"}}}"""))
    }
    @Test fun masterResolvesRelativeTracksAndExcludesAudioOnlyVariant() {
        val p = MediaPlaylist.parse("""#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="한국어, CC",LANGUAGE="ko",URI="../subs/ko.vtt"
#EXT-X-MEDIA:TYPE=AUDIO,NAME="일본어",URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1000,CODECS="mp4a.40.2"
audio.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080
/1080/index.m3u8
""", "https://cdn.test/media/master.m3u8")
        assertEquals(listOf("1080p", "720p"), p.variants.map { it.label })
        assertEquals("https://cdn.test/1080/index.m3u8", p.variants.first().url)
        assertEquals("https://cdn.test/subs/ko.vtt", p.subtitles.single().url)
        assertEquals("한국어, CC", p.subtitles.single().label)
        assertEquals(1, p.audio.size)
    }
    @Test fun mediaPlaylistKeepsOriginalUrl() {
        assertEquals("https://cdn.test/live.m3u8?token=x", MediaPlaylist.parse("#EXTM3U\n#EXTINF:10,\n1.ts", "https://cdn.test/live.m3u8?token=x").variants.single().url)
    }
    @Test fun htmlErrorIsNeverAPlayableVideo() {
        assertThrows(IllegalArgumentException::class.java) { MediaPlaylist.parse("<html>blocked</html>", "https://cdn.test/master.m3u8") }
    }
}

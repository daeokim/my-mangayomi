package eu.kanade.tachiyomi.animeextension.ko.daeotvwiki

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.Base64

class TvWikiKeyTest {
    private fun envelope(padding: Int): JSONObject {
        val data = JSONObject(String(javaClass.getResourceAsStream("/key-v7.json")!!.readBytes()))
        val final = data.getJSONArray("layers").getJSONObject(6)
        val encrypted = Base64.getUrlDecoder().decode(data.getString("encrypted_key"))
        val payload = encrypted.copyOf(encrypted.size - final.getInt("pad_len"))
        data.put("encrypted_key", Base64.getUrlEncoder().withoutPadding().encodeToString(payload + ByteArray(padding) { 23 }))
        final.put("pad_len", padding)
        return data
    }
    @Test fun zeroEnvelopePaddingPreservesTheReferenceKey() {
        assertArrayEquals(ByteArray(16) { it.toByte() }, TvWikiKey.decode(envelope(0)))
    }
    @Test fun envelopePaddingIsValidatedByPayloadLengthInsteadOfAnArbitraryCap() {
        for (padding in listOf(64, 127, 1024)) {
            assertArrayEquals("padding=$padding", ByteArray(16) { it.toByte() }, TvWikiKey.decode(envelope(padding)))
        }
    }
    @Test(expected = IllegalArgumentException::class) fun negativePaddingIsRejected() {
        val data = envelope(0)
        data.getJSONArray("layers").getJSONObject(6).put("pad_len", -1)
        TvWikiKey.decode(data)
    }
    @Test(expected = IllegalArgumentException::class) fun paddingMustAgreeWithDeclaredBlockLengths() {
        val data = envelope(64)
        data.getJSONArray("layers").getJSONObject(6).put("pad_len", 63)
        TvWikiKey.decode(data)
    }
    @Test(expected = IllegalArgumentException::class) fun paddingCannotConsumeThePayload() {
        val data = envelope(0)
        data.getJSONArray("layers").getJSONObject(6)
            .put("pad_len", Base64.getUrlDecoder().decode(data.getString("encrypted_key")).size)
        TvWikiKey.decode(data)
    }
}

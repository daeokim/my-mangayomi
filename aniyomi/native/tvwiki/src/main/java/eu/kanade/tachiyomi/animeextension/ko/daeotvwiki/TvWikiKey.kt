package eu.kanade.tachiyomi.animeextension.ko.daeotvwiki

import org.json.JSONObject
import okio.ByteString.Companion.decodeBase64

/** Decodes the site's version 7 key envelope entirely on the device. */
internal object TvWikiKey {
    private fun bytes(value: String) = value.decodeBase64()?.toByteArray() ?: error("영상 키 인코딩 오류")
    private fun ints(obj: JSONObject, field: String): List<Int> {
        val array = obj.getJSONArray(field)
        require(array.length() in 1..256) { "영상 키 배열 길이 오류" }
        return List(array.length()) { array.getInt(it) }
    }
    private fun permutation(values: List<Int>, size: Int) {
        require(values.size == size && values.toSet() == (0 until size).toSet()) { "영상 키 순열 오류" }
    }
    private fun xor(data: ByteArray, mask: ByteArray): ByteArray {
        require(mask.isNotEmpty()) { "영상 키 마스크 오류" }
        return ByteArray(data.size) { (data[it].toInt() xor mask[it % mask.size].toInt()).toByte() }
    }
    fun decode(data: JSONObject): ByteArray {
        require(data.optInt("version") == 7 && data.optInt("key_length") == 16) { "지원하지 않는 영상 키 버전" }
        val layers = data.getJSONArray("layers")
        require(layers.length() == 7 && data.optInt("total_layers") == 7) { "영상 키 단계 오류" }
        val names = listOf("bit_interleave", "sbox", "bit_rotate", "segment_noise", "xor_chain", "decoy_shuffle", "final_encrypt")
        val byName = (0 until layers.length()).map { layers.getJSONObject(it) }.associateBy { it.getString("name") }
        require(byName.keys == names.toSet()) { "영상 키 단계 이름 오류" }
        var encrypted = bytes(data.getString("encrypted_key"))
        require(encrypted.size in 17..65536)
        val decoy = byName.getValue("decoy_shuffle")
        val lengths = ints(decoy, "segment_lengths")
        require(lengths.all { it in 1..4096 }) { "영상 키 블록 길이 오류" }
        val final = byName.getValue("final_encrypt")
        val padding = final.getInt("pad_len")
        // This is envelope noise, not PKCS padding: validate it against the declared
        // payload size instead of assuming a fixed 1..63 range (including no noise).
        require(padding >= 0 && padding < encrypted.size &&
            encrypted.size - padding == lengths.sum()) { "영상 키 패딩 오류" }
        encrypted = xor(encrypted.copyOf(encrypted.size - padding), bytes(final.getString("xor_mask")))

        require(lengths.all { it in 1..4096 } && lengths.sum() == encrypted.size) { "영상 키 블록 길이 오류" }
        val positions = ints(decoy, "real_positions")
        require(positions.size == 16 && positions.toSet().size == 16 && positions.all { it in lengths.indices }) { "영상 키 블록 위치 오류" }
        val chunks = ArrayList<ByteArray>()
        var offset = 0
        for (length in lengths) {
            chunks.add(encrypted.copyOfRange(offset, offset + length)); offset += length
        }
        val selected = positions.map { chunks[it] }
        val initial = bytes(byName.getValue("xor_chain").getString("init_key"))
        val shuffled = ByteArray(16) { index ->
            val previous = if (index == 0) initial else selected[index - 1].take(4).toByteArray()
            xor(selected[index], previous)[0]
        }
        val segmentOrder = ints(byName.getValue("segment_noise"), "perm")
        permutation(segmentOrder, 16)
        val restored = ByteArray(16)
        segmentOrder.forEachIndexed { index, original -> restored[original] = shuffled[index] }
        val rotations = ints(byName.getValue("bit_rotate"), "rotations")
        require(rotations.all { it in 0..7 }) { "영상 키 비트 회전 오류" }
        val inverseSbox = bytes(byName.getValue("sbox").getString("inverse_sbox"))
        require(inverseSbox.size == 256 && inverseSbox.toSet().size == 256) { "영상 키 치환표 오류" }
        val substituted = ByteArray(16) { index ->
            val value = restored[index].toInt() and 255
            val shift = rotations[index % rotations.size]
            inverseSbox[((value ushr shift) or (value shl ((8 - shift) and 7))) and 255]
        }
        val bitOrder = ints(byName.getValue("bit_interleave"), "perm")
        permutation(bitOrder, 128)
        val result = ByteArray(16)
        bitOrder.forEachIndexed { index, original ->
            val bit = (substituted[index / 8].toInt() ushr (7 - index % 8)) and 1
            result[original / 8] = (result[original / 8].toInt() or (bit shl (7 - original % 8))).toByte()
        }
        return result
    }
}


const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const key = Buffer.from("0123456789abcdef");
const playlistUrl = "https://cdn.example.org/vod/main.m3u8?token=test";
const keyUrl = "https://cdn.example.org/keys/key.json";
const playerUrl = "https://player.example.org/watch/1";
const localRoot = "http://127.0.0.1:12345/test-session/playlist.m3u8?url=dGVzdA";
const manifest = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-KEY:METHOD=AES-128,URI="../keys/key.json",IV=0x00000000000000000000000000000001\n#EXTINF:4,\n../segments/one.ts?sig=x\n#EXT-X-ENDLIST\n';

function envelope() {
  return JSON.stringify({ encrypted_key: Buffer.concat([key.subarray(8), Buffer.from([99, 98]), key.subarray(0, 8), Buffer.from([97, 96])]).toString("base64"), rule: { noise_length: 2, segment_sizes: [8, 8], permutation: [1, 0], key_length: 16 } });
}
function load(site, extra = {}) {
  const preferences = new Map([[site + "_playback_route_v2", "auto"]]);
  const sandbox = {
    MProvider: class {},
    SharedPreferences: class {
      get(key) { return preferences.get(key); }
      getString(key, fallback) { return preferences.get(key) ?? fallback; }
      setString(key, value) { preferences.set(key, value); }
    },
    ...extra
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "javascript/anime", site + ".js"), "utf8") + "\nglobalThis.extension = new DefaultExtension();", sandbox);
  return { sandbox, extension: sandbox.extension, preferences };
}
function body(video) { return Buffer.from(video.url.split(",")[1].replace(/#.*$/, ""), "base64").toString("utf8"); }
function roomFixture(extra = {}) {
  const calls = [];
  const state = load("tvroom", {
    Document: class {
      selectFirst(selector) {
        return { attr: () => selector === "iframe#view_iframe[src]" ? playerUrl : playlistUrl };
      }
    },
    ...extra
  });
  state.extension._resolveBaseUrl = async () => "https://tvroom40.org";
  state.extension._requestText = async (url, referer, stage, headers) => {
    calls.push({ url, referer, stage, headers });
    return stage === "재생목록" ? manifest : stage === "영상 키" ? Buffer.from(envelope()).toString("base64") : "fixture";
  };
  return { ...state, calls };
}
function wikiFixture(extra = {}, keyEnvelope = envelope()) {
  const state = load("tvwiki", extra);
  state.extension._resolveBaseUrl = async () => "https://tvwiki54.net";
  state.extension._episodeData = async () => ({ session_data1: { test: true }, hls_url: playlistUrl });
  state.extension._createSession = async () => ({ player_url: playerUrl, t: "fixture", sig: "fixture" });
  state.extension._get = async (url, referer, stage) => stage === "再生" ? "" : stage === "재생목록" ? manifest : keyEnvelope;
  return state;
}

test("local HLS helpers remain identical in the two standalone sources", () => {
  for (const name of ["dcHlsBase64", "dcHlsBounded", "dcHlsPlaybackError", "dcHlsSingleFlight", "dcLocalHlsVideo"]) assert.equal(load("tvroom").sandbox[name].toString(), load("tvwiki").sandbox[name].toString());
});
test("inline HLS uses mpv's FFmpeg protocol while retaining the upstream download URL", async () => {
  for (const site of ["tvroom", "tvwiki"]) {
    const state = load(site, { createHlsProxyUrl: async () => localRoot });
    const absolute = site === "tvroom" ? state.extension._absoluteUrl.bind(state.extension) : state.extension._absolute.bind(state.extension);
    const video = await state.sandbox.dcLocalHlsVideo(playlistUrl, manifest, {}, absolute, keyUrl, "data:application/octet-stream;base64," + key.toString("base64"), playlistUrl, true);
    assert.ok(video.url.startsWith("lavf://data:application/vnd.apple.mpegurl;base64,"));
    assert.equal(video.originalUrl, playlistUrl);
    assert.ok(body(video).startsWith("#EXTM3U"));
    assert.ok(body(video).includes('URI="data:application/octet-stream;base64,'));
  }
});
test("TVRoom: local proxy is first, inline key is exact, and no external preparation is fetched", async () => {
  const native = [], state = roomFixture({ createHlsProxyUrl: async (url, headers) => { native.push({ url, headers }); return localRoot; } });
  const videos = await state.extension.getVideoList("/video/1/episode");
  assert.equal(videos[0].quality, "휴대폰 중계 (권장)");
  const text = body(videos[0]);
  assert.ok(text.includes('URI="data:application/octet-stream;base64,' + key.toString("base64") + '#key.mp4"'));
  assert.ok(text.includes("IV=0x00000000000000000000000000000001"));
  const segment = text.split("\n").find(line => line.startsWith("http://"));
  assert.equal(Buffer.from(new URL(segment).searchParams.get("url"), "base64url").toString(), "https://cdn.example.org/segments/one.ts?sig=x");
  assert.equal(native[0].url, playlistUrl);
  assert.equal(native[0].headers.Referer, playerUrl);
  assert.equal(native[0].headers.Origin, "https://player.example.org");
  assert.equal(state.calls.length, 4);
  assert.ok(state.calls.every(call => !call.url.includes("pages.dev")));
  assert.equal(videos.length, 3);
  assert.ok(videos[1].url.startsWith("https://dc-toki-mangayomi-media.pages.dev/api/tvroom-playlist"));
});
test("TVRoom: older app uses a direct CDN playlist with the locally decoded key", async () => {
  const videos = await roomFixture().extension.getVideoList("/video/1/episode");
  assert.equal(videos[0].quality, "직접 재생 (로컬 재생목록)");
  assert.ok(body(videos[0]).includes("https://cdn.example.org/segments/one.ts?sig=x"));
});
test("TVRoom: failing native proxy does not lose direct playback or recovery choices", async () => {
  const state = roomFixture({ createHlsProxyUrl: async () => { throw new Error("unavailable"); } });
  const videos = await state.extension.getVideoList("/video/1/episode");
  assert.equal(videos.length, 3);
  assert.equal(videos[0].quality, "직접 재생 (로컬 재생목록)");
});
test("TVRoom: external preference preserves the former URLs", async () => {
  const state = roomFixture({ createHlsProxyUrl: async () => { throw new Error("must not be called"); } });
  state.preferences.set("tvroom_playback_route_v2", "external");
  const videos = await state.extension.getVideoList("/video/1/episode");
  assert.equal(videos.length, 2);
  assert.ok(videos.every(video => video.url.startsWith("https://dc-toki-mangayomi-media.pages.dev/")));
});
test("TVWiki: a recognized key schema can be played locally without the external key service", async () => {
  const native = [], state = wikiFixture({ createHlsProxyUrl: async url => { native.push(url); return localRoot; } });
  const videos = await state.extension.getVideoList("/drama/1/1");
  assert.equal(videos[0].quality, "휴대폰 중계 (권장)");
  assert.deepEqual(native, [playlistUrl]);
  assert.ok(body(videos[0]).includes(key.toString("base64")));
});
test("TVWiki: an unknown key schema explicitly retains the external decoder through the local proxy", async () => {
  const native = [], state = wikiFixture({ createHlsProxyUrl: async url => { native.push(url); return localRoot; } }, '{"unknown":true}');
  state.extension._client = () => ({ get: async () => ({ statusCode: 200, body: manifest.replace('../keys/key.json', 'data:application/octet-stream;base64,' + key.toString('base64')).replace('../segments/one.ts?sig=x', 'https://cdn.example.org/segments/one.ts?sig=x') }) });
  const videos = await state.extension.getVideoList("/drama/1/1");
  assert.equal(videos[0].quality, "휴대폰 중계 (키 변환은 외부)");
  assert.ok(native[0].includes("/api/tvwiki-playlist.m3u8?m=f&"));
});
test("TVWiki: an unknown key schema on older apps retains both former recovery URLs", async () => {
  const videos = await wikiFixture({}, '{"unknown":true}').extension.getVideoList("/drama/1/1");
  assert.equal(videos.length, 2);
  assert.ok(videos.every(video => video.url.startsWith("https://")));
});
test("TVWiki: external mode opens compatibility playback without starting the local proxy", async () => {
  const state = wikiFixture({ createHlsProxyUrl: async () => { throw new Error("external mode must bypass the local proxy"); } }, '{"unknown":true}');
  state.preferences.set("tvwiki_playback_route_v2", "external");
  state.extension._client = () => { throw new Error("external mode must not prefetch a rewritten manifest"); };
  const videos = await state.extension.getVideoList("/drama/1/1");
  assert.equal(videos.length, 2);
  assert.equal(videos[0].quality, "외부 호환 재생 (복구)");
  assert.equal(new URL(videos[0].url).searchParams.get("m"), "p");
  assert.equal(new URL(videos[1].url).searchParams.get("m"), "f");
  assert.equal(videos[0].originalUrl, playlistUrl);
  assert.ok(videos[0].headers.Referer.startsWith(playerUrl));
});
test("TVWiki: direct session success avoids the external session server", async () => {
  const state = load("tvwiki"), calls = [];
  state.extension._client = (kind, timeout) => ({ kind, timeout });
  state.extension._directSession = async client => { calls.push("direct:" + client.kind + ":" + client.timeout); return { test: true }; };
  state.extension._bridgeSession = async () => { throw new Error("external must not be called"); };
  await state.extension._createSession("https://tvwiki54.net", "/drama/1/1", [{ test: true }]);
  assert.deepEqual(calls, ["direct:dart:8"]);
});
test("TVWiki: external session is attempted only after both direct transports fail", async () => {
  const state = load("tvwiki"), calls = [];
  state.extension._client = (kind, timeout) => ({ kind, timeout });
  state.extension._directSession = async client => { calls.push("direct:" + client.kind); throw new Error("blocked"); };
  state.extension._bridgeSession = async client => { calls.push("external:" + client.kind + ":" + client.timeout); return {}; };
  await state.extension._createSession("https://tvwiki54.net", "/drama/1/1", [{ test: true }]);
  assert.deepEqual(calls, ["direct:dart", "direct:rhttp", "external:dart:6"]);
});
test("inline HLS rejects live, master, oversized and rotating-key manifests", async () => {
  const state = load("tvroom"), local = state.sandbox.dcLocalHlsVideo;
  const args = [playlistUrl, manifest, {}, state.extension._absoluteUrl.bind(state.extension), keyUrl, "data:application/octet-stream;base64," + key.toString("base64")];
  for (const invalid of [manifest.replace("#EXT-X-ENDLIST", ""), manifest.replace("#EXT-X-VERSION:3", "#EXT-X-STREAM-INF:BANDWIDTH=1000"), manifest + "x".repeat(1024 * 1024), manifest.replace("#EXT-X-ENDLIST", '#EXT-X-KEY:METHOD=AES-128,URI="other.key"\n#EXT-X-ENDLIST')]) {
    await assert.rejects(local(...[args[0], invalid, ...args.slice(2)]));
  }
});
test("inline HLS preserves fMP4 map and byte ranges while proxying media requests", async () => {
  const state = load("tvroom", { createHlsProxyUrl: async () => localRoot });
  const input = '#EXTM3U\n#EXT-X-MAP:URI="init.html",BYTERANGE="100@0"\n#EXT-X-BYTERANGE:50@100\n#EXTINF:4,\nchunk.html\n#EXT-X-ENDLIST\n';
  const result = await state.sandbox.dcLocalHlsVideo(playlistUrl, input, {}, state.extension._absoluteUrl.bind(state.extension));
  assert.equal((body(result).match(/segment\.mp4\?url=/g) || []).length, 2);
  assert.ok(body(result).includes('BYTERANGE="100@0"'));
  assert.ok(body(result).includes("#EXT-X-BYTERANGE:50@100"));
});
test("local proxy URL contract changes fall back to direct CDN references", async () => {
  const state = roomFixture({ createHlsProxyUrl: async () => "https://unexpected.example/playlist.m3u8" });
  const videos = await state.extension.getVideoList("/video/1/episode");
  assert.equal(videos[0].quality, "직접 재생 (로컬 재생목록)");
  assert.ok(!body(videos[0]).includes("unexpected.example"));
});
test("UTF-8 manifest encoding preserves non-ASCII text", () => {
  assert.equal(Buffer.from(load("tvroom").sandbox.dcHlsBase64("한글 영상", false), "base64").toString("utf8"), "한글 영상");
});

test("playback deadline rejects stalled work and leaves completed work intact", async () => {
  const state = load("tvroom", { setTimeout, clearTimeout });
  await assert.rejects(state.sandbox.dcHlsBounded(new Promise(() => {}), 5), /TIMEOUT/);
  assert.equal(await state.sandbox.dcHlsBounded(Promise.resolve("ready"), 5), "ready");
});
test("TVWiki: failure to prepare an unknown external key retains the former recovery options", async () => {
  const state = wikiFixture({ createHlsProxyUrl: async () => localRoot }, '{"unknown":true}');
  state.extension._client = () => ({ get: async () => ({ statusCode: 503, body: "not ready" }) });
  const videos = await state.extension.getVideoList("/drama/1/1");
  assert.equal(videos.length, 2);
  assert.ok(videos.every(video => video.url.startsWith("https://")));
});

test("encrypted synthetic VOD decodes with local key, proxy and required upstream headers", {
  skip: spawnSync("ffmpeg", ["-version"]).error?.code === "ENOENT"
}, () => {
  const result = spawnSync("python3", [path.join(__dirname, "local_hls_playback.py")], { encoding: "utf8", timeout: 45000 });
  assert.equal(result.status, 0, result.stderr || String(result.error || ""));
  const report = JSON.parse(result.stdout);
  assert.equal(report.decoded_frames, 20);
  assert.equal(report.local_proxy_segment_requests, 4);
  assert.equal(report.cdn_segment_requests, 4);
  assert.equal(report.external_key_requests, 0);
  assert.equal(report.original_headers_required, true);
});

test("0.9.9 default TVRoom route requires the local proxy and returns only that route", async () => {
  const state = roomFixture({ createHlsProxyUrl: async () => localRoot });
  state.preferences.delete("tvroom_playback_route_v2");
  assert.equal(state.extension._playbackRoute(), "device");
  state.extension._playlistBridgeUrl = () => { throw new Error("must not construct external URLs"); };
  const videos = await state.extension.getVideoList("/video/1/episode");
  assert.equal(videos.length, 1);
  assert.equal(videos[0].quality, "휴대폰 중계 (권장)");
  assert.ok(body(videos[0]).includes("http://127.0.0.1:12345/test-session/segment.ts"));
});
test("0.9.9 default TVRoom route reports a missing API instead of silently using direct CDN", async () => {
  const state = roomFixture();
  state.preferences.delete("tvroom_playback_route_v2");
  await assert.rejects(state.extension.getVideoList("/video/1/episode"), /휴대폰 중계 준비 실패.*0.9.9.*자동 \(복구 허용\)/);
});
test("0.9.9 default TVWiki route reports native startup failure without using the external decoder", async () => {
  const state = wikiFixture({ createHlsProxyUrl: async () => { throw new Error("fixture startup failure"); } });
  state.preferences.delete("tvwiki_playback_route_v2");
  state.extension._client = () => { throw new Error("must not use external decoder"); };
  await assert.rejects(state.extension.getVideoList("/drama/1/1"), /휴대폰 중계 준비 실패: fixture startup failure/);
});
test("0.9.9 default TVWiki route keeps its native decoder dependency label", async () => {
  const state = wikiFixture({ createHlsProxyUrl: async () => localRoot }, '{"unknown":true}');
  state.preferences.delete("tvwiki_playback_route_v2");
  state.extension._client = () => ({ get: async () => ({ statusCode: 200, body: manifest.replace('../keys/key.json', 'data:application/octet-stream;base64,' + key.toString('base64')).replace('../segments/one.ts?sig=x', 'https://cdn.example.org/segments/one.ts?sig=x') }) });
  const videos = await state.extension.getVideoList("/drama/1/1");
  assert.equal(videos.length, 1);
  assert.equal(videos[0].quality, "휴대폰 중계 (키 변환은 외부)");
});
test("concurrent requests for the same episode share preparation and the native session", async () => {
  let nativeCalls = 0;
  const state = roomFixture({ createHlsProxyUrl: async () => { nativeCalls++; return localRoot; } });
  state.preferences.delete("tvroom_playback_route_v2");
  const one = state.extension.getVideoList("/video/1/episode"), two = state.extension.getVideoList("/video/1/episode");
  assert.equal(one, two);
  const [a, b] = await Promise.all([one, two]);
  assert.equal(a, b);
  assert.equal(nativeCalls, 1);
  assert.equal(state.calls.length, 4);
});
test("failed playback preparation is removed so a repaired proxy can retry", async () => {
  let working = false;
  const state = roomFixture({ createHlsProxyUrl: async () => { if (!working) throw new Error("startup failure"); return localRoot; } });
  state.preferences.delete("tvroom_playback_route_v2");
  await assert.rejects(state.extension.getVideoList("/video/1/episode"), /startup failure/);
  working = true;
  const videos = await state.extension.getVideoList("/video/1/episode");
  assert.equal(videos[0].quality, "휴대폰 중계 (권장)");
  assert.equal(state.calls.length, 8);
});
test("current preferences make device mode the explicit default for both sources", () => {
  for (const site of ["tvroom", "tvwiki"]) {
    const state = load(site);
    state.preferences.delete(site + "_playback_route_v2");
    const preference = state.extension.getSourcePreferences().find(p => p.key === site + "_playback_route_v2");
    assert.equal(preference.listPreference.valueIndex, 0);
    assert.equal(preference.listPreference.entryValues[0], "device");
    assert.equal(state.extension._playbackRoute(), "device");
  }
});

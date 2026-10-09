const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const catalogs = ["index.json", "anime_index.json"].map(function(file) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  return { file, text, entries: JSON.parse(text) };
});

function sourcePath(entry) {
  const url = new URL(entry.sourceCodeUrl);
  assert.equal(url.origin, "https://daeokim.github.io");
  assert.ok(url.pathname.startsWith("/my-mangayomi/javascript/"));
  return path.join(root, url.pathname.slice("/my-mangayomi/".length));
}

function loadExtension(entry, overrides) {
  const preferences = new Map();
  let requests = 0;
  let response = null;
  const sandbox = {
    MProvider: class {},
    SharedPreferences: class {
      get(key) { return preferences.get(key); }
      getString(key, fallback) { return preferences.get(key) ?? fallback; }
      setString(key, value) { preferences.set(key, value); }
    },
    Client: class {
      async get() { return request(); }
    }
  };
  async function request() {
    requests++;
    if (!response) throw new Error("Mock network failure");
    return { statusCode: 200, body: JSON.stringify(response) };
  }
  if (overrides) Object.assign(sandbox, overrides);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(sourcePath(entry), "utf8") +
    "\nglobalThis.extension = new DefaultExtension(); globalThis.metadata = mangayomiSources[0];", sandbox);
  const extension = sandbox.extension;
  extension.source = { baseUrl: entry.baseUrl };
  if (entry.name === "티비위키") {
    extension._get = async function() { return (await request()).body; };
  }
  return {
    extension,
    metadata: sandbox.metadata,
    preferences,
    requests: function() { return requests; },
    respond: function(value) { response = value; }
  };
}

test("catalogs have unique exact IDs and valid source metadata", function() {
  const ids = new Set();
  for (const catalog of catalogs) {
    assert.ok(Array.isArray(catalog.entries));
    // Preserve IDs as decimal strings: the two manga IDs exceed JS safe integers.
    const exactIds = [...catalog.text.matchAll(/"id"\s*:\s*(\d+)/g)].map(function(match) { return match[1]; });
    assert.equal(exactIds.length, catalog.entries.length);
    for (const id of exactIds) {
      assert.ok(!ids.has(id), "duplicate ID: " + id);
      ids.add(id);
    }
    for (const entry of catalog.entries) {
      const loaded = loadExtension(entry);
      assert.equal(entry.itemType, catalog.file === "index.json" ? 0 : 1);
      assert.equal(entry.isManga, catalog.file === "index.json");
      assert.equal(entry.sourceCodeLanguage, 1);
      for (const key of ["name", "baseUrl", "version", "iconUrl"]) {
        assert.equal(loaded.metadata[key], entry[key], entry.name + ": " + key);
      }
      for (const method of ["getPopular", "getLatestUpdates", "search", "getDetail", entry.isManga ? "getPageList" : "getVideoList"]) {
        assert.equal(typeof loaded.extension[method], "function", entry.name + ": " + method);
      }
      assert.ok(!/^https?:\/\/(?:localhost|127\.0\.0\.1)/.test(loaded.metadata.iconUrl));
    }
  }
});

// Archived source stays testable after removal from the active catalogue.
const tvroom = {"name": "티비룸", "id": 780920260911801, "baseUrl": "https://tvroom38.org", "lang": "ko", "typeSource": "single", "iconUrl": "https://dc-toki-mangayomi-media.pages.dev/icon/ko.media.png", "dateFormat": "", "dateFormatLocale": "", "isNsfw": false, "hasCloudflare": false, "apiUrl": "", "version": "0.1.25", "isManga": false, "itemType": 1, "isFullData": false, "appMinVerReq": "0.9.2", "additionalParams": "", "sourceCodeLanguage": 1, "sourceCodeUrl": "https://daeokim.github.io/my-mangayomi/javascript/anime/tvroom.js", "notes": ""};

const media = [
  { name: "티비룸", key: "tvroom_domain_url", signal: "tvroom", prefix: "tvroom", suffix: "org" },
  { name: "티비위키", key: "tvwiki_domain_url", signal: "tvwiki", prefix: "tvwiki", suffix: "net" }
];
for (const spec of media) {
  const entry = catalogs[1].entries.find(function(value) { return value.name === spec.name; }) || (spec.name === "티비룸" ? tvroom : undefined);
  function domain(number) { return "https://" + spec.prefix + number + "." + spec.suffix; }

  test(spec.name + ": configured URL is used when central lookup fails", async function() {
    const loaded = loadExtension(entry);
    loaded.extension.source.baseUrl = domain(999) + "/";
    assert.equal(await loaded.extension._resolveBaseUrl(), domain(999));
    assert.equal(loaded.requests(), 1);
  });

  test(spec.name + ": constructor fallback matches catalog URL", function() {
    assert.equal(loadExtension(entry).extension.fallbackBaseUrl, entry.baseUrl);
  });

  test(spec.name + ": manual URL remains highest priority", async function() {
    const loaded = loadExtension(entry);
    loaded.preferences.set(spec.key, domain(998) + "/");
    assert.equal(await loaded.extension._resolveBaseUrl(), domain(998));
    assert.equal(loaded.requests(), 0);
  });

  test(spec.name + ": central URL remains ahead of configured fallback", async function() {
    const loaded = loadExtension(entry);
    loaded.respond({ domains: { [spec.signal]: { baseUrl: domain(997) } } });
    assert.equal(await loaded.extension._resolveBaseUrl(), domain(997));
  });

  test(spec.name + ": invalid central and configured URLs are rejected", async function() {
    const loaded = loadExtension(entry);
    loaded.preferences.set(spec.key, "https://example.com");
    loaded.respond({ domains: { [spec.signal]: { baseUrl: "https://example.com" } } });
    loaded.extension.source.baseUrl = "https://example.com";
    assert.equal(await loaded.extension._resolveBaseUrl(), entry.baseUrl);
  });

  test(spec.name + ": missing source configuration uses current fallback", async function() {
    const loaded = loadExtension(entry);
    delete loaded.extension.source;
    assert.equal(await loaded.extension._resolveBaseUrl(), entry.baseUrl);
  });
}

test("티비위키: fresh cached URL avoids central request", async function() {
  const entry = catalogs[1].entries.find(function(value) { return value.name === "티비위키"; });
  const loaded = loadExtension(entry);
  loaded.preferences.set(loaded.extension.cachedBaseKey, "https://tvwiki996.net");
  loaded.preferences.set(loaded.extension.cachedBaseTimeKey, String(Date.now()));
  assert.equal(await loaded.extension._resolveBaseUrl(), "https://tvwiki996.net");
  assert.equal(loaded.requests(), 0);
});

test("티비위키: expired cache remains a fallback if central request fails", async function() {
  const entry = catalogs[1].entries.find(function(value) { return value.name === "티비위키"; });
  const loaded = loadExtension(entry);
  loaded.preferences.set(loaded.extension.cachedBaseKey, "https://tvwiki995.net");
  loaded.preferences.set(loaded.extension.cachedBaseTimeKey, "1");
  assert.equal(await loaded.extension._resolveBaseUrl(), "https://tvwiki995.net");
  assert.equal(loaded.requests(), 1);
});

test("README lists the current catalog versions and URLs", function() {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.ok(readme.startsWith("# my-mangayomi\n") || readme.startsWith("# my-mangayomi\r\n"));
  for (const catalog of catalogs) {
    for (const entry of catalog.entries) {
      assert.ok(readme.includes("| " + entry.name + " | " + entry.version + " | " + entry.baseUrl + " | " + entry.appMinVerReq + " |"), entry.name);
    }
  }
});

const toon11 = catalogs[0].entries.find(function(entry) { return entry.name === "11toon 만화"; });
const goodtoon = catalogs[0].entries.find(function(entry) { return entry.name === "굿툰"; });
const tvwiki = catalogs[1].entries.find(function(entry) { return entry.name === "티비위키"; });

test("Goodtoon: stale 006 central signal does not undo the 007 migration", async function() {
  const loaded = loadExtension(goodtoon);
  loaded.respond({ domains: { goodtoon: { baseUrl: "https://www.goodtoon006.com/" } } });
  assert.equal(await loaded.extension._resolveBaseUrl(), "https://goodtoon007.com");
});

test("Goodtoon: future central domain updates remain enabled", async function() {
  const loaded = loadExtension(goodtoon);
  loaded.respond({ domains: { goodtoon: { baseUrl: "https://goodtoon008.com" } } });
  assert.equal(await loaded.extension._resolveBaseUrl(), "https://goodtoon008.com");
});

test("티비위키: old saved domain cache is ignored after the 52 migration", async function() {
  const loaded = loadExtension(tvwiki);
  loaded.preferences.set("tvwiki_last_base_url", "https://tvwiki51.net");
  loaded.preferences.set("tvwiki_last_base_time", String(Date.now()));
  assert.equal(await loaded.extension._resolveBaseUrl(), tvwiki.baseUrl);
  assert.equal(loaded.requests(), 1);
});

test("티비위키: stale 51 central signal does not undo the 52 migration", async function() {
  const loaded = loadExtension(tvwiki);
  loaded.respond({ domains: { tvwiki: { baseUrl: "https://tvwiki51.net" } } });
  assert.equal(await loaded.extension._resolveBaseUrl(), tvwiki.baseUrl);
});

test("티비위키: first-page markup mismatch is diagnosed with the actual URL", function() {
  const extension = loadExtension(tvwiki).extension;
  assert.throws(function() {
    extension._assertListPage("<html><h1>Changed layout</h1></html>", [], tvwiki.baseUrl + "/drama?page=1", "목록", 1);
  }, /NO_CARDS.*tvwiki52\.net\/drama\?page=1/);
});

test("티비위키: empty search and final pagination pages remain valid", function() {
  const extension = loadExtension(tvwiki).extension;
  for (const html of ["<p>게시물이 없습니다.</p>", "<p>검색 결과가 없습니다.</p>", "<p>등록된 영상이 없습니다.</p>"]) {
    assert.doesNotThrow(function() { extension._assertListPage(html, [], tvwiki.baseUrl, "검색", 1); });
  }
  assert.doesNotThrow(function() { extension._assertListPage("<html></html>", [], tvwiki.baseUrl, "목록", 2); });
});

test("티비위키: homepage guide cards cannot conceal a missing real list", async function() {
  const loaded = loadExtension(tvwiki, { Document: class { selectFirst() { return null; } } });
  loaded.extension._resolveBaseUrl = async function() { return tvwiki.baseUrl; };
  loaded.extension._get = async function() { return "<html>Changed layout</html>"; };
  loaded.extension._remoteTabCard = async function() { return { name: "Guide", link: "/__tvwiki_card__/remote-test" }; };
  await assert.rejects(loaded.extension.getPopular(1), /홈 인기 NO_CARDS/);
});

test("티비위키: HTTP 200 challenge responses are not passed to the list parser", async function() {
  const loaded = transportExtension(tvwiki, [
    { statusCode: 200, body: "<title>Just a moment...</title>" },
    { statusCode: 200, body: '<script src="/cdn-cgi/challenge-platform/test"></script>' }
  ]);
  loaded.extension._get = Object.getPrototypeOf(loaded.extension)._get;
  await assert.rejects(loaded.extension._get(tvwiki.baseUrl + "/drama", tvwiki.baseUrl + "/", "목록"), /DART CHALLENGE.*RHTTP CHALLENGE/);
  assert.equal(loaded.calls.length, 2);
});

test("티비위키: second transport can recover from a challenge response", async function() {
  const loaded = transportExtension(tvwiki, [
    { statusCode: 200, body: "<title>Just a moment...</title>" },
    { statusCode: 200, body: "<html>Real list</html>" }
  ]);
  loaded.extension._get = Object.getPrototypeOf(loaded.extension)._get;
  assert.equal(await loaded.extension._get(tvwiki.baseUrl, tvwiki.baseUrl + "/", "목록"), "<html>Real list</html>");
  assert.equal(loaded.calls.length, 2);
});

const chapter11 = "https://www.11toon144.com/bbs/board.php?bo_table=toons&wr_id=12&is=34";

for (const spec of [
  { entry: toon11, key: "toon11_domain_url", base: "https://www.11toon144.com" },
  { entry: goodtoon, key: "goodtoon_domain_url", base: "https://www.goodtoon006.com" }
]) {
  test(spec.entry.name + ": manual mirror URL avoids central lookup", async function() {
    const loaded = loadExtension(spec.entry);
    loaded.preferences.set(spec.key, spec.base + "/");
    assert.equal(await loaded.extension._resolveBaseUrl(), spec.base);
    assert.equal(loaded.requests(), 0);
  });

  test(spec.entry.name + ": invalid manual URL is explained instead of silently ignored", async function() {
    const loaded = loadExtension(spec.entry);
    loaded.preferences.set(spec.key, "https://example.com");
    await assert.rejects(loaded.extension._resolveBaseUrl(), /수동 주소 형식.*입력란을 비우세요/);
    assert.equal(loaded.requests(), 0);
  });
}

test("11toon: viewer images follow chapter origin while external CDN and headers are preserved", async function() {
  const extension = loadExtension(toon11).extension;
  extension._getText = async function() {
    return 'img_list = ["/images/a.jpg", "https://11toon.com/images/b.jpg", "https://cdn.example.org/c.jpg", "/images/a.jpg"];';
  };
  const pages = await extension._directPages(chapter11);
  assert.deepEqual(Array.from(pages, function(page) { return page.url; }), [
    "https://www.11toon144.com/images/a.jpg",
    "https://www.11toon144.com/images/b.jpg",
    "https://cdn.example.org/c.jpg"
  ]);
  for (const page of pages) {
    assert.equal(page.headers.Referer, chapter11);
    assert.equal(page.headers["User-Agent"], extension.userAgent);
  }
});

test("11toon: image probes also follow chapter origin", async function() {
  const extension = loadExtension(toon11).extension;
  const probed = [];
  extension._probeImage = async function(url, referer) { probed.push({ url, referer }); return true; };
  await extension._probeImageIndexes([
    "/images/a.jpg", "https://11toon.com/images/b.jpg", "https://cdn.example.org/c.jpg"
  ], [0, 1, 2], chapter11, 2);
  assert.deepEqual(probed.map(function(row) { return row.url; }), [
    "https://www.11toon144.com/images/a.jpg",
    "https://www.11toon144.com/images/b.jpg",
    "https://cdn.example.org/c.jpg"
  ]);
  assert.ok(probed.every(function(row) { return row.referer === chapter11; }));
});

test("11toon: fallback image mirror uses the chapter origin", async function() {
  const extension = loadExtension(toon11).extension;
  extension._getText = async function() { return 'img_list = ["/primary/a.jpg"]; img_list_2 = ["/backup/a.jpg"];'; };
  extension._probeImage = async function(url) { return url === "https://www.11toon144.com/backup/a.jpg"; };
  const pages = await extension._directPages(chapter11);
  assert.equal(pages[0].url, "https://www.11toon144.com/backup/a.jpg");
});

function transportExtension(entry, outcomes) {
  const calls = [];
  const loaded = loadExtension(entry, {
    Client: class {
      constructor(options) { this.options = options; }
      async get(url, headers) {
        calls.push({ url, headers, options: this.options });
        const outcome = outcomes[calls.length - 1];
        assert.ok(outcome, "unexpected extra request");
        if (outcome instanceof Error) throw outcome;
        return outcome;
      }
    }
  });
  return { extension: loaded.extension, calls };
}

test("11toon: mixed image mirrors preserve chapter domain and page order", async function() {
  const extension = loadExtension(toon11).extension;
  extension._getText = async function() {
    return 'img_list = ["/primary/a.jpg", "/primary/b.jpg", "/primary/c.jpg"]; img_list_2 = ["/backup/a.jpg", "/backup/b.jpg", "/backup/c.jpg"];';
  };
  extension._probeImage = async function(url) {
    return url === "https://www.11toon144.com/primary/a.jpg" ||
      url === "https://www.11toon144.com/backup/b.jpg" ||
      url === "https://www.11toon144.com/primary/c.jpg";
  };
  const pages = await extension._directPages(chapter11);
  assert.deepEqual(Array.from(pages, function(page) { return page.url; }), [
    "https://www.11toon144.com/primary/a.jpg", "https://www.11toon144.com/backup/b.jpg",
    "https://www.11toon144.com/primary/c.jpg"
  ]);
});

test("Goodtoon: HTTP 200 challenge is rejected by both transports", async function() {
  const loaded = transportExtension(goodtoon, [
    { statusCode: 200, body: "<title>Just a moment...</title>" },
    { statusCode: 200, body: '<script src="/cdn-cgi/challenge-platform/test"></script>' }
  ]);
  await assert.rejects(loaded.extension._getText("https://goodtoon005.com/manga/test/1/", null, "뷰어"), function(error) {
    return /RHTTP=CHALLENGE,DART=CHALLENGE/.test(error.message) && !/Rabbit/.test(error.message);
  });
  assert.equal(loaded.calls.length, 2);
});

test("Goodtoon: Dart success after RHTTP reset preserves viewer headers", async function() {
  const loaded = transportExtension(goodtoon, [new Error("ConnectionReset"), { statusCode: 200, body: "viewer HTML" }]);
  const chapter = "https://goodtoon005.com/manga/test/1/";
  assert.equal(await loaded.extension._getText(chapter, { Referer: chapter }, "뷰어"), "viewer HTML");
  assert.equal(loaded.calls.length, 2);
  assert.equal(loaded.calls[1].options.useDartHttpClient, true);
  assert.equal(loaded.calls[1].headers.Referer, chapter);
});

test("Goodtoon: successful RHTTP body does not trigger a second request", async function() {
  const loaded = transportExtension(goodtoon, [{ statusCode: 200, body: "viewer HTML" }]);
  assert.equal(await loaded.extension._getText("https://goodtoon005.com/"), "viewer HTML");
  assert.equal(loaded.calls.length, 1);
});

test("Goodtoon: reset diagnostics distinguish connection failure from missing images", async function() {
  const loaded = transportExtension(goodtoon, [new Error("ConnectionReset"), new Error("ECONNRESET")]);
  await assert.rejects(loaded.extension._getText("https://goodtoon005.com/", null, "뷰어"), /RHTTP=RESET,DART=RESET/);
});

test("Goodtoon: HTTP 403 is reported without retrying another transport", async function() {
  const loaded = transportExtension(goodtoon, [{ statusCode: 403, body: "Forbidden" }]);
  await assert.rejects(loaded.extension._getText("https://goodtoon005.com/", null, "뷰어"), /RHTTP=HTTP403/);
  assert.equal(loaded.calls.length, 1);
});

function viewerExtension(images) {
  const loaded = loadExtension(goodtoon, {
    // Mock only the app DOM interface, not a real HTML parser or site response.
    Document: class {
      select(selector) {
        assert.equal(selector, ".reading-content img, div.page-break img");
        return images.map(function(attrs) { return { attr: function(name) { return attrs[name] || ""; } }; });
      }
    }
  });
  loaded.extension._getText = async function() { return "synthetic viewer"; };
  return loaded.extension;
}

test("Goodtoon: lazy images retain current domain, CDN, order, deduplication and Referer", async function() {
  const extension = viewerExtension([
    { "data-src": "/images/a.jpg", src: "/dflazy.jpg" },
    { "data-src": "/dflazy.jpg", "data-lazy-src": "https://cdn.example.org/b.jpg" },
    { "data-original": "https://goodtoon005.com/images/c.jpg" },
    { src: "//cdn.example.org/d.jpg" },
    { src: "/images/a.jpg" },
    { src: "/dflazy.jpg" }
  ]);
  const chapter = "https://www.goodtoon006.com/manga/test/1/";
  const pages = await extension._directPages(chapter, "https://www.goodtoon006.com");
  assert.deepEqual(Array.from(pages, function(page) { return page.url; }), [
    "https://www.goodtoon006.com/images/a.jpg", "https://cdn.example.org/b.jpg",
    "https://www.goodtoon006.com/images/c.jpg", "https://cdn.example.org/d.jpg"
  ]);
  assert.ok(pages.every(function(page) { return page.headers.Referer === chapter; }));
});

test("Goodtoon: empty viewer reports NO_IMAGES without prescribing Rabbit", async function() {
  const extension = viewerExtension([]);
  await assert.rejects(extension._directPages("https://goodtoon005.com/manga/test/1/", "https://goodtoon005.com"), function(error) {
    return /NO_IMAGES/.test(error.message) && /웹뷰/.test(error.message) && !/Rabbit/.test(error.message);
  });
});

test("Goodtoon: Rabbit manifest rejects missing image headers and keeps valid pages", function() {
  const extension = loadExtension(goodtoon).extension;
  const chapter = "https://goodtoon005.com/manga/test/1/";
  const manifest = {
    id: "test-job", chapterUrl: chapter, expected: 1, referer: chapter, userAgent: "test UA",
    pages: [{ page: 1, urls: ["https://cdn.example.org/a.jpg"] }]
  };
  for (const key of ["referer", "userAgent"]) {
    assert.throws(function() { extension._manifestPages({ ...manifest, [key]: " " }, "test-job", chapter); }, /헤더가 불완전/);
  }
  const pages = extension._manifestPages(manifest, "test-job", chapter);
  assert.equal(pages[0].url, "https://cdn.example.org/a.jpg");
  assert.equal(pages[0].headers.Referer, chapter);
  assert.equal(pages[0].headers["User-Agent"], "test UA");
});

test("11toon: missing episode container falls back to document buttons", function() {
  const extension = loadExtension(toon11).extension;
  const button = {};
  extension._parseChapterNode = function(node, id) {
    assert.equal(node, button);
    assert.equal(id, "34");
    return { url: "/chapter/12", name: "12" };
  };
  const rows = extension._parseChapters({
    getElementById: function() { return null; },
    getElementsByTagName: function(tag) { assert.equal(tag, "button"); return [button]; }
  }, "34");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, "/chapter/12");
});

test("11toon: missing container and buttons return an empty result safely", function() {
  const extension = loadExtension(toon11).extension;
  assert.equal(extension._parseChapters({
    getElementById: function() { return null; },
    getElementsByTagName: function() { return []; }
  }, "34").length, 0);
});

function blacktoonCacheFixture() {
  let now = 1700000000000;
  class Clock extends Date { static now() { return now; } }
  const entry = catalogs[0].entries.find(function(value) { return value.name === "블랙툰"; });
  const loaded = loadExtension(entry, { Date: Clock });
  const extension = loaded.extension;
  let base = entry.baseUrl;
  extension._resolveBaseUrl = async function() { return base; };
  return { ...loaded, now: function() { return now; }, advance: function(ms) { now += ms; },
    setBase: function(value) { base = value; } };
}

function datasetConfig(base) {
  return { incUrl: "https://data.example.org", imageDomain: "https://img.example.org/",
    primary: { "1": base + "/ongoing.js", "0": base + "/completed.js" }, fallback: {},
    topUrl: base + "/top.js" };
}

test("Blacktoon: datasets reuse fresh cache and refresh at its expiry", async function() {
  const loaded = blacktoonCacheFixture(), extension = loaded.extension;
  extension._siteConfig = async function(base) { return datasetConfig(base); };
  let calls = 0;
  extension._getText = async function() { return 'var data1 = [{"x":' + (++calls) + ',"t":"fixture"}];'; };
  const first = await extension._loadDataset("ongoing");
  assert.equal(await extension._loadDataset("ongoing"), first);
  assert.equal(calls, 1);
  loaded.advance(extension.listFreshMs);
  assert.equal((await extension._loadDataset("ongoing"))[0].x, 2);
  assert.equal(calls, 2);
});

test("Blacktoon: simultaneous dataset requests share one fetch", async function() {
  const loaded = blacktoonCacheFixture(), extension = loaded.extension;
  extension._siteConfig = async function(base) { return datasetConfig(base); };
  let calls = 0;
  extension._getText = async function() { calls++; return 'var data1 = [{"x":1}];'; };
  const rows = await Promise.all([extension._loadDataset("ongoing"), extension._loadDataset("ongoing")]);
  assert.equal(calls, 1);
  assert.equal(rows[0], rows[1]);
});

test("Blacktoon: failed refresh can retry instead of keeping a rejected request", async function() {
  const loaded = blacktoonCacheFixture(), extension = loaded.extension;
  extension._siteConfig = async function(base) { return datasetConfig(base); };
  let available = true, calls = 0;
  extension._getText = async function() { calls++; if (!available) throw new Error("offline"); return 'var data1 = [{"x":' + calls + '}];'; };
  await extension._loadDataset("ongoing");
  loaded.advance(extension.listFreshMs);
  available = false;
  await assert.rejects(extension._loadDataset("ongoing"));
  available = true;
  assert.equal((await extension._loadDataset("ongoing"))[0].x, 3);
});

test("Blacktoon: late old-domain responses do not overwrite new-domain cache", async function() {
  const loaded = blacktoonCacheFixture(), extension = loaded.extension;
  extension._siteConfig = async function(base) { return datasetConfig(base); };
  let release;
  const oldResponse = new Promise(function(resolve) { release = resolve; });
  extension._getText = async function(url) {
    return url.includes("blacktoon423") ? await oldResponse : 'var data1 = [{"x":2}];';
  };
  const oldRequest = extension._loadDataset("ongoing");
  // Let the original request reach its pending network response before switching domains.
  await new Promise(setImmediate);
  loaded.setBase("https://blacktoon424.com");
  const current = await extension._loadDataset("ongoing");
  release('var data1 = [{"x":1}];');
  assert.equal((await oldRequest)[0].x, 1);
  assert.equal(await extension._loadDataset("ongoing"), current);
  assert.equal(current[0].x, 2);
});

test("Blacktoon: popularity rankings expire and concurrent refreshes are shared", async function() {
  const loaded = blacktoonCacheFixture(), extension = loaded.extension;
  extension._siteConfig = async function(base) { return datasetConfig(base); };
  let calls = 0;
  extension._getText = async function() { return "tophits['d_comm'] = '" + (++calls) + "';"; };
  const first = await extension._loadTop();
  assert.equal(await extension._loadTop(), first);
  loaded.advance(extension.listFreshMs);
  const refreshed = await Promise.all([extension._loadTop(), extension._loadTop()]);
  assert.equal(calls, 2);
  assert.equal(refreshed[0], refreshed[1]);
  assert.equal(refreshed[0].d_comm[0], "2");
});

test("Blacktoon: stored site configuration keeps its original expiry time", async function() {
  const loaded = blacktoonCacheFixture(), extension = loaded.extension, base = extension.source.baseUrl;
  loaded.preferences.set(extension.siteConfigSnapshotPreference, JSON.stringify({
    base, savedAt: loaded.now() - 23 * 60 * 60 * 1000, value: datasetConfig(base)
  }));
  let calls = 0;
  extension._getText = async function(url) {
    calls++;
    return url.includes("config.js") ? 'var inc_url="https://new.example.org"; var img_domain="https://new-img.example.org";' : "home fixture";
  };
  assert.equal((await extension._siteConfig(base)).incUrl, "https://data.example.org");
  assert.equal(calls, 0);
  loaded.advance(60 * 60 * 1000);
  assert.equal((await extension._siteConfig(base)).incUrl, "https://new.example.org");
  assert.equal(calls, 2);
});

test("Blacktoon: simultaneous site configuration requests share the homepage and script", async function() {
  const loaded = blacktoonCacheFixture(), extension = loaded.extension, base = extension.source.baseUrl;
  let calls = 0;
  extension._getText = async function(url) {
    calls++;
    return url.includes("config.js") ? 'var inc_url="https://data.example.org"; var img_domain="https://img.example.org";' : "home fixture";
  };
  const configs = await Promise.all([extension._siteConfig(base), extension._siteConfig(base)]);
  assert.equal(calls, 2);
  assert.equal(configs[0], configs[1]);
});

test("Blacktoon: expired list snapshot refreshes from a newly fetched dataset", async function() {
  const loaded = blacktoonCacheFixture(), extension = loaded.extension;
  extension._siteConfig = async function(base) { return datasetConfig(base); };
  extension._rowsForRule = async function() { return await extension._loadDataset("ongoing"); };
  extension._rememberItems = function() {};
  extension._imageFor = function() { return "https://img.example.org/fixture.jpg"; };
  let calls = 0;
  extension._getText = async function() { return 'var data1 = [{"x":' + (++calls) + ',"t":"title ' + calls + '"}];'; };
  const rule = extension._defaultLatestRule();
  assert.equal((await extension._pagedList(1, rule)).list[0].name, "title 1");
  loaded.advance(extension.listFreshMs + 1);
  assert.equal((await extension._pagedList(1, rule)).list[0].name, "title 1");
  await Promise.all(Object.values(extension.pendingLists));
  assert.equal((await extension._pagedList(1, rule)).list[0].name, "title 2");
  assert.equal(calls, 2);
});

for (const stream of ["/hls/main.m3u8?x=1&amp;y=2", "//cdn.example.org/main.m3u8", "../hls/main.m3u8", "https://cdn.example.org/main.m3u8"]) {
  test("TVRoom: viewer resolves HLS address " + stream, async function() {
    const playerUrl = "https://player.example.org/watch/1", calls = [];
    const extension = loadExtension(tvroom, {
      Document: class {
        selectFirst(selector) {
          if (selector === "iframe#view_iframe[src]") return { attr: function() { return playerUrl; } };
          if (selector === "#player[data-m3u8]") return { attr: function() { return stream; } };
          return null;
        }
      }
    }).extension;
    extension._resolveBaseUrl = async function() { return tvroom.baseUrl; };
    extension._requestText = async function(url, referer, stage, headers) {
      calls.push({ url, referer, stage, headers });
      return stage === "재생목록" ? "#EXTM3U\n#EXTINF:10,\nsegment.ts\n" : "HTML fixture";
    };
    const expected = new URL(stream.replace(/&amp;/g, "&"), playerUrl).href;
    const videos = await extension.getVideoList("/episode/1");
    assert.equal(calls[2].url, expected);
    assert.equal(videos[0].url, expected);
    assert.equal(videos[0].headers.Referer, playerUrl);
    assert.equal(videos[0].headers.Origin, "https://player.example.org");
    assert.equal(videos[0].headers["User-Agent"], extension.userAgent);
    assert.equal(videos[0].quality, "자동 (HLS)");
  });
}

test("Blacktoon: stale configuration fallback does not become fresh or extend its lifetime", async function() {
  const loaded = blacktoonCacheFixture(), extension = loaded.extension, base = extension.source.baseUrl;
  const savedAt = loaded.now() - 2 * 24 * 60 * 60 * 1000;
  loaded.preferences.set(extension.siteConfigSnapshotPreference, JSON.stringify({ base, savedAt, value: datasetConfig(base) }));
  extension._getText = async function() { throw new Error("offline"); };
  assert.equal((await extension._siteConfig(base)).incUrl, "https://data.example.org");
  loaded.advance(6 * 24 * 60 * 60 * 1000);
  await assert.rejects(extension._siteConfig(base), /offline/);
  extension._getText = async function(url) {
    return url.includes("config.js") ? 'var inc_url="https://new.example.org"; var img_domain="https://img.example.org";' : "home fixture";
  };
  assert.equal((await extension._siteConfig(base)).incUrl, "https://new.example.org");
});

test("Blacktoon: late old-domain configuration cannot replace current memory configuration", async function() {
  const loaded = blacktoonCacheFixture(), extension = loaded.extension, oldBase = extension.source.baseUrl;
  extension._setResolvedBase(oldBase, "manual");
  let release;
  const wait = new Promise(function(resolve) { release = resolve; });
  extension._getText = async function(url) {
    if (url.startsWith(oldBase)) await wait;
    return url.includes("config.js") ? 'var inc_url="https://data.example.org"; var img_domain="https://img.example.org";' : "home fixture";
  };
  const oldRequest = extension._siteConfig(oldBase);
  const newBase = "https://blacktoon424.com";
  extension._setResolvedBase(newBase, "manual");
  const current = await extension._siteConfig(newBase);
  release();
  await oldRequest;
  assert.equal(extension.cachedBase, newBase);
  assert.equal(await extension._siteConfig(newBase), current);
});

test("TVRoom: relative URL normalization handles dot paths, query and fragment references", function() {
  const extension = loadExtension(tvroom).extension;
  const base = "https://player.example.org/a/b/watch?old=1#old";
  for (const value of ["./main.m3u8", "../../main.m3u8", "../../../main.m3u8", "../", ".", "..", "?new=1", "#new", "/hls/./a/../main.m3u8", "/hls//main.m3u8"]) {
    assert.equal(extension._absoluteUrl(base, value), new URL(value, base).href, value);
  }
});

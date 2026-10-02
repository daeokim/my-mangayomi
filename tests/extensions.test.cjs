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

const media = [
  { name: "티비룸", key: "tvroom_domain_url", signal: "tvroom", prefix: "tvroom", suffix: "org" },
  { name: "티비위키", key: "tvwiki_domain_url", signal: "tvwiki", prefix: "tvwiki", suffix: "net" }
];
for (const spec of media) {
  const entry = catalogs[1].entries.find(function(value) { return value.name === spec.name; });
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

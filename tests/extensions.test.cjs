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

function loadExtension(entry) {
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

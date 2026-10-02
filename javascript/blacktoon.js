const mangayomiSources = [{
  name: "블랙툰",
  lang: "ko",
  baseUrl: "https://blacktoon423.com",
  apiUrl: "",
  iconUrl: "http://127.0.0.1:18774/icon/ko.blacktoon.png",
  typeSource: "single",
  itemType: 0,
  isNsfw: true,
  hasCloudflare: false,
  version: "0.1.14",
  dateFormat: "yyyy-MM-dd",
  dateFormatLocale: "ko_KR",
  pkgPath: "manga/src/ko/blacktoon.js"
}];

function dcResolveListCardManifest(data, scope, tab) {
  const source = data && typeof data === "object" ? data : {};
  const currentScope = String(scope || "default").trim().toLowerCase();
  const currentTab = String(tab || "all").trim().toLowerCase();
  const groupByScope = {
    xtoon: "manga", toon11: "manga", goodtoon: "manga", blacktoon: "manga", wolf_manga: "manga", wolf_webtoon: "manga",
    ani24: "media", anilife: "media", dc_iptv: "media", dc_live: "media", samsung_tv_plus: "media", linkkf_anime: "media", tvroom: "media",
    toki31_novel: "novel"
  };
  const currentGroup = groupByScope[currentScope] || "";
  const values = function(value) {
    if (Array.isArray(value)) return value.map(function(item) { return String(item || "").trim().toLowerCase(); }).filter(Boolean);
    const one = String(value || "").trim().toLowerCase();
    return one ? [one] : [];
  };
  let selected = null, selectedIndex = -1, selectedScore = -Infinity;
  const rules = Array.isArray(source.rules) ? source.rules : [];
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index];
    if (!rule || typeof rule !== "object" || rule.enabled === false) continue;
    const match = rule.match && typeof rule.match === "object" ? rule.match : {};
    const targets = values(rule.targets || rule.extensions || rule.scopes || match.targets || match.extensions || match.scopes);
    const groups = values(rule.groups || match.groups);
    const tabs = values(rule.tabs || rule.tab || match.tabs || match.tab);
    let targetScore = 0;
    if (targets.length) {
      if (targets.indexOf(currentScope + ":" + currentTab) >= 0) targetScore = 600;
      else if (targets.indexOf(currentScope) >= 0) targetScore = 500;
      else continue;
    } else if (groups.length) {
      if (!currentGroup || groups.indexOf(currentGroup) < 0) continue;
      targetScore = 300;
    }
    let tabScore = 0;
    if (tabs.length && tabs.indexOf("*") < 0 && tabs.indexOf("all") < 0 && tabs.indexOf("both") < 0) {
      if (tabs.indexOf(currentTab) < 0) continue;
      tabScore = 50;
    }
    const priority = Number(rule.priority) || 0;
    const score = priority * 10000 + targetScore + tabScore;
    if (score > selectedScore) { selected = rule; selectedIndex = index; selectedScore = score; }
  }
  const selectedCards = selected && Array.isArray(selected.cards) && selected.cards.length ? selected.cards : source.cards;
  const rootRotation = source.rotation && typeof source.rotation === "object" ? source.rotation : {};
  const ruleRotation = selected && selected.rotation && typeof selected.rotation === "object" ? selected.rotation : {};
  const revisionParts = [source.revision];
  if (selected) revisionParts.push(selected.revision, selected.id || ("rule-" + selectedIndex));
  return {
    cards: Array.isArray(selectedCards) ? selectedCards : [],
    name: String(selected && (selected.name || selected.title) || source.name || source.title || "").trim(),
    revision: revisionParts.map(function(value) { return String(value || "").trim(); }).filter(Boolean).join(":"),
    rotation: Object.assign({}, rootRotation, ruleRotation)
  };
}

async function dcOfficialListCardSystem(scope, tab, defaultName) {
  if (defaultName === undefined) { defaultName = tab; tab = "all"; }
  const assetBaseUrl = "https://dc-toki-mangayomi-novel.pages.dev";
  const manifestUrl = assetBaseUrl + "/assets/official-random-cards.json";
  let data = null;
  try {
    const response = await new Client({ persistentConnection: false, noProxy: true, timeout: 8, connectTimeout: 5 }).get(
      manifestUrl + "?card_manifest=" + Date.now(),
      { Accept: "application/json, text/plain, */*", Referer: assetBaseUrl + "/", "Cache-Control": "no-cache" }
    );
    if (response && response.statusCode >= 200 && response.statusCode < 300) data = JSON.parse(String(response.body || ""));
  } catch (_) {}
  const config = dcResolveListCardManifest(data, scope, tab);
  const revision = config.revision;
  let cards = config.cards.map(function(value) {
    const rawUrl = typeof value === "string" ? value : value && (value.imageUrl || value.image || value.url);
    let imageUrl = String(rawUrl || "").trim();
    if (imageUrl.startsWith("/")) imageUrl = assetBaseUrl + imageUrl;
    if (imageUrl.toLowerCase().indexOf("https://") !== 0) return null;
    if (revision) imageUrl += (imageUrl.indexOf("?") >= 0 ? "&" : "?") + "revision=" + encodeURIComponent(revision);
    return { name: String(typeof value === "object" && value && (value.name || value.title) || config.name || defaultName || "오늘의 한 장").trim(), imageUrl: imageUrl };
  }).filter(Boolean);
  if (!cards.length) {
    cards = Array.from({ length: 20 }, function(_, offset) {
      return { name: defaultName || "오늘의 한 장", imageUrl: assetBaseUrl + "/card/shared-random/card-" + String(offset + 1).padStart(2, "0") + ".jpg" };
    });
  }
  const rotation = config.rotation;
  const holdMinutes = String(rotation.mode || "").toLowerCase() === "interval" ? Math.max(1, Number(rotation.intervalMinutes) || 60) : 0;
  const preferences = new SharedPreferences();
  const safeScope = String(scope || "default").replace(/[^a-z0-9_-]/gi, "_");
  const safeTab = String(tab || "all").replace(/[^a-z0-9_-]/gi, "_");
  const key = "dc_list_card_system_last_" + safeScope + "_" + safeTab;
  const timeKey = key + "_time";
  const revisionKey = key + "_revision";
  let previous = 0, previousAt = 0, previousRevision = "";
  try {
    previous = Number(preferences.getString(key, "0"));
    previousAt = Number(preferences.getString(timeKey, "0"));
    previousRevision = String(preferences.getString(revisionKey, "") || "");
  } catch (_) {}
  let index = previous;
  const keepPrevious = holdMinutes > 0 && previous >= 1 && previous <= cards.length && previousAt > 0 && Date.now() - previousAt < holdMinutes * 60 * 1000 && previousRevision === revision;
  if (!keepPrevious) {
    index = Math.floor(Math.random() * cards.length) + 1;
    const avoidImmediateRepeat = rotation.avoidImmediateRepeat !== false;
    if (avoidImmediateRepeat && cards.length > 1 && index === previous) index = index % cards.length + 1;
    try {
      preferences.setString(key, String(index));
      preferences.setString(timeKey, String(Date.now()));
      preferences.setString(revisionKey, revision);
    } catch (_) {}
  }
  return cards[Math.max(1, Math.min(cards.length, index || 1)) - 1];
}

async function dcOfficialEventCard() {
  const manifestUrl = "https://dc-toki-mangayomi-media.pages.dev/assets/official-event-card.json";
  try {
    const response = await new Client({ persistentConnection: false, noProxy: true, timeout: 8, connectTimeout: 5 }).get(
      manifestUrl + "?event_manifest=" + Date.now(),
      { Accept: "application/json, text/plain, */*", Referer: "https://dc-toki-mangayomi-media.pages.dev/" }
    );
    if (!response || response.statusCode < 200 || response.statusCode >= 300) return null;
    const data = JSON.parse(String(response.body || ""));
    if (!data || data.enabled !== true) return null;
    const parseTime = function(value) {
      if (!value) return null;
      const time = Date.parse(String(value));
      return Number.isFinite(time) ? time : null;
    };
    const now = Date.now(), startsAt = parseTime(data.startsAt), endsAt = parseTime(data.endsAt);
    if (startsAt !== null && now < startsAt) return null;
    if (endsAt !== null && now >= endsAt) return null;
    const imageUrl = String(data.imageUrl || data.image || "").trim();
    if (!/^https:\/\//i.test(imageUrl)) return null;
    const revision = String(data.revision || "").trim();
    return {
      name: String(data.name || data.title || "특별 이벤트").trim(),
      imageUrl: imageUrl + (revision ? (imageUrl.indexOf("?") >= 0 ? "&" : "?") + "revision=" + encodeURIComponent(revision) : "")
    };
  } catch (_) {
    return null;
  }
}

function dcApplySiteOrderEpisodeNumbers(detail) {
  if (!detail || typeof detail !== "object") return detail;
  const items = Array.isArray(detail.episodes) ? detail.episodes : (Array.isArray(detail.chapters) ? detail.chapters : []);
  if (!items.length) return detail;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!item || typeof item !== "object") continue;
    const originalName = String(item.name == null ? "" : item.name).trim() || "재생";
    item.name = String(items.length - index) + "화 .  " + originalName;
  }
  detail.episodes = items;
  detail.chapters = items;
  return detail;
}

class DefaultExtension extends MProvider {
  constructor() {
    super();
    const originalGetDetail = DefaultExtension.prototype.getDetail.bind(this);
    this.getDetail = async (url) => dcApplySiteOrderEpisodeNumbers(await originalGetDetail(url));
    this.signalUrl = "https://wankyo83.github.io/tokki-traffic-light/domains.json";
    this.fallbackBaseUrl = "https://blacktoon423.com";
    this.lastKnownBasePreference = "blacktoon_last_known_base_url";
    this.lastKnownBaseTimePreference = "blacktoon_last_known_base_url_time";
    this.siteConfigSnapshotPreference = "blacktoon_site_config_snapshot_v1";
    this.itemSnapshotPreference = "blacktoon_item_snapshot_v1";
    this.userAgent = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
    this.imageAccept = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
    this.weekdayCardBaseUrl = "https://dc-toki-mangayomi-manga.pages.dev/card/weekday-";
    this.popularRulePreference = "blacktoon_popular_rule_v1";
    this.latestRulePreference = "blacktoon_latest_rule_v1";
    this.filterModePreference = "blacktoon_filter_mode";
    this.pageSize = 24;
    this.requestSequence = 0;
    this.cachedBase = "";
    this.cachedConfig = null;
    this.cachedDataBase = "";
    this.cachedData = { ongoing: null, completed: null, top: null };
    this.resolvedBase = "";
    this.resolvedBaseAt = 0;
    this.resolvedBaseMode = "";
    this.domainCacheMs = 60 * 1000;
    this.listFreshMs = 30 * 60 * 1000;
    this.listFallbackMs = 12 * 60 * 60 * 1000;
    this.pendingLists = {};

    this.weekdays = [["UP", "up"], ["월", "1"], ["화", "2"], ["수", "3"], ["목", "4"], ["금", "5"], ["토", "6"], ["일", "7"], ["열흘", "10"]];
    this.genres = [["전체", "0"], ["학원", "1"], ["액션", "2"], ["SF", "3"], ["스토리", "4"], ["판타지", "5"], ["BL/백합", "6"], ["개그/코미디", "7"], ["연애/순정", "8"], ["드라마", "9"], ["로맨스", "10"], ["시대극", "11"], ["스포츠", "12"], ["일상", "13"], ["추리/미스터리", "14"], ["공포/스릴러", "15"], ["성인", "16"], ["옴니버스", "17"], ["에피소드", "18"], ["무협", "19"], ["소년", "20"], ["기타", "99"]];
    this.platforms = [["전체", "0"], ["네이버", "1"], ["다음", "2"], ["카카오", "3"], ["레진", "4"], ["투믹스", "5"], ["탑툰", "6"], ["코미카", "7"], ["배틀코믹", "8"], ["코믹GT", "9"], ["케이툰", "10"], ["애니툰", "11"], ["폭스툰", "12"], ["피너툰", "13"], ["봄툰", "14"], ["코미코", "15"], ["무툰", "16"], ["지존신마", "17"], ["기타", "99"]];
    this.orders = [["최신순", "new"], ["인기순", "hot"]];
    this.bestPeriods = [["일간 BEST", "d"], ["주간 BEST", "w"], ["월간 BEST", "m"], ["실시간 BEST", "h"]];
    this.bestTypes = [["일반웹툰", "comm"], ["성인웹툰", "19"], ["BL/백합", "bl"]];
    this.listTypes = [["연재", "ongoing"], ["완결", "completed"], ["인기", "top"]];
    this.contentScopes = [["전체", "all"], ["일반 작품만", "general"], ["성인 작품", "adult"], ["BL/백합 작품", "bl"]];
  }

  _text(value) { return value === null || value === undefined ? "" : String(value); }
  _repairUtf8Mojibake(value) {
    const text = this._text(value);
    if (!text || /[가-힣]/.test(text) || !/[\u0080-\u00ff\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]/.test(text)) return text;
    const windows1252 = {
      0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
      0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e,
      0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
      0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f
    };
    let encoded = "";
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      const byte = code <= 0xff ? code : windows1252[code];
      if (byte === undefined) return text;
      encoded += "%" + byte.toString(16).padStart(2, "0");
    }
    try {
      const decoded = decodeURIComponent(encoded);
      return /[가-힣]/.test(decoded) ? decoded : text;
    } catch (_) {
      return text;
    }
  }
  _decodeHtmlEntities(value) {
    return this._text(value)
      .replace(/&#x([0-9a-f]+);/gi, function(_, code) { return String.fromCharCode(parseInt(code, 16)); })
      .replace(/&#(\d+);/g, function(_, code) { return String.fromCharCode(parseInt(code, 10)); })
      .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&");
  }
  _descriptionFromHtml(html, document) {
    const repairedHtml = this._repairUtf8Mojibake(html);
    const tagMatch = repairedHtml.match(/<meta\b[^>\r\n]*\bname\s*=\s*["']description["'][^>\r\n]*>/i);
    if (tagMatch) {
      const contentMatch = tagMatch[0].match(/\bcontent\s*=\s*(["'])(.*)\1\s*\/?\s*>$/i);
      if (contentMatch) {
        let description = this._decodeHtmlEntities(contentMatch[2]).replace(/\s+/g, " ").trim();
        if (/^["'].*["']$/.test(description)) description = description.slice(1, -1).trim();
        if (description) return description;
      }
    }
    const descriptionNode = document ? document.selectFirst('meta[name="description"]') : null;
    return this._repairUtf8Mojibake(descriptionNode ? descriptionNode.attr("content") : "").replace(/\s+/g, " ").trim();
  }
  _trimSlash(value) { return this._text(value).trim().replace(/\/+$/, ""); }
  _origin(value) { const match = this._text(value).match(/^(https?:\/\/[^/]+)/i); return match ? match[1] : ""; }
  _preference(key, fallback) { try { const value = new SharedPreferences().get(key); return value === null || value === undefined ? fallback : value; } catch (_) { return fallback; } }
  _preferenceString(key, fallback) { try { const value = new SharedPreferences().getString(key, fallback); return value === null || value === undefined ? fallback : this._text(value); } catch (_) { return fallback; } }
  _setPreferenceString(key, value) { try { new SharedPreferences().setString(key, this._text(value)); return true; } catch (_) { return false; } }
  _readSnapshot(key, base, maxAge) {
    const raw = this._preferenceString(key, "");
    if (!raw) return null;
    try {
      const snapshot = JSON.parse(raw);
      const age = Date.now() - Number(snapshot.savedAt || 0);
      if (!snapshot || snapshot.base !== base || age < 0 || age > maxAge || snapshot.value === undefined) return null;
      return { value: snapshot.value, age: age };
    } catch (_) { return null; }
  }
  _writeSnapshot(key, base, value) { return this._setPreferenceString(key, JSON.stringify({ base: base, savedAt: Date.now(), value: value })); }
  _filterMode() { return this._text(this._preference(this.filterModePreference, "aniyomi")) === "advanced" ? "advanced" : "aniyomi"; }
  _driveDirect(url, image) { const source = this._text(url).trim(); const match = source.match(/drive\.google\.com\/file\/d\/([^/]+)/i); return match ? "https://drive.google.com/uc?export=" + (image ? "view" : "download") + "&id=" + match[1] : source; }
  async _customCardUrl(slug) {
    const source = this._text(this._preference("blacktoon_custom_card_json_url", "")).trim();
    if (!source) return "";
    const preferences = new SharedPreferences();
    const cacheKey = "blacktoon_custom_card_cache", sourceKey = cacheKey + "_source", timeKey = cacheKey + "_time";
    let data = null, cached = "";
    if (this._preferenceString(sourceKey, "") === source) cached = this._preferenceString(cacheKey, "");
    const cachedAt = Number(this._preferenceString(timeKey, "0"));
    if (cached && cachedAt > 0 && Date.now() - cachedAt < 5 * 60 * 1000) { try { data = JSON.parse(cached); } catch (_) {} }
    if (!data) {
      try {
        const direct = this._driveDirect(source, false), join = direct.indexOf("?") >= 0 ? "&" : "?", requestUrl = direct + join + "card_json=" + Date.now();
        let body = "";
        for (const options of [{ persistentConnection: false, noProxy: true, timeout: 15, connectTimeout: 8 }, { useDartHttpClient: true, persistentConnection: false }]) { try { const response = await new Client(options).get(requestUrl, { "Accept": "application/json", "Cache-Control": "no-cache" }); if (response.statusCode >= 200 && response.statusCode < 300) { body = response.body; break; } } catch (_) {} }
        if (!body) throw new Error("커스텀 목록 카드 JSON을 불러오지 못했습니다.");
        data = JSON.parse(body); preferences.setString(cacheKey, JSON.stringify(data)); preferences.setString(sourceKey, source); preferences.setString(timeKey, String(Date.now()));
      } catch (_) { if (cached) { try { data = JSON.parse(cached); } catch (_) {} } }
    }
    if (!data || typeof data !== "object") return "";
    const cards = data.cards && typeof data.cards === "object" ? data.cards : {};
    let image = this._text(cards[slug] || data.default || data.card).trim();
    if (!image) return "";
    image = this._driveDirect(image, true);
    if (data.revision !== undefined && this._text(data.revision).trim()) image += (image.indexOf("?") >= 0 ? "&" : "?") + "revision=" + encodeURIComponent(this._text(data.revision));
    return image;
  }
  _isAllowedBaseUrl(value) { return /^https:\/\/(?:www\.)?blacktoon\d+\.com\/?$/i.test(this._text(value).trim()); }

  _normalizeManualBaseUrl(value) {
    let raw = this._text(value).trim();
    if (!raw) return "";
    if (/^\d+$/.test(raw)) raw = "blacktoon" + raw + ".com";
    else if (/^blacktoon\d+$/i.test(raw)) raw += ".com";
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw.replace(/^\/+/, "");
    raw = raw.replace(/^http:\/\//i, "https://");
    return this._isAllowedBaseUrl(raw) ? this._trimSlash(raw) : "";
  }

  _setResolvedBase(value, mode) {
    const resolved = this._trimSlash(value);
    if (this.resolvedBase && this.resolvedBase !== resolved) {
      this.cachedBase = "";
      this.cachedConfig = null;
      this.cachedDataBase = "";
      this.cachedData = { ongoing: null, completed: null, top: null };
      this.pendingLists = {};
    }
    this.resolvedBase = resolved;
    this.resolvedBaseAt = Date.now();
    this.resolvedBaseMode = mode || "fallback";
    return resolved;
  }

  async _resolveBaseUrl(forceRefresh) {
    const manual = this._normalizeManualBaseUrl(this._preferenceString("blacktoon_domain_url", ""));
    if (manual) return this._setResolvedBase(manual, "manual");
    if (!forceRefresh && this.resolvedBase && this.resolvedBaseMode !== "manual" && Date.now() - this.resolvedBaseAt < this.domainCacheMs) return this.resolvedBase;
    const lastKnown = this._normalizeManualBaseUrl(this._preferenceString(this.lastKnownBasePreference, ""));
    try {
      const signalUrl = this.signalUrl + (this.signalUrl.indexOf("?") >= 0 ? "&" : "?") + "v=" + Date.now();
      const response = await new Client({ persistentConnection: false, noProxy: true, timeout: 8, connectTimeout: 5 }).get(signalUrl, { "User-Agent": this.userAgent, "Accept": "application/json", "Cache-Control": "no-cache" });
      if (response.statusCode >= 200 && response.statusCode < 300) {
        const data = JSON.parse(response.body);
        const candidate = data && data.domains && data.domains.blacktoon ? data.domains.blacktoon.baseUrl : "";
        if (this._isAllowedBaseUrl(candidate)) {
          const resolved = this._trimSlash(candidate);
          this._setPreferenceString(this.lastKnownBasePreference, resolved);
          this._setPreferenceString(this.lastKnownBaseTimePreference, String(Date.now()));
          return this._setResolvedBase(resolved, "signal");
        }
      }
    } catch (_) {}
    if (lastKnown) return this._setResolvedBase(lastKnown, "last-known");
    const configured = this.source && this.source.baseUrl ? this.source.baseUrl : "";
    const resolved = this._isAllowedBaseUrl(configured) ? this._trimSlash(configured) : this.fallbackBaseUrl;
    return this._setResolvedBase(resolved, "fallback");
  }

  _requestHeaders(url, extraHeaders) {
    const headers = { "User-Agent": this.userAgent, "Accept": "text/html,application/xhtml+xml,application/javascript,application/json;q=0.9,*/*;q=0.8", "Referer": (this._origin(url) || this.fallbackBaseUrl) + "/" };
    if (extraHeaders) Object.assign(headers, extraHeaders);
    return headers;
  }

  _failureCode(response, cause) {
    const status = response && response.statusCode ? Number(response.statusCode) : 0;
    if (status) return "HTTP" + status;
    const text = this._text(cause && (cause.message || cause));
    if (/10054|ECONNRESET|connection reset/i.test(text)) return "RESET";
    if (/timed?\s*out|timeout/i.test(text)) return "TIMEOUT";
    if (/certificate|handshake|TLS|SSL/i.test(text)) return "TLS";
    return "NETWORK";
  }

  async _pause(milliseconds) { if (typeof setTimeout === "function") await new Promise(function(resolve) { setTimeout(resolve, milliseconds); }); }

  async _requestText(method, url, extraHeaders, body, stage) {
    const headers = this._requestHeaders(url, extraHeaders);
    const transports = [
      { name: "RHTTP#1", options: { persistentConnection: false, noProxy: true, timeout: 12, connectTimeout: 6 } },
      { name: "RHTTP#2", options: { persistentConnection: false, noProxy: true, timeout: 12, connectTimeout: 6 } },
      { name: "DART", options: { useDartHttpClient: true, persistentConnection: false, timeout: 15, connectTimeout: 7 } }
    ];
    const diagnostics = [];
    for (let transportIndex = 0; transportIndex < transports.length; transportIndex++) {
      const transport = transports[transportIndex];
      try {
        const client = new Client(transport.options);
        const response = method === "POST" ? await client.post(url, headers, body) : await client.get(url, headers);
        if (response.statusCode >= 200 && response.statusCode < 300) return response.body;
        diagnostics.push(transport.name + "=" + this._failureCode(response, null));
        if ([400, 401, 403, 404, 429].indexOf(Number(response.statusCode)) >= 0) break;
      } catch (error) {
        diagnostics.push(transport.name + "=" + this._failureCode(null, error));
      }
      if (transportIndex < transports.length - 1) await this._pause(transportIndex === 0 ? 160 : 320);
    }
    throw new Error("블랙툰 " + (stage || "요청") + " 연결에 실패했습니다. 진단: " + diagnostics.join(","));
  }

  async _getText(url, extraHeaders, stage) { return await this._requestText("GET", url, extraHeaders, undefined, stage); }
  _join(base, path) { return this._trimSlash(base) + "/" + this._text(path).replace(/^\/+/, ""); }
  _configValue(text, name) { const match = this._text(text).match(new RegExp("(?:var\\s+)?" + name + "\\s*=\\s*[\\\"']([^\\\"']+)", "i")); return match ? this._trimSlash(match[1]) : ""; }

  async _siteConfig(base) {
    if (this.cachedConfig && this.cachedBase === base) return this.cachedConfig;
    const stored = this._readSnapshot(this.siteConfigSnapshotPreference, base, 24 * 60 * 60 * 1000);
    if (stored && stored.value && stored.value.incUrl && stored.value.imageDomain) {
      this.cachedBase = base;
      this.cachedConfig = stored.value;
      return stored.value;
    }
    let home = "", configText = "";
    try {
      const responses = await Promise.all([
        this._getText(base + "/", null, "홈"),
        this._getText(base + "/data/config.js?v=" + Date.now(), { "Referer": base + "/" }, "설정")
      ]);
      home = responses[0];
      configText = responses[1];
    } catch (error) {
      const stale = this._readSnapshot(this.siteConfigSnapshotPreference, base, 7 * 24 * 60 * 60 * 1000);
      if (stale && stale.value && stale.value.incUrl && stale.value.imageDomain) {
        this.cachedBase = base;
        this.cachedConfig = stale.value;
        return stale.value;
      }
      throw error;
    }
    const incUrl = this._configValue(configText, "inc_url");
    const incUrl1 = this._configValue(configText, "inc_url1");
    const incUrl2 = this._configValue(configText, "inc_url2");
    const imageDomain = this._configValue(configText, "img_domain");
    const alternateImageDomain = this._configValue(configText, "img_domain8") || imageDomain;
    if (!incUrl || !imageDomain) throw new Error("블랙툰 데이터 서버 설정을 찾지 못했습니다.");
    const primary = {};
    const fallback = {};
    for (const kind of ["0", "1"]) {
      const primaryMatch = home.match(new RegExp("inc_url2\\s*\\+\\s*[\\\"']\\/(webtoon_" + kind + "\\.js[^\\\"']*)", "i"));
      const fallbackMatch = home.match(new RegExp("inc_url\\s*\\+\\s*[\\\"']\\/(data/webtoon/webtoon_" + kind + "_[^\\\"']*\\.js[^\\\"']*)", "i"));
      if (primaryMatch && incUrl2) primary[kind] = this._join(incUrl2, primaryMatch[1]);
      if (fallbackMatch) fallback[kind] = this._join(incUrl, fallbackMatch[1]);
    }
    const config = { base: base, home: home, incUrl: incUrl, incUrl1: incUrl1, incUrl2: incUrl2, imageDomain: imageDomain + "/", alternateImageDomain: alternateImageDomain + "/", primary: primary, fallback: fallback, topUrl: this._join(incUrl, "data/top.js?v=" + Date.now()) };
    if (this.cachedBase !== base) this.cachedData = { ongoing: null, completed: null, top: null };
    this.cachedBase = base;
    this.cachedConfig = config;
    this._writeSnapshot(this.siteConfigSnapshotPreference, base, config);
    return config;
  }

  _parseArrayScript(script, variable) {
    const text = this._text(script);
    const assignment = text.search(new RegExp("(?:var\\s+)?" + variable + "\\s*=", "i"));
    const start = text.indexOf("[", Math.max(0, assignment));
    const end = text.lastIndexOf("]");
    if (assignment < 0 || start < 0 || end <= start) throw new Error("블랙툰 " + variable + " 데이터 형식이 올바르지 않습니다.");
    const rows = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(rows)) throw new Error("블랙툰 " + variable + " 데이터가 배열이 아닙니다.");
    return rows;
  }

  async _loadDataset(kind) {
    const base = await this._resolveBaseUrl();
    if (this.cachedDataBase !== base) {
      this.cachedDataBase = base;
      this.cachedData = { ongoing: null, completed: null, top: null };
    }
    if (this.cachedData[kind]) return this.cachedData[kind];
    const config = await this._siteConfig(base);
    const index = kind === "ongoing" ? "1" : "0";
    let script = "";
    if (config.primary[index]) {
      try { script = await this._getText(config.primary[index], { "Referer": base + "/" }, kind === "ongoing" ? "연재 데이터" : "완결 데이터"); } catch (_) {}
    }
    if (!script && config.fallback[index]) script = await this._getText(config.fallback[index], { "Referer": base + "/" }, kind === "ongoing" ? "연재 예비 데이터" : "완결 예비 데이터");
    if (!script) throw new Error("블랙툰 " + (kind === "ongoing" ? "연재" : "완결") + " 데이터 주소를 찾지 못했습니다.");
    const rows = this._parseArrayScript(script, "data" + index);
    for (const row of rows) row.__kind = kind;
    this.cachedData[kind] = rows;
    return rows;
  }

  async _loadTop() {
    const base = await this._resolveBaseUrl();
    if (this.cachedDataBase !== base) {
      this.cachedDataBase = base;
      this.cachedData = { ongoing: null, completed: null, top: null };
    }
    if (this.cachedData.top) return this.cachedData.top;
    const config = await this._siteConfig(base);
    const script = await this._getText(config.topUrl, { "Referer": base + "/" }, "인기 순위");
    const top = {};
    const pattern = /tophits\[['"]([^'"]+)['"]\]\s*=\s*['"]([^'"]*)['"]/gi;
    let match;
    while ((match = pattern.exec(script)) !== null) top[match[1]] = match[2].split(",").filter(Boolean);
    if (!Object.keys(top).length) throw new Error("블랙툰 인기 순위표를 해석하지 못했습니다.");
    this.cachedData.top = top;
    return top;
  }

  _defaultPopularRule() { return { section: "top", weekday: "up", genre: "0", platform: "0", contentScope: "all", order: "hot", best: "d", topType: "comm" }; }
  _defaultLatestRule() { return { section: "ongoing", weekday: "up", genre: "0", platform: "0", contentScope: "all", order: "new", best: "d", topType: "comm" }; }
  _allowed(value, pairs, fallback) { const text = this._text(value); return pairs.some(function(pair) { return pair[1] === text; }) ? text : fallback; }

  _normalizeRule(rule, fallback) {
    const source = rule || fallback || this._defaultLatestRule();
    const section = ["ongoing", "completed", "top"].indexOf(this._text(source.section)) >= 0 ? this._text(source.section) : "ongoing";
    return {
      section: section,
      weekday: section === "ongoing" ? this._allowed(source.weekday, this.weekdays, "up") : "up",
      genre: section === "top" ? "0" : this._allowed(source.genre, this.genres, "0"),
      platform: section === "top" ? "0" : this._allowed(source.platform, this.platforms, "0"),
      contentScope: section === "top" ? "all" : this._allowed(source.contentScope, this.contentScopes, "all"),
      order: section === "top" ? "hot" : this._allowed(source.order, this.orders, "new"),
      best: section === "top" ? this._allowed(source.best, this.bestPeriods, "d") : "d",
      topType: section === "top" ? this._allowed(source.topType, this.bestTypes, "comm") : "comm"
    };
  }

  _encodeRule(rule) { const r = this._normalizeRule(rule, this._defaultLatestRule()); return [r.section, r.weekday, r.genre, r.platform, r.order, r.best, r.topType, r.contentScope].join("|"); }
  _decodeRule(value, fallback) {
    const p = this._text(value).split("|");
    if (p.length === 7 || p.length === 8) return this._normalizeRule({ section: p[0], weekday: p[1], genre: p[2], platform: p[3], order: p[4], best: p[5], topType: p[6], contentScope: p.length === 8 ? p[7] : "all" }, fallback);
    return this._normalizeRule(fallback, this._defaultLatestRule());
  }
  _tabRule(key, fallback) { const encoded = this._preferenceString(key, ""); return encoded ? this._decodeRule(encoded, fallback) : this._normalizeRule(fallback, this._defaultLatestRule()); }
  _nameFor(pairs, value, fallback) { const found = pairs.find(function(pair) { return pair[1] === value; }); return found ? found[0] : fallback; }

  _ruleSummary(rule) {
    const r = this._normalizeRule(rule, this._defaultLatestRule());
    if (r.section === "top") return ["인기", this._nameFor(this.bestPeriods, r.best, "일간 BEST"), this._nameFor(this.bestTypes, r.topType, "일반웹툰")].join(" + ");
    const parts = [r.section === "ongoing" ? "연재" : "완결"];
    if (r.section === "ongoing") parts.push(this._nameFor(this.weekdays, r.weekday, "UP"));
    parts.push(this._nameFor(this.platforms, r.platform, "전체"), this._nameFor(this.genres, r.genre, "전체"), this._nameFor(this.contentScopes, r.contentScope, "전체"), this._nameFor(this.orders, r.order, "최신순"));
    return parts.join(" + ");
  }

  _filterRows(rows, rule) {
    const r = this._normalizeRule(rule, this._defaultLatestRule());
    let list = rows.slice();
    if (r.section === "ongoing") list = r.weekday === "up" ? list.filter(function(item) { return String(item.up || "0") !== "0"; }) : list.filter(function(item) { return String(item.pd || "") === r.weekday; });
    if (r.genre !== "0") list = list.filter(function(item) { return ("," + String(item.tag || "").replace(/^,+|,+$/g, "") + ",").indexOf("," + r.genre + ",") >= 0; });
    if (r.platform !== "0") list = list.filter(function(item) { return String(item.c || "") === r.platform; });
    if (r.contentScope !== "all") list = list.filter(function(item) {
      const tags = "," + String(item.tag || "").replace(/^,+|,+$/g, "") + ",";
      const adult = tags.indexOf(",16,") >= 0;
      const bl = tags.indexOf(",6,") >= 0;
      if (r.contentScope === "general") return !adult && !bl;
      if (r.contentScope === "adult") return adult;
      if (r.contentScope === "bl") return bl;
      return true;
    });
    const field = r.order === "hot" ? "h" : "d";
    list.sort(function(a, b) { return Number(b[field] || 0) - Number(a[field] || 0); });
    return list;
  }

  async _rowsForRule(rule) {
    const r = this._normalizeRule(rule, this._defaultLatestRule());
    if (r.section === "top") {
      const rows = await this._loadDataset("ongoing");
      const top = await this._loadTop();
      const ids = top[r.best + "_" + r.topType] || [];
      const rank = {};
      ids.forEach(function(id, index) { rank[String(id)] = index; });
      return rows.filter(function(item) { return Object.prototype.hasOwnProperty.call(rank, String(item.x)); }).sort(function(a, b) { return rank[String(a.x)] - rank[String(b.x)]; });
    }
    return this._filterRows(await this._loadDataset(r.section), r);
  }

  _imageFor(item, config) {
    const path = this._text(item && item.p).replace(/_x[34](?=\.[^.]+$)/i, "").replace(/^\/+/, "");
    if (!path) return "";
    return this._preferredImageDomain(config) + path;
  }

  _preferredImageDomain(config) {
    const alternate = this._text(config && config.alternateImageDomain).trim();
    if (/^https:\/\//i.test(alternate)) return alternate.replace(/\/+$/, "") + "/";
    return this._text(config && config.imageDomain).replace(/\/+$/, "") + "/";
  }

  _rewriteImageUrl(value, config) {
    const source = this._text(value).trim();
    const preferred = this._preferredImageDomain(config);
    if (!source) return "";
    if (!/^https?:\/\//i.test(source)) return preferred + source.replace(/^\/+/, "");
    const primary = this._text(config && config.imageDomain).replace(/\/+$/, "") + "/";
    if (source.indexOf(primary) === 0) return preferred + source.slice(primary.length);
    if (/^https?:\/\/[^/]*speedwebgo\.com\//i.test(source)) return preferred + source.replace(/^https?:\/\/[^/]+\//i, "");
    return source;
  }

  _slimItem(item) {
    if (!item || typeof item !== "object") return null;
    const result = {};
    for (const key of ["x", "t", "p", "au", "up", "pd", "tag", "c", "h", "d", "__kind"]) if (item[key] !== undefined) result[key] = item[key];
    return result.x === undefined ? null : result;
  }

  _rememberItems(rows, base) {
    if (!Array.isArray(rows) || !rows.length) return;
    let snapshot = null;
    try { snapshot = JSON.parse(this._preferenceString(this.itemSnapshotPreference, "")); } catch (_) {}
    if (!snapshot || snapshot.base !== base || !snapshot.items || typeof snapshot.items !== "object") snapshot = { base: base, savedAt: 0, order: [], items: {} };
    const order = Array.isArray(snapshot.order) ? snapshot.order.filter(function(id) { return snapshot.items[id]; }) : [];
    for (const row of rows) {
      const item = this._slimItem(row);
      if (!item) continue;
      const id = String(item.x);
      snapshot.items[id] = item;
      const previous = order.indexOf(id);
      if (previous >= 0) order.splice(previous, 1);
      order.push(id);
    }
    while (order.length > 300) delete snapshot.items[order.shift()];
    snapshot.order = order;
    snapshot.savedAt = Date.now();
    this._setPreferenceString(this.itemSnapshotPreference, JSON.stringify(snapshot));
  }

  _rememberedItem(id, base) {
    try {
      const snapshot = JSON.parse(this._preferenceString(this.itemSnapshotPreference, ""));
      if (!snapshot || snapshot.base !== base || Date.now() - Number(snapshot.savedAt || 0) > 30 * 24 * 60 * 60 * 1000) return null;
      return snapshot.items && snapshot.items[String(id)] ? snapshot.items[String(id)] : null;
    } catch (_) { return null; }
  }

  _genresFor(item) {
    const result = [];
    const platform = this._nameFor(this.platforms, String(item.c || "0"), "");
    if (platform && platform !== "전체") result.push(platform);
    if (item.__kind === "ongoing") {
      const weekday = this._nameFor(this.weekdays, String(item.pd || ""), "");
      if (weekday && weekday !== "UP") result.push(weekday);
    }
    const ids = this._text(item.tag).split(",").filter(Boolean);
    for (const id of ids) { const name = this._nameFor(this.genres, id, ""); if (name && name !== "전체" && result.indexOf(name) < 0) result.push(name); }
    return result;
  }

  _listSnapshotKey(page, rule) { return "blacktoon_list_snapshot_v1_" + this._encodeRule(rule).replace(/[^a-z0-9]+/gi, "_") + "_p" + String(Math.max(1, Number(page) || 1)); }

  async _buildPagedList(page, rule, base, snapshotKey) {
    const config = await this._siteConfig(base);
    const rows = await this._rowsForRule(rule);
    const start = Math.max(0, (Number(page) - 1) * this.pageSize);
    const selected = rows.slice(start, start + this.pageSize);
    this._rememberItems(selected, base);
    const result = {
      list: selected.map((item) => ({ name: this._text(item.t), link: "/webtoon/" + item.x + ".html?bt=" + (item.__kind === "completed" ? "0" : "1"), imageUrl: this._imageFor(item, config), author: this._text(item.au) })),
      hasNextPage: start + selected.length < rows.length
    };
    this._writeSnapshot(snapshotKey, base, result);
    return result;
  }

  async _pagedList(page, rule) {
    const base = await this._resolveBaseUrl();
    const snapshotKey = this._listSnapshotKey(page, rule);
    const cached = this._readSnapshot(snapshotKey, base, this.listFallbackMs);
    if (cached && cached.age <= this.listFreshMs) return cached.value;
    if (cached) {
      if (!this.pendingLists[snapshotKey]) {
        this.pendingLists[snapshotKey] = this._buildPagedList(page, rule, base, snapshotKey).catch(function() { return null; }).finally(() => { delete this.pendingLists[snapshotKey]; });
      }
      return cached.value;
    }
    if (!this.pendingLists[snapshotKey]) this.pendingLists[snapshotKey] = this._buildPagedList(page, rule, base, snapshotKey).finally(() => { delete this.pendingLists[snapshotKey]; });
    return await this.pendingLists[snapshotKey];
  }

  _koreaWeekday() { const day = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCDay(); return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][day]; }
  _weekdayCardInfo(slug) { const names = { monday: "월요일", tuesday: "화요일", wednesday: "수요일", thursday: "목요일", friday: "금요일", saturday: "토요일", sunday: "일요일" }; const value = names[slug] ? slug : this._koreaWeekday(); return { name: names[value], slug: value }; }
  async _tabCard(tab) {
    const info = this._weekdayCardInfo(this._koreaWeekday());
    const customSource = this._text(this._preference("blacktoon_custom_card_json_url", "")).trim();
    const customImage = await this._customCardUrl(info.slug);
    const event = customSource ? null : await dcOfficialEventCard();
    const official = customImage || event ? null : await dcOfficialListCardSystem("blacktoon", tab, "오늘의 만화");
    return {
      name: customImage ? info.name : event ? event.name : official.name,
      link: "/__blacktoon_weekday_card__/" + info.slug,
      imageUrl: customImage || (event && event.imageUrl) || official.imageUrl
    };
  }
  async _prependTabCard(result, page, tab) { return Number(page) === 1 ? { list: [await this._tabCard(tab)].concat(result.list || []), hasNextPage: result.hasNextPage === true } : result; }
  async getPopular(page) { const rule = this._tabRule(this.popularRulePreference, this._defaultPopularRule()); return this._prependTabCard(await this._pagedList(page, rule), page, "popular"); }
  async getLatestUpdates(page) { const rule = this._tabRule(this.latestRulePreference, this._defaultLatestRule()); return this._prependTabCard(await this._pagedList(page, rule), page, "latest"); }

  _normalizeSearch(value) { let text = this._text(value); try { text = text.normalize("NFKC"); } catch (_) {} return text.trim().replace(/\s+/g, " "); }
  _searchKey(value) { return this._normalizeSearch(value).toLowerCase().replace(/\s+/g, ""); }
  _filterValue(filters, type, fallback) { if (!Array.isArray(filters)) return fallback; for (const filter of filters) { if (!filter || filter.type !== type || !Array.isArray(filter.values)) continue; const option = filter.values[Number(filter.state) || 0]; return option && option.value !== undefined ? this._text(option.value) : fallback; } return fallback; }

  _filterRule(filters) {
    const unset = "__unset__";
    const ongoing = { weekday: this._filterValue(filters, "ongoingWeekday", unset), genre: this._filterValue(filters, "ongoingGenre", unset), platform: this._filterValue(filters, "ongoingPlatform", unset), order: this._filterValue(filters, "ongoingOrder", unset) };
    const completed = { genre: this._filterValue(filters, "completedGenre", unset), platform: this._filterValue(filters, "completedPlatform", unset), order: this._filterValue(filters, "completedOrder", unset) };
    const top = { best: this._filterValue(filters, "topBest", unset), topType: this._filterValue(filters, "topType", unset) };
    const selected = function(group) { return Object.keys(group).some(function(key) { return group[key] !== unset; }); };
    const count = [selected(ongoing), selected(completed), selected(top)].filter(Boolean).length;
    if (count > 1) throw new Error("블랙툰 필터는 연재·완결·인기 중 한 구역만 선택하세요.");
    if (selected(ongoing)) return this._normalizeRule({ section: "ongoing", weekday: ongoing.weekday === unset ? "up" : ongoing.weekday, genre: ongoing.genre === unset ? "0" : ongoing.genre, platform: ongoing.platform === unset ? "0" : ongoing.platform, order: ongoing.order === unset ? "new" : ongoing.order }, this._defaultLatestRule());
    if (selected(completed)) return this._normalizeRule({ section: "completed", genre: completed.genre === unset ? "0" : completed.genre, platform: completed.platform === unset ? "0" : completed.platform, order: completed.order === unset ? "new" : completed.order }, this._defaultLatestRule());
    if (selected(top)) return this._normalizeRule({ section: "top", best: top.best === unset ? "d" : top.best, topType: top.topType === unset ? "comm" : top.topType }, this._defaultPopularRule());
    return null;
  }

  _aniyomiFilterRule(filters) {
    return this._normalizeRule({
      section: this._filterValue(filters, "simpleListType", "ongoing"),
      weekday: this._filterValue(filters, "simpleWeekday", "up"),
      platform: this._filterValue(filters, "simplePlatform", "0"),
      genre: this._filterValue(filters, "simpleGenre", "0"),
      contentScope: this._filterValue(filters, "simpleContentScope", "all"),
      order: this._filterValue(filters, "simpleOrder", "new"),
      best: this._filterValue(filters, "simpleTopBest", "d"),
      topType: this._filterValue(filters, "simpleTopType", "comm")
    }, this._defaultLatestRule());
  }

  _hasExplicitAniyomiFilter(filters) {
    const defaults = {
      simpleListType: "ongoing",
      simpleWeekday: "up",
      simplePlatform: "0",
      simpleGenre: "0",
      simpleContentScope: "all",
      simpleOrder: "new",
      simpleTopBest: "d",
      simpleTopType: "comm"
    };
    return Object.keys(defaults).some((type) => this._filterValue(filters, type, defaults[type]) !== defaults[type]);
  }

  _applyTabRuleAction(page, filters, rule) {
    if (Number(page) !== 1) return;
    const action = Number(this._filterValue(filters, "tabRuleAction", "0"));
    const preferences = new SharedPreferences();
    if (action === 1) preferences.setString(this.popularRulePreference, this._encodeRule(rule));
    else if (action === 2) preferences.setString(this.latestRulePreference, this._encodeRule(rule));
    else if (action === 3) preferences.setString(this.popularRulePreference, "");
    else if (action === 4) preferences.setString(this.latestRulePreference, "");
    else if (action === 5) { preferences.setString(this.popularRulePreference, ""); preferences.setString(this.latestRulePreference, ""); }
  }

  async search(query, page, filters) {
    const normalized = this._normalizeSearch(query);
    const action = Number(this._filterValue(filters, "tabRuleAction", "0"));
    const advanced = this._filterMode() === "advanced";
    let rule = advanced
      ? this._filterRule(filters)
      : (normalized && !this._hasExplicitAniyomiFilter(filters) ? null : this._aniyomiFilterRule(filters));
    if (!rule && action >= 3 && action <= 5) rule = action === 3 ? this._defaultPopularRule() : this._defaultLatestRule();
    if (!rule && !normalized) throw new Error("블랙툰 필터에서 연재·완결·인기 중 사용할 조건을 선택하세요.");
    if (rule) this._applyTabRuleAction(page, filters, rule);
    let rows;
    if (rule) rows = await this._rowsForRule(rule);
    else {
      const ongoing = await this._loadDataset("ongoing");
      const completed = await this._loadDataset("completed");
      rows = ongoing.concat(completed).sort(function(a, b) { return Number(b.d || 0) - Number(a.d || 0); });
    }
    if (normalized) {
      const wanted = this._searchKey(normalized);
      rows = rows.filter((item) => this._searchKey(item.t).indexOf(wanted) >= 0 || this._searchKey(item.au).indexOf(wanted) >= 0);
    }
    const base = await this._resolveBaseUrl();
    const config = await this._siteConfig(base);
    const start = Math.max(0, (Number(page) - 1) * this.pageSize);
    const selected = rows.slice(start, start + this.pageSize);
    this._rememberItems(selected, base);
    return { list: selected.map((item) => ({ name: this._text(item.t), link: "/webtoon/" + item.x + ".html?bt=" + (item.__kind === "completed" ? "0" : "1"), imageUrl: this._imageFor(item, config), author: this._text(item.au) })), hasNextPage: start + selected.length < rows.length };
  }

  _dateUpload(value) { const match = this._text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!match) return "0"; return String(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - 9 * 60 * 60 * 1000); }
  async _itemFor(id, kind, base) {
    const remembered = this._rememberedItem(id, base);
    if (remembered) return remembered;
    const rows = this.cachedData[kind === "0" ? "completed" : "ongoing"];
    return Array.isArray(rows) ? rows.find(function(item) { return String(item.x) === String(id); }) || null : null;
  }

  _chapterDataBases(config) {
    const result = [];
    for (const value of [config && config.incUrl1, config && config.incUrl2, config && config.incUrl]) {
      const base = this._trimSlash(value);
      if (/^https:\/\//i.test(base) && result.indexOf(base) < 0) result.push(base);
    }
    return result;
  }

  async _loadChapters(id, config, detailUrl) {
    const failures = [];
    for (const dataBase of this._chapterDataBases(config)) {
      try {
        const script = await this._getText(this._join(dataBase, "data/toonlist/" + id + ".js?v=" + Date.now()), { "Referer": detailUrl }, "회차");
        return this._parseArrayScript(script, "clist");
      } catch (error) {
        failures.push(new URL(dataBase).host + "=" + this._failureCode(null, error));
      }
    }
    throw new Error("블랙툰 회차 데이터 연결에 실패했습니다. 진단: " + failures.join(","));
  }

  async getDetail(url) {
    const cardMatch = this._text(url).match(/\/__blacktoon_weekday_card__\/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (cardMatch) { const card = await this._tabCard(); return { name: card.name, link: card.link, imageUrl: card.imageUrl, author: "블랙툰", description: "오늘 요일 작품을 안내하는 움직이는 카드입니다. 뒤로 돌아가 작품을 선택해 주세요.", genre: ["요일 안내"], status: 0, episodes: [], chapters: [] }; }
    const match = this._text(url).match(/\/webtoon\/(\d+)\.html(?:\?bt=([01]))?/i);
    if (!match) throw new Error("잘못된 블랙툰 작품 주소입니다.");
    const id = match[1];
    const kind = match[2] || "1";
    const base = await this._resolveBaseUrl();
    const config = await this._siteConfig(base);
    const item = await this._itemFor(id, kind, base);
    const detailUrl = base + "/webtoon/" + id + ".html";
    const responses = await Promise.all([
      this._getText(detailUrl, null, "상세").catch(function() { return ""; }),
      this._loadChapters(id, config, detailUrl)
    ]);
    const detailHtml = this._repairUtf8Mojibake(responses[0]);
    const document = new Document(detailHtml);
    const titleNode = document.selectFirst("h3.mt-2 b");
    const coverNode = document.selectFirst("img.thumb2");
    const detailTextNode = document.selectFirst(".col-sm-5 p.mt-2");
    const detailText = this._text(detailTextNode ? detailTextNode.text : "");
    const authorMatch = detailText.match(/작가\s*:\s*(.+?)(?:\s{2,}|$)/);
    const chapters = responses[1];
    const episodes = chapters.slice().reverse().map((chapter) => ({ name: this._text(chapter.t), url: chapter.u ? this._text(chapter.u) : "/webtoons/" + id + "/" + chapter.id + ".html", dateUpload: this._dateUpload(chapter.d) }));
    const coverPath = this._text(coverNode ? coverNode.attr("o_src") : "").replace(/^\/+/, "");
    return {
      name: this._text(item ? item.t : (titleNode ? titleNode.text : "")).trim(),
      link: "/webtoon/" + id + ".html?bt=" + kind,
      imageUrl: item ? this._imageFor(item, config) : (coverPath ? this._preferredImageDomain(config) + coverPath : ""),
      author: this._text(item ? item.au : (authorMatch ? authorMatch[1] : "")).trim(),
      description: this._descriptionFromHtml(detailHtml, document),
      genre: item ? this._genresFor(item) : [],
      status: kind === "0" ? 1 : 0,
      episodes: episodes,
      chapters: episodes
    };
  }

  _rabbitEnabled() { const value = this._preference("blacktoon_rabbit_enabled", false); return value === true || this._text(value).toLowerCase() === "true" || this._text(value) === "1"; }
  _rabbitEndpoint() { const raw = this._trimSlash(this._preference("blacktoon_rabbit_endpoint", "")); if (!raw) throw new Error("Rabbit 서버 주소가 비어 있습니다."); if (!/^https?:\/\/(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.test(raw)) throw new Error("Rabbit 서버 주소 형식이 잘못됐습니다. 예: http://192.168.0.10:9870"); return raw; }
  _rabbitHeaders(jsonBody) { const headers = { "Accept": "application/json", "X-Lab-Request": "1" }; if (jsonBody) headers["Content-Type"] = "application/json"; const key = this._text(this._preference("blacktoon_rabbit_access_key", "")).trim(); if (key) headers.Authorization = "Bearer " + key; return headers; }
  async _rabbitJson(endpoint, path, body, ignoreFailure) { try { const response = body === undefined ? await new Client().get(endpoint + path, this._rabbitHeaders(false)) : await new Client().post(endpoint + path, this._rabbitHeaders(true), body); if ([401, 403].indexOf(Number(response.statusCode)) >= 0) throw new Error("Rabbit 접속 키가 틀렸거나 서버 설정과 다릅니다."); if (response.statusCode < 200 || response.statusCode >= 300) { if (ignoreFailure) return {}; throw new Error("Rabbit 서버 요청 실패 (HTTP " + response.statusCode + ")."); } return JSON.parse(response.body); } catch (error) { if (ignoreFailure) return {}; if (error && error.message && error.message.indexOf("Rabbit") >= 0) throw error; throw new Error("Rabbit 서버에 연결할 수 없습니다. 주소, 포트, 방화벽을 확인하세요."); } }
  _newRequestId() { this.requestSequence++; let seed = Date.now().toString(16).padStart(12, "0") + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0") + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0") + this.requestSequence.toString(16).padStart(4, "0"); seed = (seed + "00000000000000000000000000000000").slice(0, 32); return seed.slice(0, 8) + "-" + seed.slice(8, 12) + "-4" + seed.slice(13, 16) + "-a" + seed.slice(17, 20) + "-" + seed.slice(20, 32); }
  _manifestPages(manifest, id, chapterUrl) { if (!manifest || this._text(manifest.id) !== id || this._text(manifest.chapterUrl) !== chapterUrl) throw new Error("Rabbit 인증 결과가 현재 회차와 일치하지 않습니다."); const rows = manifest.pages; if (!Array.isArray(rows) || !rows.length || Number(manifest.expected) !== rows.length) throw new Error("Rabbit 서버가 불완전한 이미지 목록을 반환했습니다."); const referer = this._text(manifest.referer).trim(); const userAgent = this._text(manifest.userAgent).trim(); return rows.map((row, index) => { if (!row || Number(row.page) !== index + 1 || !Array.isArray(row.urls)) throw new Error("Rabbit 이미지 순서가 올바르지 않습니다."); const imageUrl = row.urls.map(this._text.bind(this)).find(function(value) { return /^https:\/\/[^\s]+$/i.test(value); }); if (!imageUrl) throw new Error("Rabbit 이미지 주소가 유효하지 않습니다."); return { url: imageUrl, headers: { "Referer": referer, "User-Agent": userAgent, "Accept": this.imageAccept } }; }); }
  async _rabbitPages(chapterUrl) { const endpoint = this._rabbitEndpoint(); const health = await this._rabbitJson(endpoint, "/health"); if (!health || health.service !== "rabbit-auth-server" || Number(health.protocol) !== 1) throw new Error("호환되는 Rabbit 인증 서버(protocol v1)가 아닙니다."); if (health.ready !== true) throw new Error("Rabbit 서버가 아직 준비되지 않았습니다."); const opened = await this._rabbitJson(endpoint, "/v1/jobs", { url: chapterUrl, requestId: this._newRequestId(), kind: "images" }); const id = this._text(opened.id); if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Rabbit 작업 번호가 잘못됐습니다."); try { const deadline = Date.now() + 115000; while (Date.now() < deadline) { const state = await this._rabbitJson(endpoint, "/v1/jobs/" + id); if (state.state === "failed") throw new Error("Rabbit 블랙툰 인증 작업이 실패했습니다."); if (state.state === "ready") return this._manifestPages(await this._rabbitJson(endpoint, "/v1/jobs/" + id + "/manifest", {}), id, chapterUrl); await this._pause(750); } throw new Error("Rabbit 인증 시간이 초과됐습니다."); } finally { await this._rabbitJson(endpoint, "/v1/jobs/" + id + "/close", {}, true); } }

  async _directPages(chapterUrl, base) {
    const config = await this._siteConfig(base);
    const document = new Document(await this._getText(chapterUrl, { "Referer": chapterUrl }, "뷰어"));
    const result = [];
    for (const image of document.select("#toon_content_imgs img")) {
      let path = this._text(image.attr("o_src") || image.attr("data-src") || image.attr("src")).trim();
      if (!path) continue;
      path = path.replace(/\[/g, "%5B").replace(/\]/g, "%5D");
      const imageUrl = this._rewriteImageUrl(path, config);
      result.push({ url: imageUrl, headers: { "User-Agent": this.userAgent, "Referer": chapterUrl, "Accept": this.imageAccept } });
    }
    if (!result.length) throw new Error("블랙툰 뷰어에서 이미지를 찾지 못했습니다. 필요할 때만 Rabbit 외부 인증을 켜세요.");
    return result;
  }

  async getPageList(url) { const match = this._text(url).match(/\/webtoons\/\d+\/\d+\.html/i); if (!match) throw new Error("잘못된 블랙툰 회차 주소입니다."); const base = await this._resolveBaseUrl(); const chapterUrl = base + match[0]; return this._rabbitEnabled() ? await this._rabbitPages(chapterUrl) : await this._directPages(chapterUrl, base); }
  getHeaders() {
    const configured = this._normalizeManualBaseUrl(this.cachedBase || this.resolvedBase || (this.source && this.source.baseUrl) || "") || this.fallbackBaseUrl;
    return { "User-Agent": this.userAgent, "Referer": configured + "/", "Accept": this.imageAccept };
  }
  async getVideoList() { return []; }
  async getHtmlContent() { return ""; }
  async cleanHtmlContent(html) { return html; }
  _option(name, value) { return { type_name: "SelectOption", name: name, value: value }; }
  _select(type, name, values) { return { type: type, name: name, type_name: "SelectFilter", values: values }; }

  _advancedFilterList() {
    const o = this._option.bind(this);
    const options = function(pairs) { return [o("선택하세요", "__unset__")].concat(pairs.map(function(pair) { return o(pair[0], pair[1]); })); };
    const separator = function(type) { return { type: type, name: "", type_name: "SeparatorFilter" }; };
    const header = function(type, name) { return { type: type, name: name, type_name: "HeaderFilter" }; };
    const popular = this._tabRule(this.popularRulePreference, this._defaultPopularRule());
    const latest = this._tabRule(this.latestRulePreference, this._defaultLatestRule());
    return [
      separator("sepOngoing"), header("ongoingHeader", "연재"),
      this._select("ongoingWeekday", "요일", options(this.weekdays)), this._select("ongoingGenre", "장르", options(this.genres)), this._select("ongoingPlatform", "플랫폼", options(this.platforms)), this._select("ongoingOrder", "순서", options(this.orders)),
      separator("sepCompleted"), header("completedHeader", "완결"),
      this._select("completedGenre", "장르", options(this.genres)), this._select("completedPlatform", "플랫폼", options(this.platforms)), this._select("completedOrder", "순서", options(this.orders)),
      separator("sepTop"), header("topHeader", "인기"),
      this._select("topBest", "BEST", options(this.bestPeriods)), this._select("topType", "종류", options(this.bestTypes)),
      separator("sepSave"), header("saveHelp", "조건을 고른 뒤 Filter 버튼을 누르면 결과를 보고 Popular/Latest 탭 규칙으로 저장할 수 있습니다."),
      header("popularSummary", "현재 Popular: " + this._ruleSummary(popular)), header("latestSummary", "현재 Latest: " + this._ruleSummary(latest)),
      this._select("tabRuleAction", "Popular/Latest 규칙", [o("저장하지 않음 (필터 결과만 보기)", "0"), o("현재 조건을 Popular 탭에 저장", "1"), o("현재 조건을 Latest 탭에 저장", "2"), o("Popular 탭을 기본값으로 복원", "3"), o("Latest 탭을 기본값으로 복원", "4"), o("두 탭 모두 기본값으로 복원", "5")])
    ];
  }

  _aniyomiFilterList() {
    const o = this._option.bind(this);
    const options = function(pairs) { return pairs.map(function(pair) { return o(pair[0], pair[1]); }); };
    const separator = function(type) { return { type: type, name: "", type_name: "SeparatorFilter" }; };
    const header = function(type, name) { return { type: type, name: name, type_name: "HeaderFilter" }; };
    const popular = this._tabRule(this.popularRulePreference, this._defaultPopularRule());
    const latest = this._tabRule(this.latestRulePreference, this._defaultLatestRule());
    return [
      header("simpleHelp", "목록 종류에 맞지 않는 조건은 자동으로 무시됩니다."),
      this._select("simpleListType", "목록 종류", options(this.listTypes)),
      separator("simpleSepOngoing"), header("simpleOngoingHeader", "연재 조건"),
      this._select("simpleWeekday", "요일 (연재 전용)", options(this.weekdays)),
      separator("simpleSepCommon"), header("simpleCommonHeader", "연재·완결 공통 조건"),
      this._select("simplePlatform", "플랫폼 (연재·완결 전용)", options(this.platforms)),
      this._select("simpleGenre", "장르 (연재·완결 전용)", options(this.genres)),
      this._select("simpleContentScope", "콘텐츠 범위 (연재·완결 전용)", options(this.contentScopes)),
      this._select("simpleOrder", "정렬 (연재·완결 전용)", options(this.orders)),
      separator("simpleSepTop"), header("simpleTopHeader", "인기 조건"),
      this._select("simpleTopBest", "인기 기간 (인기 전용)", options(this.bestPeriods)),
      this._select("simpleTopType", "인기 분류 (인기 전용)", options(this.bestTypes)),
      separator("simpleSepSave"), header("simpleSaveHelp", "조건을 고른 뒤 Filter를 누르면 저장됩니다."),
      header("simplePopularSummary", "현재 Popular: " + this._ruleSummary(popular)), header("simpleLatestSummary", "현재 Latest: " + this._ruleSummary(latest)),
      this._select("tabRuleAction", "Popular/Latest 규칙", [o("저장하지 않음 (필터 결과만 보기)", "0"), o("현재 조건을 Popular 탭에 저장", "1"), o("현재 조건을 Latest 탭에 저장", "2"), o("Popular 탭을 기본값으로 복원", "3"), o("Latest 탭을 기본값으로 복원", "4"), o("두 탭 모두 기본값으로 복원", "5")])
    ];
  }

  getFilterList() { return this._filterMode() === "advanced" ? this._advancedFilterList() : this._aniyomiFilterList(); }

  getSourcePreferences() {
    return [
      { key: "blacktoon_domain_url", editTextPreference: { title: "블랙툰 주소 직접 지정", summary: "값이 있으면 수동 주소가 1순위입니다. 빈 값이면 중앙신호등 주소를 1순위로 사용합니다. 예: https://blacktoon423.com / blacktoon423.com / 423", value: "", dialogTitle: "블랙툰 주소 직접 지정", dialogMessage: "전체 주소 또는 번호를 입력하세요. 중앙신호등 자동 주소를 사용하려면 빈 값으로 두세요." } },
      { key: "blacktoon_rabbit_enabled", switchPreferenceCompat: { title: "Rabbit 외부 인증 서버 사용", summary: "기본은 꺼짐. 직접 뷰어가 실패할 때만 켜세요.", value: false } },
      { key: "blacktoon_rabbit_endpoint", editTextPreference: { title: "Rabbit 서버 주소", summary: "Windows: localhost 가능 / iOS: LAN 또는 Tailscale 주소", value: "", dialogTitle: "예: http://192.168.0.10:9870", dialogMessage: "" } },
      { key: "blacktoon_rabbit_access_key", editTextPreference: { title: "Rabbit 접속 키", summary: "서버에 키를 설정한 경우만 입력", value: "", dialogTitle: "접속 키", dialogMessage: "" } },
      { key: "blacktoon_custom_card_json_url", editTextPreference: { title: "커스텀 목록 카드", summary: "공개 JSON 주소 하나로 요일별 목록 카드를 설정합니다. 360×540 이미지를 권장하며 용량·프레임 제한은 없습니다.", value: "", dialogTitle: "커스텀 목록 카드 JSON 주소", dialogMessage: "Google Drive 공개 공유 링크 또는 직접 JSON 주소를 넣으세요. 개인 카드를 설정하면 공용 이벤트 카드는 표시되지 않습니다. 빈 값이면 공용 이벤트 또는 기본 망가 요일 카드를 사용합니다." } },
      { key: "blacktoon_filter_mode", listPreference: { title: "필터 탭 방식", summary: "애니요미 방식은 목록 종류 하나를 고르는 간단 필터입니다. 기존 망가요미 방식은 연재·완결·인기를 구역별로 설정하는 고급 필터입니다. 변경 후 필터 화면을 다시 여세요.", valueIndex: 0, entries: ["애니요미 방식 (간단)", "기존 망가요미 방식 (고급)"], entryValues: ["aniyomi", "advanced"] } }
    ];
  }
}

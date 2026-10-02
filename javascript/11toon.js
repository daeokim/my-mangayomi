const mangayomiSources = [{
  name: "11toon \uB9CC\uD654",
  lang: "ko",
  baseUrl: "https://11toon.com",
  apiUrl: "",
  iconUrl: "https://dc-toki-mangayomi-manga.pages.dev/icon/ko.toon11.png",
  typeSource: "single",
  itemType: 0,
  isNsfw: true,
  hasCloudflare: false,
  version: "0.1.13",
  dateFormat: "yyyy.MM.dd",
  dateFormatLocale: "ko_KR",
  pkgPath: "manga/src/ko/toon11.js"
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
    this.fallbackBaseUrl = "https://11toon.com";
    this.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
    this.imageAccept = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
    this.popularCardUrl = "https://dc-toki-mangayomi-manga.pages.dev/card/toon11-daily-100.gif";
    this.latestCardUrl = "https://dc-toki-mangayomi-manga.pages.dev/card/toon11-hot-new.gif";
    this.popularRulePreference = "toon11_popular_rule_v1";
    this.latestRulePreference = "toon11_latest_rule_v1";
    this.chapterPageCacheRevision = "0112";
    this.latestGenres = ["", "SF", "무협", "TS", "개그", "드라마", "러브코미디", "먹방", "백합", "붕탁", "스릴러", "스포츠", "시대", "액션", "순정", "일상 치유", "추리", "판타지", "학원", "호러", "BL", "17", "이세계", "전생", "라노벨", "애니화", "TL", "공포", "하렘", "요리"];
    this.rankedGenres = ["", "BL", "러브코미디", "17", "판타지", "순정", "드라마", "학원", "게임", "SF", "스릴러", "먹방", "TS", "스포츠", "이세계", "추리", "일상", "라노벨", "백합", "시대", "애니화", "전생", "붕탁", "무협", "호러", "공포"];
    this.zipTypes = ["", "todayhit", "isover"];
    this.pageStates = {};
    this.requestSequence = 0;
  }

  _text(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  _trimSlash(value) {
    return this._text(value).trim().replace(/\/+$/, "");
  }

  _preference(key, fallback) {
    try {
      const value = new SharedPreferences().get(key);
      return value === null || value === undefined ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  _preferenceString(key, fallback) {
    try {
      const value = new SharedPreferences().getString(key, fallback);
      return value === null || value === undefined ? fallback : this._text(value);
    } catch (_) {
      return fallback;
    }
  }

  _driveDirect(url, image) {
    const source = this._text(url).trim();
    const match = source.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
    return match ? "https://drive.google.com/uc?export=" + (image ? "view" : "download") + "&id=" + match[1] : source;
  }

  async _customCardUrl(slug) {
    const source = this._text(this._preference("toon11_custom_card_json_url", "")).trim();
    if (!source) return "";
    const preferences = new SharedPreferences();
    const cacheKey = "toon11_custom_card_cache", sourceKey = cacheKey + "_source", timeKey = cacheKey + "_time";
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

  _koreaWeekdaySlug() {
    return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCDay()];
  }

  _defaultPopularRule() {
    return { listType: 3, latestGenre: "", rankedGenre: "", zipType: "" };
  }

  _defaultLatestRule() {
    return { listType: 4, latestGenre: "", rankedGenre: "", zipType: "" };
  }

  _normalizeRule(rule, fallback) {
    const base = fallback || this._defaultLatestRule();
    const source = rule || {};
    const listType = Number(source.listType);
    if (!Number.isInteger(listType) || listType < 0 || listType > 4) {
      return this._normalizeRule(base, this._defaultLatestRule());
    }
    const normalized = { listType: listType, latestGenre: "", rankedGenre: "", zipType: "" };
    if (listType === 0) {
      const genre = this._text(source.latestGenre);
      normalized.latestGenre = this.latestGenres.indexOf(genre) >= 0 ? genre : "";
    } else if (listType === 1 || listType === 2) {
      const genre = this._text(source.rankedGenre);
      normalized.rankedGenre = this.rankedGenres.indexOf(genre) >= 0 ? genre : "";
    } else if (listType === 4) {
      const zipType = this._text(source.zipType);
      normalized.zipType = this.zipTypes.indexOf(zipType) >= 0 ? zipType : "";
    }
    return normalized;
  }

  _encodeRule(rule) {
    const normalized = this._normalizeRule(rule, this._defaultLatestRule());
    return [normalized.listType, normalized.latestGenre, normalized.rankedGenre, normalized.zipType].join("|");
  }

  _decodeRule(value, fallback) {
    const parts = this._text(value).split("|");
    if (parts.length !== 4 || !/^\d+$/.test(parts[0])) return this._normalizeRule(fallback, this._defaultLatestRule());
    return this._normalizeRule({
      listType: Number(parts[0]),
      latestGenre: parts[1],
      rankedGenre: parts[2],
      zipType: parts[3]
    }, fallback);
  }

  _savedRule(key, fallback) {
    return this._decodeRule(this._preferenceString(key, ""), fallback);
  }

  _ruleEquals(first, second) {
    return this._encodeRule(first) === this._encodeRule(second);
  }

  _ruleSummary(rule) {
    const normalized = this._normalizeRule(rule, this._defaultLatestRule());
    const genreName = function(value) { return value ? (value === "일상 치유" ? "일상+치유" : value) : "전체"; };
    if (normalized.listType === 0) return "최신만화 / " + genreName(normalized.latestGenre);
    if (normalized.listType === 1) return "인기만화 / " + genreName(normalized.rankedGenre);
    if (normalized.listType === 2) return "완결만화 / " + genreName(normalized.rankedGenre);
    if (normalized.listType === 3) return "매일 추천 100";
    const zipNames = { "": "핫신작", "todayhit": "매일 TOP 35", "isover": "완결" };
    return "요청 Zip / " + zipNames[normalized.zipType];
  }

  _applyTabRuleAction(page, filters, rule) {
    if (Number(page) !== 1) return;
    const action = Number(this._filterValue(filters, "tabRuleAction", "0"));
    const preferences = new SharedPreferences();
    if (action === 1) preferences.setString(this.popularRulePreference, this._encodeRule(rule));
    else if (action === 2) preferences.setString(this.latestRulePreference, this._encodeRule(rule));
    else if (action === 3) preferences.setString(this.popularRulePreference, "");
    else if (action === 4) preferences.setString(this.latestRulePreference, "");
    else if (action === 5) {
      preferences.setString(this.popularRulePreference, "");
      preferences.setString(this.latestRulePreference, "");
    }
  }

  _isAllowedBaseUrl(value) {
    return /^https:\/\/(?:www\.)?11toon\d*\.com\/?$/i.test(this._text(value).trim());
  }

  async _resolveBaseUrl() {
    const manual = this._text(this._preference("toon11_domain_url", "")).trim();
    if (this._isAllowedBaseUrl(manual)) return this._trimSlash(manual);
    try {
      const response = await new Client({ useDartHttpClient: true, persistentConnection: false }).get(this.signalUrl, {
        "User-Agent": this.userAgent,
        "Accept": "application/json",
        "Cache-Control": "no-cache"
      });
      if (response.statusCode >= 200 && response.statusCode < 300) {
        const data = JSON.parse(response.body);
        const candidate = data && data.domains && data.domains["11toon"]
          ? data.domains["11toon"].baseUrl
          : "";
        if (this._isAllowedBaseUrl(candidate)) return this._trimSlash(candidate);
      }
    } catch (_) {}
    const configured = this.source && this.source.baseUrl ? this.source.baseUrl : "";
    return this._isAllowedBaseUrl(configured) ? this._trimSlash(configured) : this.fallbackBaseUrl;
  }

  _origin(value) {
    const match = this._text(value).match(/^(https?:\/\/[^/]+)/i);
    return match ? match[1] : "";
  }

  _relativePath(value) {
    let raw = this._text(value).trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) raw = raw.replace(/^https?:\/\/[^/]+/i, "");
    if (!raw.startsWith("/")) raw = "/" + raw;
    return raw;
  }

  _absoluteUrl(base, value) {
    const raw = this._text(value).trim();
    if (!raw) return "";
    if (raw.startsWith("//")) return "https:" + raw;
    if (/^https?:\/\//i.test(raw)) {
      if (/^https?:\/\/(?:www\.)?11toon\d*\.com/i.test(raw)) return base + this._relativePath(raw);
      return raw;
    }
    return base + this._relativePath(raw);
  }

  _withQuery(base, path, pairs) {
    const query = [];
    for (const pair of pairs) {
      if (!pair || pair.length < 2 || this._text(pair[1]) === "") continue;
      query.push(encodeURIComponent(pair[0]) + "=" + encodeURIComponent(this._text(pair[1])));
    }
    return base + path + (query.length ? "?" + query.join("&") : "");
  }

  _queryParam(value, name) {
    const match = this._text(value).match(new RegExp("[?&]" + name + "=([^&#'\\\"]*)", "i"));
    if (!match) return "";
    try { return decodeURIComponent(match[1].replace(/\+/g, " ")); } catch (_) { return match[1]; }
  }

  _safeUrl(value) {
    return this._text(value).replace(/([?&](?:stx)=)[^&#]*/gi, "$1***");
  }

  _failureCode(response, cause) {
    const status = response && response.statusCode ? Number(response.statusCode) : 0;
    if (status) return "HTTP" + status;
    const text = this._text(cause && (cause.message || cause));
    if (/10054|ECONNRESET|ConnectionReset|connection reset/i.test(text)) return "RESET";
    if (/timed?\s*out|timeout/i.test(text)) return "TIMEOUT";
    if (/certificate|handshake|TLS|SSL/i.test(text)) return "TLS";
    return "NETWORK";
  }

  _isChallenge(body) {
    const text = this._text(body);
    return /cdn-cgi\/challenge-platform|cf-chl-|<title>\s*Just a moment/i.test(text);
  }

  _log(stage, transport, code, url) {
    try { console.warn("[11TOON] stage=" + stage + " transport=" + transport + " code=" + code + " url=" + this._safeUrl(url)); } catch (_) {}
  }

  async _getText(url, extraHeaders, stage) {
    const headers = {
      "User-Agent": this.userAgent,
      "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "Referer": (this._origin(url) || this.fallbackBaseUrl) + "/"
    };
    if (extraHeaders) Object.assign(headers, extraHeaders);
    const failures = [];
    const transports = [
      { name: "RHTTP", options: { persistentConnection: false, noProxy: true, timeout: 24, connectTimeout: 10 } },
      { name: "DART", options: { useDartHttpClient: true, persistentConnection: false } }
    ];
    for (const transport of transports) {
      try {
        const response = await new Client(transport.options).get(url, headers);
        if (response.statusCode >= 200 && response.statusCode < 300 && !this._isChallenge(response.body)) {
          return response.body;
        }
        const code = this._isChallenge(response.body) ? "CHALLENGE" : this._failureCode(response, null);
        failures.push(transport.name + "=" + code);
        this._log(stage || "request", transport.name, code, url);
      } catch (error) {
        const code = this._failureCode(null, error);
        failures.push(transport.name + "=" + code);
        this._log(stage || "request", transport.name, code, url);
      }
    }
    throw new Error("11toon direct request failed. " + failures.join(",") + " | " + this._safeUrl(url));
  }

  _normalizeSearch(value) {
    let text = this._text(value);
    try { text = text.normalize("NFKC"); } catch (_) {}
    return text.trim().replace(/\s+/g, " ");
  }

  _searchKey(value) {
    return this._normalizeSearch(value).toLowerCase().replace(/[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000,\.\u00b7\u30fb\-\u2010-\u2015\(\)\[\]\{\}\uff08\uff09]+/g, "");
  }

  _searchChunks(value) {
    const key = this._searchKey(value).replace(/[^0-9a-z\u3131-\u318e\uac00-\ud7a3]/gi, "");
    const result = [];
    for (const width of [3, 2]) {
      if (key.length < width) continue;
      for (let index = 0; index <= key.length - width; index++) {
        const chunk = key.slice(index, index + width);
        if (result.indexOf(chunk) < 0) result.push(chunk);
        if (result.length >= 6) return result;
      }
    }
    return result;
  }

  _chapterDate(value) {
    const match = this._text(value).match(/(\d{2,4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
    if (!match) return "0";
    let year = Number(match[1]);
    if (year < 100) year += 2000;
    const time = Date.UTC(year, Number(match[2]) - 1, Number(match[3])) - 9 * 60 * 60 * 1000;
    return Number.isFinite(time) ? String(time) : "0";
  }

  _listThumbnail(base, row) {
    const thumb = row.selectFirst(".homelist-thumb");
    if (!thumb) return "";
    const mobile = this._text(thumb.attr("data-mobile-image")).trim();
    if (mobile) return this._absoluteUrl(base, mobile);
    const style = this._text(thumb.attr("style"));
    const match = style.match(/url\(['\"]?([^'\")]+)[\"']?\)/i);
    return match ? this._absoluteUrl(base, match[1]) : "";
  }

  _explicitNext(document, currentPage) {
    let next = document.selectFirst("a.pg_next[href]");
    if (next) {
      const page = Number(this._queryParam(next.attr("href"), "page"));
      if (Number.isFinite(page) && page > currentPage) return true;
    }
    for (const link of document.select("nav.pg_wrap a.pg_page[href], span.pg a.pg_page[href]")) {
      const page = Number(this._queryParam(link.attr("href"), "page"));
      if (Number.isFinite(page) && page === currentPage + 1) return true;
    }
    return false;
  }

  _parseList(document, base, currentPage) {
    const list = [];
    const seen = {};
    for (const row of document.select("li[data-id]")) {
      const id = this._text(row.attr("data-id")).trim();
      if (!/^\d+$/.test(id) || seen[id]) continue;
      const titleNode = row.selectFirst(".homelist-title");
      const name = this._text(titleNode ? titleNode.text : "").trim();
      if (!name) continue;
      list.push({
        name: name,
        link: "/bbs/board.php?bo_table=toons&is=" + id,
        imageUrl: this._listThumbnail(base, row)
      });
      seen[id] = true;
    }
    return { list: list, hasNextPage: this._explicitNext(document, currentPage) };
  }

  _guardPagination(routeKey, page, parsed) {
    if (page <= 1 || !this.pageStates[routeKey]) {
      this.pageStates[routeKey] = { fingerprints: {}, seen: {} };
    }
    const state = this.pageStates[routeKey];
    const fingerprint = parsed.list.map(function(item) { return item.link; }).sort().join("|");
    if (fingerprint && state.fingerprints[fingerprint] !== undefined && state.fingerprints[fingerprint] !== page) {
      return { list: [], hasNextPage: false };
    }
    if (fingerprint) state.fingerprints[fingerprint] = page;
    const unique = [];
    for (const item of parsed.list) {
      if (state.seen[item.link]) continue;
      state.seen[item.link] = true;
      unique.push(item);
    }
    if (page > 1 && !unique.length) return { list: [], hasNextPage: false };
    return { list: unique, hasNextPage: parsed.hasNextPage === true && unique.length > 0 };
  }

  _listUrl(base, rule, page) {
    const normalized = this._normalizeRule(rule, this._defaultLatestRule());
    const type = normalized.listType;
    const pairs = [["bo_table", "toon_c"]];
    if (type === 0) {
      pairs.push(["type", "upd"], ["tablename", "최신만화"]);
      if (normalized.latestGenre) pairs.push(["sca", normalized.latestGenre]);
    } else if (type === 1) {
      if (normalized.rankedGenre) pairs.push(["sca", normalized.rankedGenre]);
      pairs.push(["tablename", "인기만화"]);
    } else if (type === 2) {
      if (normalized.rankedGenre) pairs.push(["sca", normalized.rankedGenre]);
      pairs.push(["is_over", "1"], ["tablename", "완결만화"]);
    } else if (type === 3) {
      pairs.push(["type", "today"], ["tablename", "매일 추천 100"]);
    } else {
      pairs.push(["type", "invite"], ["tablename", "요청 Zip"]);
      if (normalized.zipType) pairs.push(["types", normalized.zipType]);
    }
    if (page > 1) pairs.push(["page", page]);
    return this._withQuery(base, "/bbs/board.php", pairs);
  }

  async _list(page, rule) {
    const base = await this._resolveBaseUrl();
    const url = this._listUrl(base, rule, page);
    const parsed = this._parseList(new Document(await this._getText(url, null, "list")), base, page);
    const routeKey = url.replace(/([?&])page=\d+(&|$)/i, function(_, lead, tail) { return tail ? lead : ""; });
    return this._guardPagination(routeKey, page, parsed);
  }

  getHeaders(url) {
    return {
      "User-Agent": this.userAgent,
      "Referer": (this._origin(url) || this.fallbackBaseUrl) + "/",
      "Accept": this.imageAccept
    };
  }

  async _tabCard(kind) {
    const popular = kind === "popular";
    const customSource = this._text(this._preference("toon11_custom_card_json_url", "")).trim();
    const customImage = await this._customCardUrl(this._koreaWeekdaySlug());
    const event = customSource ? null : await dcOfficialEventCard();
    const official = customImage || event ? null : await dcOfficialListCardSystem("toon11", kind, "오늘의 만화");
    return {
      name: customImage ? (popular ? "매일 추천 100!" : "핫신작") : event ? event.name : official.name,
      link: "/__toon11_tab_card__/" + (popular ? "popular" : "latest"),
      imageUrl: customImage || (event && event.imageUrl) || official.imageUrl
    };
  }

  async _prependDefaultTabCard(result, page, rule, kind) {
    const expected = kind === "popular" ? this._defaultPopularRule() : this._defaultLatestRule();
    if (Number(page) !== 1 || !this._ruleEquals(rule, expected)) return result;
    return { list: [await this._tabCard(kind)].concat(result.list || []), hasNextPage: result.hasNextPage === true };
  }

  async getPopular(page) {
    const rule = this._savedRule(this.popularRulePreference, this._defaultPopularRule());
    return this._prependDefaultTabCard(await this._list(page, rule), page, rule, "popular");
  }

  async getLatestUpdates(page) {
    const rule = this._savedRule(this.latestRulePreference, this._defaultLatestRule());
    return this._prependDefaultTabCard(await this._list(page, rule), page, rule, "latest");
  }

  _filterValue(filters, type, fallback) {
    if (!Array.isArray(filters)) return fallback;
    for (const filter of filters) {
      if (!filter || filter.type !== type || !Array.isArray(filter.values)) continue;
      const index = Number(filter.state) || 0;
      const option = filter.values[index];
      return option && option.value !== undefined ? this._text(option.value) : fallback;
    }
    return fallback;
  }

  _filterRule(filters) {
    const unset = "__unset__";
    const selected = [];
    const latestGenre = this._filterValue(filters, "latestGenre", unset);
    const popularGenre = this._filterValue(filters, "popularGenre", unset);
    const completedGenre = this._filterValue(filters, "completedGenre", unset);
    const zipType = this._filterValue(filters, "zipType", unset);
    if (latestGenre !== unset) selected.push({ listType: 0, latestGenre: latestGenre, rankedGenre: "", zipType: "" });
    if (popularGenre !== unset) selected.push({ listType: 1, latestGenre: "", rankedGenre: popularGenre, zipType: "" });
    if (completedGenre !== unset) selected.push({ listType: 2, latestGenre: "", rankedGenre: completedGenre, zipType: "" });
    if (zipType !== unset) selected.push({ listType: 4, latestGenre: "", rankedGenre: "", zipType: zipType });
    if (selected.length > 1) throw new Error("11toon 필터는 최신·인기·완결·요청 Zip 중 한 구역만 선택하세요.");
    return selected.length ? this._normalizeRule(selected[0], this._defaultLatestRule()) : null;
  }

  async _searchOnce(base, query) {
    const url = this._withQuery(base, "/bbs/search_stx.php", [["stx", query]]);
    const parsed = this._parseList(new Document(await this._getText(url, null, "search")), base, 1);
    return { list: parsed.list, hasNextPage: false };
  }

  async search(query, page, filters) {
    const normalized = this._normalizeSearch(query);
    if (normalized) {
      if (page > 1) return { list: [], hasNextPage: false };
      const base = await this._resolveBaseUrl();
      const wanted = this._searchKey(normalized);
      if (!wanted) return { list: [], hasNextPage: false };
      const attempts = [normalized];
      const compact = this._searchKey(normalized);
      if (compact && attempts.indexOf(compact) < 0) attempts.push(compact);
      const found = [];
      const seen = {};
      for (const attempt of attempts) {
        const result = await this._searchOnce(base, attempt);
        for (const manga of result.list) {
          if (!seen[manga.link] && this._searchKey(manga.name).indexOf(wanted) >= 0) {
            found.push(manga);
            seen[manga.link] = true;
          }
        }
        if (found.length) return { list: found, hasNextPage: false };
      }
      for (const chunk of this._searchChunks(normalized)) {
        if (attempts.indexOf(chunk) >= 0) continue;
        const result = await this._searchOnce(base, chunk);
        for (const manga of result.list) {
          if (!seen[manga.link] && this._searchKey(manga.name).indexOf(wanted) >= 0) {
            found.push(manga);
            seen[manga.link] = true;
          }
        }
      }
      return { list: found, hasNextPage: false };
    }
    const action = Number(this._filterValue(filters, "tabRuleAction", "0"));
    let rule = this._filterRule(filters);
    if (!rule && action >= 3 && action <= 5) {
      rule = action === 3 ? this._defaultPopularRule() : this._defaultLatestRule();
    }
    if (!rule) throw new Error("11toon 필터에서 최신·인기·완결·요청 Zip 중 사용할 항목을 선택하세요.");
    this._applyTabRuleAction(page, filters, rule);
    return await this._list(page, rule);
  }

  _detailId(url) {
    const id = this._queryParam(url, "is");
    if (!/^\d+$/.test(id)) throw new Error("Invalid 11toon manga URL.");
    return id;
  }

  _detailPageUrl(base, id, page) {
    return this._withQuery(base, "/bbs/board.php", [
      ["bo_table", "toons"], ["is", id], ["page", page > 1 ? page : ""]
    ]);
  }

  _parseChapterNode(node, mangaId) {
    const outerHtml = this._text(node ? node.outerHtml : "");
    let target = this._text(node ? node.attr("onclick") : "");
    if (!target || target.indexOf("wr_id=") < 0) target = outerHtml;
    target = target.replace(/&amp;/gi, "&");
    const chapterId = this._queryParam(target, "wr_id");
    const id = this._queryParam(target, "is") || mangaId;
    if (!/^\d+$/.test(chapterId) || !/^\d+$/.test(id)) return null;
    const title = node.selectFirst(".episode-title");
    const date = node.selectFirst(".free-date");
    const name = this._text(title ? title.text : "").trim() || ("Chapter " + chapterId);
    return {
      name: name,
      url: "/bbs/board.php?bo_table=toons&wr_id=" + chapterId + "&is=" + id + "#extrev=" + this.chapterPageCacheRevision,
      dateUpload: this._chapterDate(date ? date.text : "")
    };
  }

  _chapterMaxPage(document) {
    let max = 1;
    for (const link of document.select("nav.pg_wrap a[href*='page='], span.pg a[href*='page=']")) {
      const page = Number(this._queryParam(link.attr("href"), "page"));
      if (Number.isFinite(page) && page > max && page <= 500) max = page;
    }
    return max;
  }

  _parseChapters(document, mangaId) {
    const result = [];
    const seen = {};
    const chapterList = document.getElementById("comic-episode-list");
    let nodes = chapterList.getElementsByTagName("button");
    if (!nodes.length) nodes = document.getElementsByTagName("button");
    for (const node of nodes) {
      const chapter = this._parseChapterNode(node, mangaId);
      if (!chapter || seen[chapter.url]) continue;
      seen[chapter.url] = true;
      result.push(chapter);
    }
    return result;
  }

  async getDetail(url) {
    const cardMatch = this._text(url).match(/\/__toon11_tab_card__\/(popular|latest)/);
    if (cardMatch) {
      const card = await this._tabCard(cardMatch[1]);
      return {
        name: card.name,
        link: card.link,
        imageUrl: card.imageUrl,
        author: "11toon",
        description: "목록을 안내하는 움직이는 카드입니다. 뒤로 돌아가 작품을 선택해 주세요.",
        genre: ["목록 안내"],
        status: 0,
        episodes: [],
        chapters: []
      };
    }
    const base = await this._resolveBaseUrl();
    const mangaId = this._detailId(url);
    const detailUrl = this._detailPageUrl(base, mangaId, 1);
    const firstDocument = new Document(await this._getText(detailUrl, null, "detail"));
    const titleNode = firstDocument.selectFirst("h2.title");
    const banner = firstDocument.selectFirst("img.banner");
    const description = firstDocument.selectFirst("span:contains(\uC18C\uAC1C) + span");
    const author = firstDocument.selectFirst("span:contains(\uC791\uAC00) + span");
    const genre = firstDocument.selectFirst("span:contains(\uC7A5\uB974) + span");
    const statusNode = firstDocument.selectFirst("span:contains(\uBD84\uB958) + span");

    const episodes = [];
    const seen = {};
    const pageFingerprints = {};
    const maxPage = this._chapterMaxPage(firstDocument);
    for (let chapterPage = 1; chapterPage <= maxPage; chapterPage++) {
      const document = chapterPage === 1
        ? firstDocument
        : new Document(await this._getText(this._detailPageUrl(base, mangaId, chapterPage), null, "chapters"));
      const rows = this._parseChapters(document, mangaId);
      const fingerprint = rows.map(function(chapter) { return chapter.url; }).sort().join("|");
      if (!fingerprint || pageFingerprints[fingerprint]) break;
      pageFingerprints[fingerprint] = true;
      let added = 0;
      for (const chapter of rows) {
        if (seen[chapter.url]) continue;
        seen[chapter.url] = true;
        episodes.push(chapter);
        added++;
      }
      if (!added) break;
    }

    if (!episodes.length) {
      throw new Error("11toon chapter rows were not found; refusing to report 0 chapters.");
    }

    const statusText = this._text(statusNode ? statusNode.text : "");
    return {
      name: this._text(titleNode ? titleNode.text : "").trim(),
      link: "/bbs/board.php?bo_table=toons&is=" + mangaId,
      imageUrl: this._absoluteUrl(base, banner ? banner.attr("src") : ""),
      author: this._text(author ? author.text : "").trim(),
      description: this._text(description ? description.text : "").trim(),
      genre: this._text(genre ? genre.text : "").split(",").map(function(value) { return value.trim(); }).filter(Boolean),
      status: statusText.indexOf("\uC644\uACB0") >= 0 ? 1 : 0,
      episodes: episodes,
      chapters: episodes
    };
  }

  _rabbitEnabled() {
    const value = this._preference("toon11_rabbit_enabled", false);
    return value === true || this._text(value).toLowerCase() === "true" || this._text(value) === "1";
  }

  _rabbitEndpoint() {
    const raw = this._trimSlash(this._preference("toon11_rabbit_endpoint", ""));
    if (!raw) throw new Error("Rabbit server address is empty.");
    if (!/^https?:\/\/(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.test(raw)) {
      throw new Error("Invalid Rabbit server address. Example: http://192.168.0.10:9870");
    }
    return raw;
  }

  _rabbitHeaders(jsonBody) {
    const headers = { "Accept": "application/json", "X-Lab-Request": "1" };
    if (jsonBody) headers["Content-Type"] = "application/json";
    const key = this._text(this._preference("toon11_rabbit_access_key", "")).trim();
    if (key) headers.Authorization = "Bearer " + key;
    return headers;
  }

  async _rabbitJson(endpoint, path, body, ignoreFailure) {
    try {
      const response = body === undefined
        ? await new Client().get(endpoint + path, this._rabbitHeaders(false))
        : await new Client().post(endpoint + path, this._rabbitHeaders(true), body);
      if (response.statusCode === 401 || response.statusCode === 403) throw new Error("Rabbit access key is invalid.");
      if (response.statusCode < 200 || response.statusCode >= 300) {
        if (ignoreFailure) return {};
        let code = "";
        try { code = this._text(JSON.parse(response.body).error); } catch (_) {}
        throw new Error("Rabbit request failed (HTTP " + response.statusCode + (code ? ", " + code : "") + ").");
      }
      return JSON.parse(response.body);
    } catch (error) {
      if (ignoreFailure) return {};
      if (error && error.message && error.message.indexOf("Rabbit") >= 0) throw error;
      throw new Error("Cannot connect to Rabbit server. Check address, port, firewall, LAN or Tailscale.");
    }
  }

  _newRequestId() {
    this.requestSequence++;
    const randomA = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
    const randomB = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
    let seed = Date.now().toString(16).padStart(12, "0") + randomA + randomB + this.requestSequence.toString(16).padStart(4, "0");
    seed = (seed + "00000000000000000000000000000000").slice(0, 32);
    return seed.slice(0, 8) + "-" + seed.slice(8, 12) + "-4" + seed.slice(13, 16) + "-a" + seed.slice(17, 20) + "-" + seed.slice(20, 32);
  }

  async _pause(milliseconds) {
    if (typeof setTimeout !== "function") return;
    await new Promise(function(resolve) { setTimeout(resolve, milliseconds); });
  }

  _manifestPages(manifest, id, chapterUrl) {
    if (!manifest || this._text(manifest.id) !== id || this._text(manifest.chapterUrl) !== chapterUrl) {
      throw new Error("Rabbit result does not match the requested chapter.");
    }
    const rows = manifest.pages;
    const expected = Number(manifest.expected);
    if (!Array.isArray(rows) || !rows.length || rows.length > 2000 || expected !== rows.length) {
      throw new Error("Rabbit returned an incomplete image list.");
    }
    const referer = this._text(manifest.referer).trim();
    const userAgent = this._text(manifest.userAgent).trim();
    if (!referer || !userAgent) throw new Error("Rabbit image headers are incomplete.");
    const result = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (!row || Number(row.page) !== index + 1 || !Array.isArray(row.urls)) throw new Error("Rabbit image order is invalid.");
      let imageUrl = "";
      for (const candidate of row.urls) {
        if (/^https:\/\/[^\s]+$/i.test(this._text(candidate))) { imageUrl = this._text(candidate); break; }
      }
      if (!imageUrl) throw new Error("Rabbit returned an invalid image URL.");
      result.push({ url: imageUrl, headers: { "Referer": referer, "User-Agent": userAgent, "Accept": this.imageAccept } });
    }
    return result;
  }

  async _rabbitPages(chapterUrl) {
    const endpoint = this._rabbitEndpoint();
    const health = await this._rabbitJson(endpoint, "/health");
    if (!health || health.service !== "rabbit-auth-server" || Number(health.protocol) !== 1) {
      throw new Error("Rabbit Auth Server protocol v1 is required.");
    }
    if (health.ready !== true) throw new Error("Rabbit server is not ready.");
    const requestId = this._newRequestId();
    const opened = await this._rabbitJson(endpoint, "/v1/jobs", { url: chapterUrl, requestId: requestId, kind: "images" });
    const id = this._text(opened.id);
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Rabbit returned an invalid job ID.");
    try {
      const deadline = Date.now() + 115000;
      while (Date.now() < deadline) {
        const state = await this._rabbitJson(endpoint, "/v1/jobs/" + id);
        if (state.state === "failed") throw new Error("Rabbit 11toon job failed.");
        if (state.state === "ready") {
          const manifest = await this._rabbitJson(endpoint, "/v1/jobs/" + id + "/manifest", {});
          return this._manifestPages(manifest, id, chapterUrl);
        }
        await this._pause(750);
      }
      throw new Error("Rabbit authentication timed out after 115 seconds.");
    } finally {
      await this._rabbitJson(endpoint, "/v1/jobs/" + id + "/close", {}, true);
    }
  }

  _extractImageArray(html, variableName) {
    const expression = new RegExp(variableName + "\\s*=\\s*(\\[[\\s\\S]*?\\])", "i");
    const match = this._text(html).match(expression);
    if (!match) return [];
    try {
      const rows = JSON.parse(match[1]);
      return Array.isArray(rows) ? rows : [];
    } catch (_) {
      return [];
    }
  }

  _responseHeader(response, name) {
    const headers = response && response.headers ? response.headers : {};
    const wanted = this._text(name).toLowerCase();
    for (const key of Object.keys(headers)) {
      if (this._text(key).toLowerCase() === wanted) return this._text(headers[key]);
    }
    return "";
  }

  async _probeImage(url, chapterUrl) {
    const target = this._text(url).trim();
    if (!/^https:\/\/[^\s]+$/i.test(target)) return false;
    const headers = {
      "User-Agent": this.userAgent,
      "Referer": chapterUrl,
      "Accept": this.imageAccept,
      "Range": "bytes=0-0"
    };
    const transports = [
      { persistentConnection: false, noProxy: true, timeout: 7, connectTimeout: 4 },
      { useDartHttpClient: true, persistentConnection: false, timeout: 7, connectTimeout: 4 }
    ];
    for (const options of transports) {
      try {
        const response = await new Client(options).get(target, headers);
        const status = Number(response && response.statusCode || 0);
        const contentType = this._responseHeader(response, "content-type").toLowerCase();
        if (status >= 200 && status < 300 && (!contentType || contentType.indexOf("image/") === 0 || contentType.indexOf("octet-stream") >= 0)) return true;
        if (status === 404 || status === 410) return false;
      } catch (_) {}
    }
    return false;
  }

  _mirrorProbeIndexes(count) {
    if (count <= 1) return [0];
    const values = [0, 1, Math.floor(count / 2), count - 1];
    const result = [];
    for (const value of values) if (value >= 0 && value < count && result.indexOf(value) < 0) result.push(value);
    return result.length ? result : [0];
  }

  async _probeImageIndexes(rows, indexes, chapterUrl, concurrency) {
    const checks = {};
    let cursor = 0;
    const limit = Math.max(1, Math.min(Number(concurrency) || 4, indexes.length || 1));
    const worker = async () => {
      while (cursor < indexes.length) {
        const position = cursor++;
        const index = indexes[position];
        checks[index] = await this._probeImage(this._absoluteUrl(this.fallbackBaseUrl, rows[index] || ""), chapterUrl);
      }
    };
    await Promise.all(Array.from({ length: limit }, worker));
    return checks;
  }

  async _chooseImageMirror(primary, fallback, chapterUrl) {
    const count = Math.max(primary.length, fallback.length);
    if (!fallback.length) return "primary";
    if (!primary.length) return "fallback";
    const indexes = this._mirrorProbeIndexes(count);
    const primaryChecks = await this._probeImageIndexes(primary, indexes, chapterUrl, indexes.length);
    if (indexes.every((index) => primaryChecks[index] === true)) return "primary";
    const fallbackChecks = await this._probeImageIndexes(fallback, indexes, chapterUrl, indexes.length);
    if (indexes.every((index) => fallbackChecks[index] === true)) return "fallback";
    return "mixed";
  }

  async _mixedImageChoices(primary, fallback, chapterUrl) {
    const count = Math.max(primary.length, fallback.length);
    const indexes = Array.from({ length: count }, function(_, index) { return index; });
    const primaryChecks = await this._probeImageIndexes(primary, indexes, chapterUrl, 6);
    const missing = indexes.filter((index) => primaryChecks[index] !== true);
    const fallbackChecks = await this._probeImageIndexes(fallback, missing, chapterUrl, 6);
    return indexes.map((index) => primaryChecks[index] === true ? "primary" : (fallbackChecks[index] === true ? "fallback" : "available"));
  }

  async _directPages(chapterUrl) {
    const html = await this._getText(chapterUrl, { "Referer": chapterUrl }, "viewer");
    const primary = this._extractImageArray(html, "img_list");
    const fallback = this._extractImageArray(html, "img_list_2");
    const result = [];
    const seen = {};
    const count = Math.max(primary.length, fallback.length);
    const mirror = await this._chooseImageMirror(primary, fallback, chapterUrl);
    const mixedChoices = mirror === "mixed" ? await this._mixedImageChoices(primary, fallback, chapterUrl) : [];
    for (let index = 0; index < count; index++) {
      const first = this._absoluteUrl(this.fallbackBaseUrl, primary[index] || "");
      const second = this._absoluteUrl(this.fallbackBaseUrl, fallback[index] || "");
      const choice = mirror === "mixed" ? mixedChoices[index] : mirror;
      const imageUrl = choice === "fallback" ? (second || first) : (first || second);
      if (!imageUrl || seen[imageUrl]) continue;
      result.push({
        url: imageUrl,
        headers: { "User-Agent": this.userAgent, "Referer": chapterUrl, "Accept": this.imageAccept }
      });
      seen[imageUrl] = true;
    }
    if (!result.length) {
      throw new Error("11toon direct viewer did not return images. Try Intra/1.1.1.1/Unicorn HTTPS, or enable Rabbit only if needed.");
    }
    return result;
  }

  async getPageList(url) {
    const base = await this._resolveBaseUrl();
    const chapterId = this._queryParam(url, "wr_id");
    const mangaId = this._queryParam(url, "is");
    if (!/^\d+$/.test(chapterId) || !/^\d+$/.test(mangaId)) throw new Error("Invalid 11toon chapter URL.");
    const chapterUrl = this._withQuery(base, "/bbs/board.php", [
      ["bo_table", "toons"], ["wr_id", chapterId], ["is", mangaId]
    ]);
    return this._rabbitEnabled() ? await this._rabbitPages(chapterUrl) : await this._directPages(chapterUrl);
  }

  async getVideoList() { return []; }
  async getHtmlContent() { return ""; }
  async cleanHtmlContent(html) { return html; }

  _option(name, value) {
    return { type_name: "SelectOption", name: name, value: value };
  }

  _select(type, name, values) {
    return { type: type, name: name, type_name: "SelectFilter", values: values };
  }

  getFilterList() {
    const o = this._option.bind(this);
    const popular = this._savedRule(this.popularRulePreference, this._defaultPopularRule());
    const latest = this._savedRule(this.latestRulePreference, this._defaultLatestRule());
    const separator = function(type) { return { type: type, name: "", type_name: "SeparatorFilter" }; };
    const header = function(type, name) { return { type: type, name: name, type_name: "HeaderFilter" }; };
    return [
      header("notice", "검색어와 목록 필터는 함께 사용할 수 없습니다. 아래 네 구역 중 한 곳만 선택하세요."),
      separator("sepLatest"),
      header("latestHeader", "최신만화"),
      this._select("latestGenre", "장르", [o("선택하세요", "__unset__")].concat(this.latestGenres.map(function(value) { return o(value ? (value === "일상 치유" ? "일상+치유" : value) : "전체", value); }))),
      separator("sepPopular"),
      header("popularHeader", "인기만화"),
      this._select("popularGenre", "장르", [o("선택하세요", "__unset__")].concat(this.rankedGenres.map(function(value) { return o(value || "전체", value); }))),
      separator("sepCompleted"),
      header("completedHeader", "완결만화"),
      this._select("completedGenre", "장르", [o("선택하세요", "__unset__")].concat(this.rankedGenres.map(function(value) { return o(value || "전체", value); }))),
      separator("sepZip"),
      header("zipHeader", "요청 Zip"),
      this._select("zipType", "선택", [o("선택하세요", "__unset__"), o("핫신작", ""), o("매일 TOP 35", "todayhit"), o("완결", "isover")]),
      separator("sepSave"),
      header("saveHelp", "조건을 고른 뒤 Filter 버튼을 누르면 결과를 보고 Popular/Latest 탭 규칙으로 저장할 수 있습니다."),
      header("popularSummary", "현재 Popular: " + this._ruleSummary(popular)),
      header("latestSummary", "현재 Latest: " + this._ruleSummary(latest)),
      this._select("tabRuleAction", "Popular/Latest 규칙", [
        o("저장하지 않음 (필터 결과만 보기)", "0"),
        o("현재 조건을 Popular 탭에 저장", "1"),
        o("현재 조건을 Latest 탭에 저장", "2"),
        o("Popular 탭을 기본값으로 복원", "3"),
        o("Latest 탭을 기본값으로 복원", "4"),
        o("두 탭 모두 기본값으로 복원", "5")
      ])
    ];
  }

  getSourcePreferences() {
    return [
      {
        key: "toon11_domain_url",
        editTextPreference: {
          title: "확장앱 주소 직접 지정",
          summary: "\uBE48 \uAC12\uC774\uBA74 \uD1A0\uB07C \uC911\uC559 \uC2E0\uD638\uB4F1\uC758 \uAC80\uC99D\uB41C \uC8FC\uC18C\uB97C \uC0AC\uC6A9\uD569\uB2C8\uB2E4.", value: "",
          dialogTitle: "https://11toon.com", dialogMessage: "\uC790\uB3D9 \uC8FC\uC18C\uB97C \uC0AC\uC6A9\uD558\uB824\uBA74 \uBE48 \uAC12\uC73C\uB85C \uB450\uC138\uC694."
        }
      },
      {
        key: "toon11_rabbit_enabled",
        switchPreferenceCompat: {
          title: "Rabbit \uC678\uBD80 \uC778\uC99D \uC11C\uBC84 \uC0AC\uC6A9", summary: "\uAE30\uBCF8\uC740 \uAEBC\uC9D0. \uC9C1\uC811 \uBDF0\uC5B4\uAC00 \uC2E4\uD328\uD560 \uB54C\uB9CC \uCF1C\uC138\uC694.", value: false
        }
      },
      {
        key: "toon11_rabbit_endpoint",
        editTextPreference: {
          title: "Rabbit \uC11C\uBC84 \uC8FC\uC18C", summary: "Windows: localhost \uAC00\uB2A5 / iOS: LAN \uB610\uB294 Tailscale \uC8FC\uC18C", value: "",
          dialogTitle: "\uC608: http://127.0.0.1:9870", dialogMessage: "Rabbit \uC635\uC158\uC744 \uCF30\uC744 \uB54C\uB9CC \uC0AC\uC6A9\uB429\uB2C8\uB2E4."
        }
      },
      {
        key: "toon11_rabbit_access_key",
        editTextPreference: {
          title: "Rabbit 접속 키", summary: "서버에 키를 설정한 경우만 입력", value: "",
          dialogTitle: "\uC811\uC18D \uD0A4", dialogMessage: ""
        }
      },
      {
        key: "toon11_custom_card_json_url",
        editTextPreference: {
          title: "커스텀 목록 카드",
          summary: "공개 JSON 주소 하나로 요일별 목록 카드를 설정합니다. 360×540 이미지를 권장하며 용량·프레임 제한은 없습니다.", value: "",
          dialogTitle: "커스텀 목록 카드 JSON 주소", dialogMessage: "Google Drive 공개 공유 링크 또는 직접 JSON 주소를 넣으세요. 개인 카드를 설정하면 공용 이벤트 카드는 표시되지 않습니다. 빈 값이면 공용 이벤트 또는 기본 망가 요일 카드를 사용합니다."
        }
      }
    ];
  }
}

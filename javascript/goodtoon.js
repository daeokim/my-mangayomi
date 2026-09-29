const mangayomiSources = [{
  name: "굿툰",
  lang: "ko",
  baseUrl: "https://goodtoon003.com",
  apiUrl: "",
  iconUrl: "http://127.0.0.1:18774/icon/ko.goodtoon.png",
  typeSource: "single",
  itemType: 0,
  isNsfw: true,
  hasCloudflare: false,
  version: "0.1.9",
  dateFormat: "yy.MM.dd",
  dateFormatLocale: "ko_KR",
  pkgPath: "manga/src/ko/goodtoon.js"
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
    this.fallbackBaseUrl = "https://goodtoon003.com";
    this.searchUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
    this.userAgent = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
    this.imageAccept = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
    this.weekdayCardBaseUrl = "https://dc-toki-mangayomi-manga.pages.dev/card/weekday-";
    this.popularRulePreference = "goodtoon_popular_rule_v1";
    this.latestRulePreference = "goodtoon_latest_rule_v1";
    this.requestSequence = 0;

    this.categories = [
      ["전체", "all"], ["일반웹툰", "webtoon"], ["BL/GL", "bl-gl"], ["성인웹툰", "adult"]
    ];
    this.weekdays = [
      ["전체", "all"], ["월", "mon"], ["화", "tue"], ["수", "wed"], ["목", "thu"],
      ["금", "fri"], ["토", "sat"], ["일", "sun"], ["열흘", "etc"]
    ];
    this.genres = [
      ["전체", ""], ["학원", "school"], ["액션", "action"], ["SF", "sci-fi"], ["스토리", "story"],
      ["판타지", "fantasy"], ["BL", "bl"], ["개그", "gag"], ["연애", "romance-drama"], ["드라마", "drama"],
      ["로맨스", "romance"], ["시대극", "period"], ["스포츠", "sports"], ["일상", "slice-of-life"], ["추리", "mystery"],
      ["공포", "horror"], ["성인", "adult"], ["옴니버스", "omnibus"], ["에피소드", "episode"], ["무협", "martial-arts"],
      ["소년", "shounen"], ["기타", "etc"], ["노벨피아", "novelpia"], ["유부녀", "married"], ["하드코어", "hardcore"],
      ["조교", "training"], ["고수위", "high-level"], ["능욕", "abuse"], ["하렘", "harem"], ["강제", "forced"],
      ["여성인기", "female-popular"], ["남성인기", "male-popular"], ["3P", "threesome"], ["후방주의", "adult-warning"], ["백합", "yuri"]
    ];
    this.platforms = [
      ["전체", ""], ["네이버", "naver"], ["다음", "daum"], ["카카오", "kakao"], ["레진", "rejin"],
      ["투믹스", "tomics"], ["탑툰", "toptoon"], ["코미카", "comica"], ["배틀코믹스", "battlecomics"],
      ["코믹GT", "comicgt"], ["케이툰", "ktoon"], ["애니툰", "anitoon"], ["폭스툰", "foxtoon"],
      ["피너툰", "peanutoon"], ["봄툰", "bom"], ["코미코", "comico"], ["무툰", "mootoon"], ["기타", "etc"]
    ];
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
    const source = this._text(this._preference("goodtoon_custom_card_json_url", "")).trim();
    if (!source) return "";
    const preferences = new SharedPreferences();
    const cacheKey = "goodtoon_custom_card_cache", sourceKey = cacheKey + "_source", timeKey = cacheKey + "_time";
    let data = null, cached = "";
    if (this._preferenceString(sourceKey, "") === source) cached = this._preferenceString(cacheKey, "");
    const cachedAt = Number(this._preferenceString(timeKey, "0"));
    if (cached && cachedAt > 0 && Date.now() - cachedAt < 5 * 60 * 1000) { try { data = JSON.parse(cached); } catch (_) {} }
    if (!data) {
      try {
        const direct = this._driveDirect(source, false), join = direct.indexOf("?") >= 0 ? "&" : "?", requestUrl = direct + join + "card_json=" + Date.now();
        let body = "";
        for (const options of [{ persistentConnection: false, noProxy: true, timeout: 15, connectTimeout: 8 }, { useDartHttpClient: true, persistentConnection: false }]) {
          try { const response = await new Client(options).get(requestUrl, { "Accept": "application/json", "Cache-Control": "no-cache" }); if (response.statusCode >= 200 && response.statusCode < 300) { body = response.body; break; } } catch (_) {}
        }
        if (!body) throw new Error("커스텀 목록 카드 JSON을 불러오지 못했습니다.");
        data = JSON.parse(body);
        preferences.setString(cacheKey, JSON.stringify(data)); preferences.setString(sourceKey, source); preferences.setString(timeKey, String(Date.now()));
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

  _isAllowedBaseUrl(value) {
    return /^https:\/\/(?:www\.)?goodtoon\d+\.com\/?$/i.test(this._text(value).trim());
  }

  async _resolveBaseUrl() {
    const manual = this._text(this._preference("goodtoon_domain_url", "")).trim();
    if (this._isAllowedBaseUrl(manual)) return this._trimSlash(manual);
    try {
      const response = await new Client({ persistentConnection: false, noProxy: true, timeout: 8, connectTimeout: 5 }).get(this.signalUrl, {
        "User-Agent": this.userAgent,
        "Accept": "application/json",
        "Cache-Control": "no-cache"
      });
      if (response.statusCode >= 200 && response.statusCode < 300) {
        const data = JSON.parse(response.body);
        const candidate = data && data.domains && data.domains.goodtoon ? data.domains.goodtoon.baseUrl : "";
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
      if (/^https?:\/\/(?:www\.)?goodtoon\d+\.com/i.test(raw)) return base + this._relativePath(raw);
      return raw;
    }
    return base + this._relativePath(raw);
  }

  _imageUrl(base, element) {
    if (!element) return "";
    for (const name of ["data-src", "data-lazy-src", "data-original", "src"]) {
      const candidate = this._text(element.attr(name)).trim();
      if (candidate && !/\/dflazy\.jpg(?:\?|$)/i.test(candidate)) return this._absoluteUrl(base, candidate);
    }
    return "";
  }

  _withQuery(base, path, pairs) {
    const query = [];
    for (const pair of pairs) {
      if (!pair || pair.length < 2 || this._text(pair[1]) === "") continue;
      query.push(encodeURIComponent(pair[0]) + "=" + encodeURIComponent(this._text(pair[1])));
    }
    return base + path + (query.length ? "?" + query.join("&") : "");
  }

  _requestHeaders(url, extraHeaders) {
    const headers = {
      "User-Agent": this.userAgent,
      "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "Referer": (this._origin(url) || this.fallbackBaseUrl) + "/"
    };
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

  async _pause(milliseconds) {
    if (typeof setTimeout === "function") {
      await new Promise(function(resolve) { setTimeout(resolve, milliseconds); });
    }
  }

  async _requestText(method, url, extraHeaders, body, stage) {
    const headers = this._requestHeaders(url, extraHeaders);
    const transports = [
      { name: "RHTTP", options: { persistentConnection: false, noProxy: true, timeout: 20, connectTimeout: 10 } },
      { name: "DART", options: { useDartHttpClient: true, persistentConnection: false } }
    ];
    const diagnostics = [];
    for (const transport of transports) {
      try {
        const client = new Client(transport.options);
        const response = method === "POST"
          ? (body === undefined ? await client.post(url, headers) : await client.post(url, headers, body))
          : await client.get(url, headers);
        if (response.statusCode >= 200 && response.statusCode < 300) return response.body;
        diagnostics.push(transport.name + "=" + this._failureCode(response, null));
        if (response.statusCode === 401 || response.statusCode === 403 || response.statusCode === 429) break;
      } catch (error) {
        diagnostics.push(transport.name + "=" + this._failureCode(null, error));
        if (transport.name === "RHTTP") await this._pause(180);
      }
    }
    throw new Error("굿툰 " + (stage || "요청") + " 연결에 실패했습니다. 진단: " + diagnostics.join(","));
  }

  async _getText(url, extraHeaders, stage) {
    return await this._requestText("GET", url, extraHeaders, undefined, stage);
  }

  async _postText(url, extraHeaders, body, stage) {
    return await this._requestText("POST", url, extraHeaders, body, stage);
  }

  _koreaWeekday() {
    const day = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCDay();
    return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][day];
  }

  _weekdayCardInfo(weekday) {
    const values = {
      mon: ["월요일", "monday"], tue: ["화요일", "tuesday"], wed: ["수요일", "wednesday"],
      thu: ["목요일", "thursday"], fri: ["금요일", "friday"], sat: ["토요일", "saturday"], sun: ["일요일", "sunday"]
    };
    const info = values[weekday] || values[this._koreaWeekday()];
    return { name: info[0], slug: info[1] };
  }

  async _tabCard(weekday, tab) {
    const info = this._weekdayCardInfo(weekday);
    const customSource = this._text(this._preference("goodtoon_custom_card_json_url", "")).trim();
    const customImage = await this._customCardUrl(info.slug);
    const event = customSource ? null : await dcOfficialEventCard();
    const official = customImage || event ? null : await dcOfficialListCardSystem("goodtoon", tab, "오늘의 만화");
    return {
      name: customImage ? info.name : event ? event.name : official.name,
      link: "/__goodtoon_weekday_card__/" + info.slug,
      imageUrl: customImage || (event && event.imageUrl) || official.imageUrl
    };
  }

  _defaultPopularRule() {
    return { section: "ongoing", category: "webtoon", weekday: this._koreaWeekday(), genre: "", platform: "" };
  }

  _defaultLatestRule() {
    return { section: "end", category: "all", weekday: "all", genre: "", platform: "" };
  }

  _defaultSearchRule() {
    return { section: "home", category: "all", weekday: "all", genre: "", platform: "" };
  }

  _allowed(value, pairs, fallback) {
    const text = this._text(value);
    return pairs.some(function(pair) { return pair[1] === text; }) ? text : fallback;
  }

  _normalizeRule(rule, fallback) {
    const source = rule || fallback || this._defaultLatestRule();
    const section = ["home", "ongoing", "end"].indexOf(this._text(source.section)) >= 0 ? this._text(source.section) : "home";
    return {
      section: section,
      category: this._allowed(source.category, this.categories, "all"),
      weekday: section === "end" ? "all" : this._allowed(source.weekday, this.weekdays, "all"),
      genre: this._allowed(source.genre, this.genres, ""),
      platform: this._allowed(source.platform, this.platforms, "")
    };
  }

  _encodeRule(rule) {
    const normalized = this._normalizeRule(rule, this._defaultLatestRule());
    return [normalized.section, normalized.category, normalized.weekday, normalized.genre, normalized.platform].join("|");
  }

  _decodeRule(value, fallback) {
    const parts = this._text(value).split("|");
    if (parts.length !== 5) return this._normalizeRule(fallback, this._defaultLatestRule());
    return this._normalizeRule({ section: parts[0], category: parts[1], weekday: parts[2], genre: parts[3], platform: parts[4] }, fallback);
  }

  _tabRule(key, fallback) {
    const encoded = this._preferenceString(key, "");
    return { rule: encoded ? this._decodeRule(encoded, fallback) : this._normalizeRule(fallback, this._defaultLatestRule()), isDefault: !encoded };
  }

  _nameFor(pairs, value, fallback) {
    const match = pairs.find(function(pair) { return pair[1] === value; });
    return match ? match[0] : fallback;
  }

  _ruleSummary(rule) {
    const normalized = this._normalizeRule(rule, this._defaultLatestRule());
    if (normalized.section === "home") return "전체 조건";
    const section = normalized.section === "ongoing" ? "연재" : "완결";
    const parts = [section, this._nameFor(this.categories, normalized.category, "전체")];
    if (normalized.section === "ongoing") parts.push(this._nameFor(this.weekdays, normalized.weekday, "전체"));
    if (normalized.genre) parts.push(this._nameFor(this.genres, normalized.genre, ""));
    if (normalized.platform) parts.push(this._nameFor(this.platforms, normalized.platform, ""));
    return parts.filter(Boolean).join(" + ");
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

  _pathForRule(rule) {
    if (rule.section === "ongoing") return "/ongoing/";
    if (rule.section === "end") return "/end/";
    return "/";
  }

  _listUrl(base, page, rule, query) {
    const normalized = this._normalizeRule(rule, this._defaultLatestRule());
    const pairs = [];
    if (query) pairs.push(["q", query]);
    if (normalized.category !== "all") pairs.push(["mcat", normalized.category]);
    if (normalized.section !== "end" && normalized.weekday !== "all") pairs.push(["mday", normalized.weekday]);
    if (normalized.genre) pairs.push(["genre", normalized.genre]);
    if (normalized.platform) pairs.push(["plat", normalized.platform]);
    if (Number(page) > 1) pairs.push(["pg", page]);
    return this._withQuery(base, this._pathForRule(normalized), pairs);
  }

  _parseCards(document, base) {
    const list = [];
    const seen = {};
    for (const card of document.select("a.card[href]")) {
      const path = this._relativePath(card.attr("href")).split("?")[0];
      if (!/^\/manga\/[^/]+\/$/i.test(path) || seen[path]) continue;
      const title = card.selectFirst(".subject");
      const name = this._text(title ? title.text : "").trim();
      if (!name) continue;
      let image = null;
      for (const candidate of card.select(".thumb img")) {
        const classes = this._text(candidate.attr("class"));
        if (!/(?:^|\s)platform-icon(?:\s|$)/.test(classes)) {
          image = candidate;
          break;
        }
      }
      list.push({ name: name, link: path, imageUrl: this._imageUrl(base, image) });
      seen[path] = true;
    }
    let hasNextPage = false;
    for (const anchor of document.select("a.page-numbers")) {
      if (this._text(anchor.text).indexOf("다음") >= 0 || /next/i.test(this._text(anchor.attr("class")))) hasNextPage = true;
    }
    return { list: list, hasNextPage: hasNextPage };
  }

  async _list(page, rule) {
    const base = await this._resolveBaseUrl();
    const url = this._listUrl(base, page, rule, "");
    return this._parseCards(new Document(await this._getText(url, null, "목록")), base);
  }

  async _prependTabCard(result, page, tabRule, tab) {
    if (Number(page) !== 1) return result;
    const weekday = tabRule.rule.weekday === "all" ? this._koreaWeekday() : tabRule.rule.weekday;
    return { list: [await this._tabCard(weekday, tab)].concat(result.list || []), hasNextPage: result.hasNextPage === true };
  }

  async getPopular(page) {
    const tabRule = this._tabRule(this.popularRulePreference, this._defaultPopularRule());
    return this._prependTabCard(await this._list(page, tabRule.rule), page, tabRule, "popular");
  }

  async getLatestUpdates(page) {
    const tabRule = this._tabRule(this.latestRulePreference, this._defaultLatestRule());
    return this._prependTabCard(await this._list(page, tabRule.rule), page, tabRule, "latest");
  }

  _normalizeSearch(value) {
    let text = this._text(value);
    try { text = text.normalize("NFKC"); } catch (_) {}
    return text.trim().replace(/\s+/g, " ");
  }

  _searchKey(value) {
    return this._normalizeSearch(value).toLowerCase().replace(/\s+/g, "");
  }

  _searchChunks(value) {
    const key = this._searchKey(value).replace(/[^0-9a-z\u3131-\u318e\uac00-\ud7a3]/gi, "");
    const result = [];
    for (const width of [3, 2]) {
      if (key.length < width) continue;
      for (let index = 0; index <= key.length - width; index++) {
        const chunk = key.slice(index, index + width);
        if (result.indexOf(chunk) < 0) result.push(chunk);
        if (result.length >= 5) return result;
      }
    }
    if (key && result.indexOf(key) < 0) result.push(key);
    return result;
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
    const ongoing = {
      category: this._filterValue(filters, "ongoingCategory", unset),
      weekday: this._filterValue(filters, "ongoingWeekday", unset),
      genre: this._filterValue(filters, "ongoingGenre", unset),
      platform: this._filterValue(filters, "ongoingPlatform", unset)
    };
    const completed = {
      category: this._filterValue(filters, "completedCategory", unset),
      genre: this._filterValue(filters, "completedGenre", unset),
      platform: this._filterValue(filters, "completedPlatform", unset)
    };
    const ongoingSelected = Object.keys(ongoing).some(function(key) { return ongoing[key] !== unset; });
    const completedSelected = Object.keys(completed).some(function(key) { return completed[key] !== unset; });
    if (ongoingSelected && completedSelected) throw new Error("굿툰 필터는 연재 또는 완결 중 한 구역만 선택하세요.");
    if (ongoingSelected) {
      return this._normalizeRule({
        section: "ongoing",
        category: ongoing.category === unset ? "all" : ongoing.category,
        weekday: ongoing.weekday === unset ? "all" : ongoing.weekday,
        genre: ongoing.genre === unset ? "" : ongoing.genre,
        platform: ongoing.platform === unset ? "" : ongoing.platform
      }, this._defaultPopularRule());
    }
    if (completedSelected) {
      return this._normalizeRule({
        section: "end",
        category: completed.category === unset ? "all" : completed.category,
        weekday: "all",
        genre: completed.genre === unset ? "" : completed.genre,
        platform: completed.platform === unset ? "" : completed.platform
      }, this._defaultLatestRule());
    }
    return null;
  }

  async _searchOnce(base, query) {
    const rule = this._defaultSearchRule();
    const url = this._listUrl(base, 1, rule, query);
    return this._parseCards(new Document(await this._getText(url, { "User-Agent": this.searchUserAgent }, "검색")), base);
  }

  async search(query, page, filters) {
    const normalized = this._normalizeSearch(query);
    if (normalized) {
      if (Number(page) > 1) return { list: [], hasNextPage: false };
      const base = await this._resolveBaseUrl();
      const wanted = this._searchKey(normalized);
      if (!wanted) return { list: [], hasNextPage: false };
      const attempts = [normalized];
      const compact = this._searchKey(normalized);
      if (compact && attempts.indexOf(compact) < 0) attempts.push(compact);
      const found = [];
      const seen = {};
      for (const attempt of attempts.concat(this._searchChunks(normalized))) {
        const result = await this._searchOnce(base, attempt);
        for (const manga of result.list) {
          if (!seen[manga.link] && this._searchKey(manga.name).indexOf(wanted) >= 0) {
            found.push(manga);
            seen[manga.link] = true;
          }
        }
        if (found.length) return { list: found, hasNextPage: false };
      }
      return { list: found, hasNextPage: false };
    }

    const action = Number(this._filterValue(filters, "tabRuleAction", "0"));
    let rule = this._filterRule(filters);
    if (!rule && action >= 3 && action <= 5) rule = action === 3 ? this._defaultPopularRule() : this._defaultLatestRule();
    if (!rule) throw new Error("굿툰 필터에서 연재 또는 완결 구역의 조건을 하나 이상 선택하세요.");
    this._applyTabRuleAction(page, filters, rule);
    return await this._list(page, rule);
  }

  _chapterDate(value) {
    const match = this._text(value).trim().match(/^(\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
    if (!match) return "0";
    const time = Date.UTC(2000 + Number(match[1]), Number(match[2]) - 1, Number(match[3])) - 9 * 60 * 60 * 1000;
    return Number.isFinite(time) ? String(time) : "0";
  }

  async getDetail(url) {
    const cardMatch = this._text(url).match(/\/__goodtoon_weekday_card__\/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (cardMatch) {
      const weekdayBySlug = { monday: "mon", tuesday: "tue", wednesday: "wed", thursday: "thu", friday: "fri", saturday: "sat", sunday: "sun" };
      const card = await this._tabCard(weekdayBySlug[cardMatch[1]]);
      return {
        name: card.name, link: card.link, imageUrl: card.imageUrl, author: "굿툰",
        description: "오늘 요일 작품을 안내하는 움직이는 카드입니다. 뒤로 돌아가 작품을 선택해 주세요.",
        genre: ["요일 안내"], status: 0, episodes: [], chapters: []
      };
    }

    const base = await this._resolveBaseUrl();
    const path = this._relativePath(url).split("?")[0];
    if (!/^\/manga\/[^/]+\/$/i.test(path)) throw new Error("잘못된 굿툰 작품 주소입니다.");
    const detailUrl = base + path;
    const document = new Document(await this._getText(detailUrl, null, "상세"));
    const title = document.selectFirst(".summary-title");
    const cover = document.selectFirst(".manga-summary-cover img");
    const author = document.selectFirst(".manga-summary-author .author-text");
    const genre = document.selectFirst(".manga-summary-genres");
    const description = document.selectFirst(".manga-summary-desc");
    const statusNode = document.selectFirst(".summary-meta-row .meta-value");

    const chaptersUrl = base + path + "ajax/chapters/";
    const chapterDocument = new Document(await this._postText(chaptersUrl, {
      "Referer": detailUrl,
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    }, undefined, "회차"));
    const episodes = [];
    const seen = {};
    for (const row of chapterDocument.select("li.wp-manga-chapter")) {
      const anchor = row.selectFirst("a[href]");
      if (!anchor) continue;
      const chapterPath = this._relativePath(anchor.attr("href")).split("?")[0];
      if (!chapterPath || seen[chapterPath]) continue;
      const dateNode = row.selectFirst(".chapter-release-date");
      episodes.push({
        name: this._text(anchor.text).replace(/^\s*UP\s*/i, "").trim(),
        url: chapterPath,
        dateUpload: this._chapterDate(dateNode ? dateNode.text : "")
      });
      seen[chapterPath] = true;
    }
    const statusText = this._text(statusNode ? statusNode.text : "");
    return {
      name: this._text(title ? title.text : "").trim(),
      link: path,
      imageUrl: this._imageUrl(base, cover),
      author: this._text(author ? author.text : "").trim(),
      description: this._text(description ? description.text : "").trim(),
      genre: this._text(genre ? genre.text : "").split(/[,/]/).map(function(value) { return value.trim(); }).filter(Boolean),
      status: statusText.indexOf("완결") >= 0 ? 1 : 0,
      episodes: episodes,
      chapters: episodes
    };
  }

  _rabbitEnabled() {
    const value = this._preference("goodtoon_rabbit_enabled", false);
    return value === true || this._text(value).toLowerCase() === "true" || this._text(value) === "1";
  }

  _rabbitEndpoint() {
    const raw = this._trimSlash(this._preference("goodtoon_rabbit_endpoint", ""));
    if (!raw) throw new Error("Rabbit 서버 주소가 비어 있습니다.");
    if (!/^https?:\/\/(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.test(raw)) {
      throw new Error("Rabbit 서버 주소 형식이 잘못됐습니다. 예: http://192.168.0.10:9870");
    }
    return raw;
  }

  _rabbitHeaders(jsonBody) {
    const headers = { "Accept": "application/json", "X-Lab-Request": "1" };
    if (jsonBody) headers["Content-Type"] = "application/json";
    const key = this._text(this._preference("goodtoon_rabbit_access_key", "")).trim();
    if (key) headers.Authorization = "Bearer " + key;
    return headers;
  }

  async _rabbitJson(endpoint, path, body, ignoreFailure) {
    try {
      const response = body === undefined
        ? await new Client().get(endpoint + path, this._rabbitHeaders(false))
        : await new Client().post(endpoint + path, this._rabbitHeaders(true), body);
      if (response.statusCode === 401 || response.statusCode === 403) throw new Error("Rabbit 접속 키가 틀렸거나 서버 설정과 다릅니다.");
      if (response.statusCode < 200 || response.statusCode >= 300) {
        if (ignoreFailure) return {};
        throw new Error("Rabbit 서버 요청 실패 (HTTP " + response.statusCode + ").");
      }
      return JSON.parse(response.body);
    } catch (error) {
      if (ignoreFailure) return {};
      if (error && error.message && error.message.indexOf("Rabbit") >= 0) throw error;
      throw new Error("Rabbit 서버에 연결할 수 없습니다. 주소, 포트, 방화벽을 확인하세요.");
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

  _manifestPages(manifest, id, chapterUrl) {
    if (!manifest || this._text(manifest.id) !== id || this._text(manifest.chapterUrl) !== chapterUrl) throw new Error("Rabbit 인증 결과가 현재 회차와 일치하지 않습니다.");
    const rows = manifest.pages;
    if (!Array.isArray(rows) || !rows.length || Number(manifest.expected) !== rows.length) throw new Error("Rabbit 서버가 불완전한 이미지 목록을 반환했습니다.");
    const referer = this._text(manifest.referer).trim();
    const userAgent = this._text(manifest.userAgent).trim();
    const result = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (!row || Number(row.page) !== index + 1 || !Array.isArray(row.urls)) throw new Error("Rabbit 이미지 순서가 올바르지 않습니다.");
      const imageUrl = row.urls.map(this._text.bind(this)).find(function(value) { return /^https:\/\/[^\s]+$/i.test(value); });
      if (!imageUrl) throw new Error("Rabbit 이미지 주소가 유효하지 않습니다.");
      result.push({ url: imageUrl, headers: { "Referer": referer, "User-Agent": userAgent, "Accept": this.imageAccept } });
    }
    return result;
  }

  async _rabbitPages(chapterUrl) {
    const endpoint = this._rabbitEndpoint();
    const health = await this._rabbitJson(endpoint, "/health");
    if (!health || health.service !== "rabbit-auth-server" || Number(health.protocol) !== 1) throw new Error("호환되는 Rabbit 인증 서버(protocol v1)가 아닙니다.");
    if (health.ready !== true) throw new Error("Rabbit 서버가 아직 준비되지 않았습니다.");
    const opened = await this._rabbitJson(endpoint, "/v1/jobs", { url: chapterUrl, requestId: this._newRequestId(), kind: "images" });
    const id = this._text(opened.id);
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Rabbit 작업 번호가 잘못됐습니다.");
    try {
      const deadline = Date.now() + 115000;
      while (Date.now() < deadline) {
        const state = await this._rabbitJson(endpoint, "/v1/jobs/" + id);
        if (state.state === "failed") throw new Error("Rabbit 굿툰 인증 작업이 실패했습니다.");
        if (state.state === "ready") {
          const manifest = await this._rabbitJson(endpoint, "/v1/jobs/" + id + "/manifest", {});
          return this._manifestPages(manifest, id, chapterUrl);
        }
        await this._pause(750);
      }
      throw new Error("Rabbit 인증 시간이 초과됐습니다.");
    } finally {
      await this._rabbitJson(endpoint, "/v1/jobs/" + id + "/close", {}, true);
    }
  }

  async _directPages(chapterUrl, base) {
    const document = new Document(await this._getText(chapterUrl, { "Referer": chapterUrl }, "뷰어"));
    const result = [];
    const seen = {};
    for (const image of document.select(".reading-content img, div.page-break img")) {
      const imageUrl = this._imageUrl(base, image);
      if (!imageUrl || seen[imageUrl]) continue;
      result.push({ url: imageUrl, headers: { "User-Agent": this.userAgent, "Referer": chapterUrl, "Accept": this.imageAccept } });
      seen[imageUrl] = true;
    }
    if (!result.length) throw new Error("굿툰 뷰어에서 이미지를 찾지 못했습니다. 필요할 때만 Rabbit 외부 인증을 켜세요.");
    return result;
  }

  async getPageList(url) {
    const base = await this._resolveBaseUrl();
    const path = this._relativePath(url).split("?")[0];
    if (!/^\/manga\/[^/]+\/.+\/$/i.test(path)) throw new Error("잘못된 굿툰 회차 주소입니다.");
    const chapterUrl = base + path;
    return this._rabbitEnabled() ? await this._rabbitPages(chapterUrl) : await this._directPages(chapterUrl, base);
  }

  getHeaders(url) {
    return { "User-Agent": this.userAgent, "Referer": (this._origin(url) || this.fallbackBaseUrl) + "/", "Accept": this.imageAccept };
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
    const options = function(pairs) { return [o("선택하세요", "__unset__")].concat(pairs.map(function(pair) { return o(pair[0], pair[1]); })); };
    const popular = this._tabRule(this.popularRulePreference, this._defaultPopularRule()).rule;
    const latest = this._tabRule(this.latestRulePreference, this._defaultLatestRule()).rule;
    const separator = function(type) { return { type: type, name: "", type_name: "SeparatorFilter" }; };
    const header = function(type, name) { return { type: type, name: name, type_name: "HeaderFilter" }; };
    return [
      separator("sepOngoing"),
      header("ongoingHeader", "연재"),
      this._select("ongoingCategory", "분류", options(this.categories)),
      this._select("ongoingWeekday", "요일", options(this.weekdays)),
      this._select("ongoingGenre", "장르", options(this.genres)),
      this._select("ongoingPlatform", "플랫폼", options(this.platforms)),
      separator("sepCompleted"),
      header("completedHeader", "완결"),
      this._select("completedCategory", "분류", options(this.categories)),
      this._select("completedGenre", "장르", options(this.genres)),
      this._select("completedPlatform", "플랫폼", options(this.platforms)),
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
        key: "goodtoon_domain_url",
        editTextPreference: {
          title: "확장앱 주소 직접 지정",
          summary: "빈 값이면 토끼 중앙신호등의 검증된 주소를 사용합니다.", value: "",
          dialogTitle: "https://goodtoon###.com", dialogMessage: "자동 주소를 사용하려면 빈 값으로 두세요."
        }
      },
      {
        key: "goodtoon_rabbit_enabled",
        switchPreferenceCompat: {
          title: "Rabbit 외부 인증 서버 사용", summary: "기본은 꺼짐. 직접 뷰어가 실패할 때만 켜세요.", value: false
        }
      },
      {
        key: "goodtoon_rabbit_endpoint",
        editTextPreference: {
          title: "Rabbit 서버 주소", summary: "Windows: localhost 가능 / iOS: LAN 또는 Tailscale 주소", value: "",
          dialogTitle: "예: http://192.168.0.10:9870", dialogMessage: ""
        }
      },
      {
        key: "goodtoon_rabbit_access_key",
        editTextPreference: {
          title: "Rabbit 접속 키", summary: "서버에 키를 설정한 경우만 입력", value: "", dialogTitle: "접속 키", dialogMessage: ""
        }
      },
      {
        key: "goodtoon_custom_card_json_url",
        editTextPreference: {
          title: "커스텀 목록 카드",
          summary: "공개 JSON 주소 하나로 요일별 목록 카드를 설정합니다. 360×540 이미지를 권장하며 용량·프레임 제한은 없습니다.", value: "",
          dialogTitle: "커스텀 목록 카드 JSON 주소", dialogMessage: "Google Drive 공개 공유 링크 또는 직접 JSON 주소를 넣으세요. 개인 카드를 설정하면 공용 이벤트 카드는 표시되지 않습니다. 빈 값이면 공용 이벤트 또는 기본 망가 요일 카드를 사용합니다."
        }
      }
    ];
  }
}

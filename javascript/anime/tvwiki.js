const mangayomiSources = [{
  name: "티비위키",
  lang: "ko",
  baseUrl: "https://tvwiki51.net",
  apiUrl: "",
  iconUrl: "https://dc-toki-mangayomi-media.pages.dev/icon/ko.tvwiki.png",
  typeSource: "single",
  itemType: 1,
  isNsfw: false,
  hasCloudflare: false,
  version: "0.1.8",
  dateFormat: "",
  dateFormatLocale: "",
  pkgPath: "anime/src/ko/tvwiki.js",
  notes: "검색 카드 작품 설명 우선 · 회차형 최신 줄거리 제외 · 인기/최신 탭 규칙 저장 · 커스텀 목록 카드 · WebP 공용 랜덤 카드 · 목록 구분 카드 6종 · 주간 TOP 100 회차 전수 보강 · 작품명/특별편 누락 수정 · 순차 HTTP 요청으로 403 알림 억제 · 중앙신호등 최신 주소 · 빠른 CDN 직접 재생 + 호환 중계 재생"
}];

function dcResolveTvwikiRemoteCards(data, tab) {
  const source = data && typeof data === "object" ? data : {};
  const wantedTab = String(tab || "all").trim().toLowerCase();
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
      if (targets.indexOf("tvwiki:" + wantedTab) >= 0) targetScore = 600;
      else if (targets.indexOf("tvwiki") >= 0) targetScore = 500;
      else continue;
    } else if (groups.length) {
      if (groups.indexOf("media") < 0) continue;
      targetScore = 300;
    }
    let tabScore = 0;
    if (tabs.length && tabs.indexOf("*") < 0 && tabs.indexOf("all") < 0 && tabs.indexOf("both") < 0) {
      if (tabs.indexOf(wantedTab) < 0) continue;
      tabScore = 50;
    }
    const score = (Number(rule.priority) || 0) * 10000 + targetScore + tabScore;
    if (score > selectedScore) { selected = rule; selectedIndex = index; selectedScore = score; }
  }
  const cards = selected && Array.isArray(selected.cards) && selected.cards.length ? selected.cards : source.cards;
  const revision = [source.revision, selected && selected.revision, selected && (selected.id || ("rule-" + selectedIndex))].map(function(value) { return String(value || "").trim(); }).filter(Boolean).join(":");
  return {
    cards: Array.isArray(cards) ? cards : [],
    name: String(selected && (selected.name || selected.title) || source.name || source.title || "").trim(),
    revision,
    rotation: Object.assign({}, source.rotation || {}, selected && selected.rotation || {})
  };
}

async function dcTvwikiRemoteCard(tab, defaultName) {
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
  const config = dcResolveTvwikiRemoteCards(data, tab);
  let cards = config.cards.map(function(value) {
    const rawUrl = typeof value === "string" ? value : value && (value.imageUrl || value.image || value.url);
    let imageUrl = String(rawUrl || "").trim();
    if (imageUrl.startsWith("/")) imageUrl = assetBaseUrl + imageUrl;
    if (!/^https:\/\//i.test(imageUrl)) return null;
    if (config.revision) imageUrl += (imageUrl.indexOf("?") >= 0 ? "&" : "?") + "revision=" + encodeURIComponent(config.revision);
    return { name: String(typeof value === "object" && value && (value.name || value.title) || config.name || defaultName || "오늘의 미디어").trim(), imageUrl };
  }).filter(Boolean);
  if (!cards.length) {
    cards = Array.from({ length: 20 }, function(_, index) {
      return { name: defaultName || "오늘의 미디어", imageUrl: assetBaseUrl + "/card/shared-random/card-" + String(index + 1).padStart(2, "0") + ".jpg" };
    });
  }
  const preferences = new SharedPreferences(), key = "dc_list_card_system_last_tvwiki_" + String(tab || "all"), timeKey = key + "_time", revisionKey = key + "_revision";
  let previous = 0, previousAt = 0, previousRevision = "";
  try { previous = Number(preferences.getString(key, "0")); previousAt = Number(preferences.getString(timeKey, "0")); previousRevision = String(preferences.getString(revisionKey, "") || ""); } catch (_) {}
  const holdMinutes = String(config.rotation.mode || "").toLowerCase() === "interval" ? Math.max(1, Number(config.rotation.intervalMinutes) || 60) : 0;
  const keep = holdMinutes > 0 && previous >= 1 && previous <= cards.length && previousAt > 0 && Date.now() - previousAt < holdMinutes * 60 * 1000 && previousRevision === config.revision;
  let index = previous;
  if (!keep) {
    index = Math.floor(Math.random() * cards.length) + 1;
    if (config.rotation.avoidImmediateRepeat !== false && cards.length > 1 && index === previous) index = index % cards.length + 1;
    try { preferences.setString(key, String(index)); preferences.setString(timeKey, String(Date.now())); preferences.setString(revisionKey, config.revision); } catch (_) {}
  }
  return cards[Math.max(1, Math.min(cards.length, index || 1)) - 1];
}

async function dcTvwikiEventCard() {
  const manifestUrl = "https://dc-toki-mangayomi-media.pages.dev/assets/official-event-card.json";
  try {
    const response = await new Client({ persistentConnection: false, noProxy: true, timeout: 8, connectTimeout: 5 }).get(
      manifestUrl + "?event_manifest=" + Date.now(),
      { Accept: "application/json, text/plain, */*", Referer: "https://dc-toki-mangayomi-media.pages.dev/" }
    );
    if (!response || response.statusCode < 200 || response.statusCode >= 300) return null;
    const data = JSON.parse(String(response.body || ""));
    if (!data || data.enabled !== true) return null;
    const now = Date.now(), startsAt = data.startsAt ? Date.parse(String(data.startsAt)) : NaN, endsAt = data.endsAt ? Date.parse(String(data.endsAt)) : NaN;
    if (Number.isFinite(startsAt) && now < startsAt) return null;
    if (Number.isFinite(endsAt) && now >= endsAt) return null;
    let imageUrl = String(data.imageUrl || data.image || "").trim();
    if (!/^https:\/\//i.test(imageUrl)) return null;
    const revision = String(data.revision || "").trim();
    if (revision) imageUrl += (imageUrl.indexOf("?") >= 0 ? "&" : "?") + "revision=" + encodeURIComponent(revision);
    return { name: String(data.name || data.title || "특별 이벤트").trim(), imageUrl };
  } catch (_) { return null; }
}

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.fallbackBaseUrl = "https://tvwiki49.net";
    this.bridgeBaseUrl = "https://dc-toki-mangayomi-media.pages.dev";
    this.cardBaseUrl = this.bridgeBaseUrl + "/card/tvwiki-section";
    this.cardRevision = "20260915-2";
    this.signalUrl = "https://wankyo83.github.io/tokki-traffic-light/domains.json";
    this.cachedBaseKey = "tvwiki_last_base_url";
    this.cachedBaseTimeKey = "tvwiki_last_base_time";
    this.posterCachePrefix = "tvwiki_series_poster_v1_";
    this.titleCachePrefix = "tvwiki_series_title_v1_";
    this.descriptionCachePrefix = "tvwiki_series_description_v1_";
    this.httpClientKey = "tvwiki_http_client_v1";
    this.popularRulePreference = "tvwiki_popular_rule_v1";
    this.latestRulePreference = "tvwiki_latest_rule_v1";
    this.baseCacheMs = 5 * 60 * 1000;
    this.userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    this.categories = [
      ["전체", "all"], ["영화", "movie"], ["한국영화", "kor_movie"], ["드라마", "drama"],
      ["예능프로그램", "ent"], ["시사·다큐", "sisa"], ["해외드라마", "world"],
      ["해외 예능·다큐", "ott_ent"], ["숏폼 드라마", "short_drama"],
      ["극장판 애니메이션", "ani_movie"], ["일반 애니메이션", "animation"],
      ["추억의 예능", "old_ent"], ["추억의 드라마", "old_drama"]
    ];
    this.periods = [["일간", "d"], ["주간", "w"], ["월간", "m"], ["전체 기간", "a"]];
    this.homeSections = [
      { key: "home-popular", name: "홈 인기 추천", selector: ".slide_popular", limit: 10 },
      { key: "drama", name: "최신 드라마", selector: ".slide_drama", limit: 12 },
      { key: "movie", name: "최신 영화", selector: ".slide_movie", limit: 12 },
      { key: "entertainment", name: "최신 예능", selector: ".slide_ent", limit: 12 },
      { key: "anime", name: "최신 애니", selector: ".slide_ani_movie", limit: 12 }
    ];
  }

  get supportsLatest() { return true; }
  _text(value) { return value === null || value === undefined ? "" : String(value); }
  _normalize(value) { let text = this._text(value); try { text = text.normalize("NFKC"); } catch (_) {} return text.replace(/\s+/g, " ").trim(); }
  _origin(value) { const match = this._text(value).match(/^(https?:\/\/[^/]+)/i); return match ? match[1] : ""; }
  _trimSlash(value) { return this._text(value).trim().replace(/\/+$/, ""); }
  _relative(value) { let text = this._text(value).trim(); if (/^https?:\/\//i.test(text)) text = text.replace(/^https?:\/\/[^/]+/i, ""); if (text && !text.startsWith("/")) text = "/" + text; return text; }
  _absolute(base, value) { const text = this._text(value).trim().replace(/&amp;/g, "&"); if (!text) return ""; if (text.startsWith("//")) return "https:" + text; if (/^https?:\/\//i.test(text)) return text; return text.startsWith("/") ? this._origin(base) + text : base.replace(/[?#].*$/, "").replace(/[^/]*$/, "") + text; }
  _allowedCategory(value) { return this.categories.some(function(item) { return item[1] === value; }); }
  _seriesPath(value) {
    const clean = this._relative(value).split(/[?#]/)[0];
    const match = clean.match(/^\/([a-z_]+)\/(\d+)(?:\/\d+)?\/?$/i);
    return match && this._allowedCategory(match[1]) && match[1] !== "all" ? "/" + match[1] + "/" + match[2] : "";
  }
  _episodePath(value) {
    const clean = this._relative(value).split(/[?#]/)[0];
    const match = clean.match(/^\/([a-z_]+)\/(\d+)\/(\d+)\/?$/i);
    return match && this._allowedCategory(match[1]) && match[1] !== "all" ? "/" + match[1] + "/" + match[2] + "/" + match[3] : "";
  }
  _isAllowedBase(value) { return /^https:\/\/(?:www\.)?tvwiki\d+\.net\/?$/i.test(this._text(value).trim()); }
  _preference(key, fallback) { try { const value = new SharedPreferences().get(key); return value === null || value === undefined ? fallback : this._text(value); } catch (_) { return fallback; } }
  _setPreference(key, value) { try { new SharedPreferences().setString(key, this._text(value)); } catch (_) {} }
  _driveDirect(url, image) {
    const value = this._text(url).trim();
    const match = value.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
    return match ? "https://drive.google.com/uc?export=" + (image ? "view" : "download") + "&id=" + match[1] : value;
  }
  async _customCardUrl(slug) {
    const source = this._text(this._preference("tvwiki_custom_card_json_url", "")).trim();
    if (!source) return "";
    const cacheKey = "tvwiki_custom_card_cache", sourceKey = cacheKey + "_source", timeKey = cacheKey + "_time";
    let data = null, cached = "";
    if (this._preference(sourceKey, "") === source) cached = this._preference(cacheKey, "");
    const cachedAt = Number(this._preference(timeKey, "0"));
    if (cached && cachedAt > 0 && Date.now() - cachedAt < 5 * 60 * 1000) { try { data = JSON.parse(cached); } catch (_) {} }
    if (!data) {
      try {
        const direct = this._driveDirect(source, false), join = direct.indexOf("?") >= 0 ? "&" : "?";
        const response = await new Client({ persistentConnection: false, noProxy: true, timeout: 8, connectTimeout: 5 }).get(
          direct + join + "card_json=" + Date.now(),
          { Accept: "application/json, text/plain, */*", "Cache-Control": "no-cache" }
        );
        if (!response || response.statusCode < 200 || response.statusCode >= 300) throw new Error("HTTP " + (response && response.statusCode));
        data = JSON.parse(this._text(response.body));
        this._setPreference(cacheKey, JSON.stringify(data));
        this._setPreference(sourceKey, source);
        this._setPreference(timeKey, String(Date.now()));
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
  _posterKey(path) { return this.posterCachePrefix + this._text(path).replace(/[^a-z0-9]+/gi, "_"); }
  _rememberPoster(path, imageUrl) {
    const seriesPath = this._seriesPath(path), value = this._text(imageUrl).trim();
    if (seriesPath && /^https?:\/\//i.test(value)) this._setPreference(this._posterKey(seriesPath), value);
  }
  _cachedPoster(path) {
    const seriesPath = this._seriesPath(path);
    if (!seriesPath) return "";
    const value = this._text(this._preference(this._posterKey(seriesPath), "")).trim();
    return /^https?:\/\//i.test(value) ? value : "";
  }
  _titleKey(path) { return this.titleCachePrefix + this._text(path).replace(/[^a-z0-9]+/gi, "_"); }
  _rememberTitle(path, title) {
    const seriesPath = this._seriesPath(path), value = this._normalize(title);
    if (seriesPath && value) this._setPreference(this._titleKey(seriesPath), value);
  }
  _cachedTitle(path) {
    const seriesPath = this._seriesPath(path);
    return seriesPath ? this._normalize(this._preference(this._titleKey(seriesPath), "")) : "";
  }
  _descriptionKey(path) { return this.descriptionCachePrefix + this._text(path).replace(/[^a-z0-9]+/gi, "_"); }
  _safeSeriesDescription(value) {
    const text = this._normalize(value);
    if (!text || /등록된\s*줄거리가\s*없습니다/i.test(text)) return "";
    if (/^20\d{2}[-./]\d{1,2}[-./]\d{1,2}(?:\s|$)/.test(text)) return "";
    if (/^(?:제\s*)?\d+(?:[-.]\d+)?(?:화|회)(?:\s|$)/.test(text)) return "";
    return text;
  }
  _rememberDescription(path, description) {
    const seriesPath = this._seriesPath(path), value = this._safeSeriesDescription(description);
    if (seriesPath && value) this._setPreference(this._descriptionKey(seriesPath), value);
  }
  _cachedDescription(path) {
    const seriesPath = this._seriesPath(path);
    return seriesPath ? this._safeSeriesDescription(this._preference(this._descriptionKey(seriesPath), "")) : "";
  }
  _manualBaseUrl() { const manual = this._trimSlash(this._preference("tvwiki_domain_url", "")); return this._isAllowedBase(manual) ? manual : ""; }
  _cachedBaseUrl() { const cached = this._trimSlash(this._preference(this.cachedBaseKey, "")); return this._isAllowedBase(cached) ? cached : ""; }
  _headers(referer, accept) { const base = this._origin(referer) || this._manualBaseUrl() || this._cachedBaseUrl() || this.fallbackBaseUrl; return { "User-Agent": this.userAgent, "Accept": accept || "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8", "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8", "Referer": referer || base + "/" }; }
  _client(kind, timeout) {
    if (kind === "rhttp") return new Client({ persistentConnection: false, noProxy: true, timeout: timeout || 25, connectTimeout: 8 });
    return new Client({ useDartHttpClient: true, persistentConnection: false, timeout: timeout || 25, connectTimeout: 8 });
  }
  _clientOrder() {
    const preferred = this._preference(this.httpClientKey, "dart");
    return preferred === "rhttp" ? ["rhttp", "dart"] : ["dart", "rhttp"];
  }
  async _resolveBaseUrl() {
    const manual = this._manualBaseUrl();
    if (manual) return manual;
    const cached = this._cachedBaseUrl(), cachedAt = Number(this._preference(this.cachedBaseTimeKey, "0")) || 0;
    if (cached && Date.now() - cachedAt < this.baseCacheMs) return cached;
    try {
      const body = await this._get(this.signalUrl, "https://wankyo83.github.io/", "중앙신호등", { "Accept": "application/json" });
      const data = JSON.parse(body), resolved = this._trimSlash(data && data.domains && data.domains.tvwiki && data.domains.tvwiki.baseUrl);
      if (this._isAllowedBase(resolved)) {
        this._setPreference(this.cachedBaseKey, resolved);
        this._setPreference(this.cachedBaseTimeKey, String(Date.now()));
        return resolved;
      }
    } catch (_) {}
    return cached || this.fallbackBaseUrl;
  }
  async _get(url, referer, stage, extra) {
    const failures = [];
    for (const kind of this._clientOrder()) {
      const client = this._client(kind, 18);
      const headers = this._headers(referer); Object.assign(headers, extra || {});
      try {
        const response = await client.get(url, headers);
        if (!response || response.statusCode < 200 || response.statusCode >= 300) throw new Error("HTTP " + (response && response.statusCode));
        this._setPreference(this.httpClientKey, kind);
        return this._text(response.body);
      } catch (error) {
        failures.push(kind.toUpperCase() + " " + this._text(error && error.message || error));
      }
    }
    throw new Error("티비위키 " + stage + " 요청 실패: " + (failures.join(" | ") || "응답 없음"));
  }
  _image(base, node) {
    if (!node) return "";
    const image = node.tagName && this._text(node.tagName).toLowerCase() === "img" ? node : node.selectFirst("img");
    if (!image) return "";
    for (const key of ["data-original", "data-src", "src"]) { const value = this._text(image.attr(key)); if (value && !/^data:/i.test(value)) return this._absolute(base, value); }
    return "";
  }
  _parseCards(document, base) {
    const list = [], seen = {};
    const boxes = [];
    for (const selector of ["#list_type .box", "#line_type .box", "#mov_con_list .box"]) {
      for (const box of document.select(selector)) boxes.push(box);
    }
    for (const box of boxes) {
      const link = box.selectFirst("a.title2[href]") || box.selectFirst("a.title[href]") || box.selectFirst("a.img[href]") || box.selectFirst("a[href]");
      const path = link ? this._seriesPath(link.attr("href")) : "";
      if (!path || seen[path]) continue;
      const titleNode = box.selectFirst("a.title2") || box.selectFirst("a.title") || box.selectFirst(".subject");
      const imageNode = box.selectFirst("a.img") || box;
      const name = this._normalize((titleNode && (titleNode.attr("title") || titleNode.text)) || (link && (link.attr("title") || link.text)));
      if (!name) continue;
      const imageUrl = this._image(base, imageNode);
      const descriptionNode = box.selectFirst(".thumb-desc");
      const description = this._safeSeriesDescription(descriptionNode && descriptionNode.text);
      this._rememberPoster(path, imageUrl);
      this._rememberTitle(path, name);
      this._rememberDescription(path, description);
      list.push({ name, link: path, imageUrl, description });
      seen[path] = true;
    }
    return list;
  }
  _htmlAttr(attributes, name) {
    const match = this._text(attributes).match(new RegExp("\\b" + name + "\\s*=\\s*([\\\"'])([\\s\\S]*?)\\1", "i"));
    return match ? match[2] : "";
  }
  _stripHtml(value) {
    return this._normalize(this._text(value).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;|&#34;/gi, "\"").replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, function(_, code) { try { return String.fromCodePoint(Number(code)); } catch (_) { return _; } }).replace(/&#x([0-9a-f]+);/gi, function(_, code) { try { return String.fromCodePoint(parseInt(code, 16)); } catch (_) { return _; } }));
  }
  _parseCardsHtml(html, base, remember) {
    const list = [], seen = {}, blocks = [], boxRegex = /<div\b[^>]*class=["'][^"']*\bbox\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
    let boxMatch;
    while ((boxMatch = boxRegex.exec(this._text(html))) !== null) blocks.push(boxMatch[1]);
    for (const block of blocks) {
      const anchors = []; let anchorMatch;
      const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
      while ((anchorMatch = anchorRegex.exec(block)) !== null) {
        const attrs = anchorMatch[1], href = this._htmlAttr(attrs, "href"), path = this._seriesPath(href);
        if (path) anchors.push({ attrs, href, path, text: this._stripHtml(anchorMatch[2]), className: this._htmlAttr(attrs, "class") });
      }
      if (!anchors.length) continue;
      let selected = null;
      for (const anchor of anchors) if (/\b(?:title2?|subject)\b/i.test(anchor.className)) { selected = anchor; break; }
      selected = selected || anchors[0];
      if (seen[selected.path]) continue;
      let name = selected.text || this._htmlAttr(selected.attrs, "title");
      if (!name) for (const anchor of anchors) if (anchor.text) { name = anchor.text; break; }
      const imageMatch = block.match(/<img\b([^>]*)>/i); let imageUrl = "";
      if (imageMatch) for (const key of ["data-original", "data-src", "src"]) { const value = this._htmlAttr(imageMatch[1], key); if (value && !/^data:/i.test(value)) { imageUrl = this._absolute(base, value); break; } }
      const descriptionMatch = block.match(/<span\b[^>]*class=["'][^"']*\bthumb-desc\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
      const description = this._safeSeriesDescription(descriptionMatch ? this._stripHtml(descriptionMatch[1]) : "");
      if (!name) continue;
      if (remember !== false) this._rememberPoster(selected.path, imageUrl);
      name = this._normalize(name);
      if (remember !== false) this._rememberTitle(selected.path, name);
      if (remember !== false) this._rememberDescription(selected.path, description);
      list.push({ name, link: selected.path, imageUrl, description });
      seen[selected.path] = true;
    }
    return list;
  }
  _hasNext(document, page) {
    if (document.selectFirst("a[rel='next'][href]") || document.selectFirst(".pg_next[href]") || document.selectFirst(".pagination .next[href]")) return true;
    const wanted = String((Number(page) || 1) + 1);
    const links = [];
    for (const selector of [".pg_wrap a[href]", ".pagination a[href]"]) for (const link of document.select(selector)) links.push(link);
    for (const link of links) if (this._normalize(link.text) === wanted) return true;
    return false;
  }
  async _listing(path, page) {
    const base = await this._resolveBaseUrl(), join = path.indexOf("?") >= 0 ? "&" : "?", url = base + path + join + "page=" + Math.max(1, Number(page) || 1);
    const html = await this._get(url, base + "/", "목록"), document = new Document(html);
    let list = this._parseCards(document, base);
    if (!list.length) list = this._parseCardsHtml(html, base);
    return { list, hasNextPage: this._hasNext(document, page) };
  }

  _koreaWeekday() { return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCDay()]; }
  _weekdayName(slug) { return ({ monday: "월요일", tuesday: "화요일", wednesday: "수요일", thursday: "목요일", friday: "금요일", saturday: "토요일", sunday: "일요일" })[slug] || "오늘"; }
  async _remoteTabCard(tab) {
    const day = this._koreaWeekday();
    const customSource = this._text(this._preference("tvwiki_custom_card_json_url", "")).trim();
    const customImage = await this._customCardUrl(day);
    const event = customSource ? null : await dcTvwikiEventCard();
    const official = customImage || event ? null : await dcTvwikiRemoteCard(tab, "오늘의 미디어");
    return {
      name: customImage ? this._weekdayName(day) : event ? event.name : official.name,
      link: "/__tvwiki_card__/remote-" + day,
      imageUrl: customImage || (event && event.imageUrl) || official.imageUrl
    };
  }
  _cardImage(file) { return this.cardBaseUrl + "/" + file + "?revision=" + encodeURIComponent(this.cardRevision); }
  _sectionCard(key, name) { return { name, link: "/__tvwiki_card__/section-" + key, imageUrl: this._cardImage(key + ".jpg") }; }
  _periodName(period) { const found = this.periods.find(function(item) { return item[1] === period; }); return found ? found[0].replace(" 기간", "") : "일간"; }
  _top100Card(period) { return { name: this._periodName(period) + " TOP 100", link: "/__tvwiki_card__/top100-" + period, imageUrl: this._cardImage("popular-top100.jpg") }; }
  _searchCard(category, count) {
    const found = this.categories.find(function(item) { return item[1] === category; }), label = found ? found[0] : "전체";
    const suffix = Number.isFinite(Number(count)) && Number(count) >= 0 ? " · " + Number(count) + "개" : " 검색 결과";
    return { name: label + suffix, link: "/__tvwiki_card__/search-" + category, imageUrl: this._cardImage("search.jpg") };
  }
  _parseScopedCards(scope, base, limit) {
    const list = [], seen = {};
    if (!scope) return list;
    for (const box of scope.select(".box")) {
      const link = box.selectFirst("a.title2[href]") || box.selectFirst("a.title[href]") || box.selectFirst("a.img[href]") || box.selectFirst("a[href]");
      const path = link ? this._seriesPath(link.attr("href")) : "";
      if (!path || seen[path]) continue;
      const titleNode = box.selectFirst("a.title2") || box.selectFirst("a.title") || box.selectFirst(".subject");
      const name = this._normalize((titleNode && (titleNode.attr("title") || titleNode.text)) || (link && (link.attr("title") || link.text)));
      if (!name) continue;
      const imageUrl = this._image(base, box.selectFirst("a.img") || box);
      const descriptionNode = box.selectFirst(".thumb-desc");
      const description = this._safeSeriesDescription(descriptionNode && descriptionNode.text);
      this._rememberPoster(path, imageUrl);
      this._rememberTitle(path, name);
      this._rememberDescription(path, description);
      list.push({ name, link: path, imageUrl, description });
      seen[path] = true;
      if (limit && list.length >= limit) break;
    }
    return list;
  }
  _parseHomeSectionHtml(html, base, selector, limit) {
    const className = this._text(selector).replace(/^\./, "").trim();
    if (!className) return [];
    const source = this._text(html), startPattern = new RegExp("<div\\b[^>]*class=[\\\"'][^\\\"']*\\b" + className.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&") + "\\b[^\\\"']*[\\\"'][^>]*>", "i");
    const startMatch = startPattern.exec(source);
    if (!startMatch) return [];
    const start = startMatch.index, tail = source.slice(start + startMatch[0].length);
    const carouselPattern = new RegExp("\\$\\(\\s*[\\\"']\\." + className.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&") + "[\\\"']\\s*\\)\\.owlCarousel", "i");
    const carouselMatch = carouselPattern.exec(tail);
    const segment = source.slice(start, carouselMatch ? start + startMatch[0].length + carouselMatch.index : Math.min(source.length, start + 20000));
    return this._parseCardsHtml(segment, base).slice(0, Math.max(1, Number(limit) || 100));
  }
  async _homeFeed() {
    const pendingCard = this._remoteTabCard("popular"), base = await this._resolveBaseUrl();
    const pendingHtml = this._get(base + "/", base + "/", "홈 인기");
    const values = await Promise.all([pendingCard, pendingHtml]), html = values[1], document = new Document(html), list = [values[0]];
    for (const section of this.homeSections) {
      list.push(this._sectionCard(section.key, section.name));
      const domItems = this._parseScopedCards(document.selectFirst(section.selector), base, section.limit);
      const htmlItems = this._parseHomeSectionHtml(html, base, section.selector, section.limit);
      Array.prototype.push.apply(list, (htmlItems.length > domItems.length ? htmlItems : domItems).slice(0, section.limit));
    }
    return { list, hasNextPage: false };
  }
  async _ranking(page, period, category, includeRemote) {
    const number = Math.max(1, Number(page) || 1), path = "/popular?period=" + encodeURIComponent(period) + (category && category !== "all" ? "&sb=" + encodeURIComponent(category) : "");
    if (number !== 1) return this._listing(path, number);
    const tasks = includeRemote ? [this._remoteTabCard("latest"), this._listing(path, number)] : [this._listing(path, number)];
    const values = await Promise.all(tasks), result = includeRemote ? values[1] : values[0];
    const prefix = includeRemote ? [values[0], this._top100Card(period)] : [this._top100Card(period)];
    return { list: prefix.concat(result.list || []), hasNextPage: result.hasNextPage === true };
  }

  _defaultPopularRule() { return { mode: "home", category: "all", period: "d" }; }
  _defaultLatestRule() { return { mode: "popular", category: "all", period: "d" }; }
  _normalizeTabRule(rule, fallback) {
    const base = fallback || this._defaultLatestRule(), value = rule || base;
    const mode = ["home", "latest", "popular"].indexOf(value.mode) >= 0 ? value.mode : base.mode;
    const category = this._allowedCategory(value.category) ? value.category : base.category;
    const period = this.periods.some(function(item) { return item[1] === value.period; }) ? value.period : base.period;
    return { mode, category, period };
  }
  _encodeTabRule(rule) { const value = this._normalizeTabRule(rule, this._defaultLatestRule()); return ["1", value.mode, value.category, value.period].join("|"); }
  _decodeTabRule(value, fallback) { const parts = this._text(value).split("|"); return parts.length === 4 && parts[0] === "1" ? this._normalizeTabRule({ mode: parts[1], category: parts[2], period: parts[3] }, fallback) : this._normalizeTabRule(fallback, this._defaultLatestRule()); }
  _tabRule(key, fallback) { const value = this._preference(key, ""); return value ? this._decodeTabRule(value, fallback) : this._normalizeTabRule(fallback, this._defaultLatestRule()); }
  async _tabResult(page, tab, rule) {
    const value = this._normalizeTabRule(rule, tab === "popular" ? this._defaultPopularRule() : this._defaultLatestRule());
    if (value.mode === "home") return Number(page) === 1 ? this._homeFeed() : { list: [], hasNextPage: false };
    if (value.mode === "popular") return this._ranking(page, value.period, value.category, true);
    const result = await this._listing("/" + (value.category === "all" ? "drama" : value.category), page);
    if (Number(page) === 1) result.list = [await this._remoteTabCard(tab)].concat(result.list || []);
    return result;
  }
  async getPopular(page) { return this._tabResult(page, "popular", this._tabRule(this.popularRulePreference, this._defaultPopularRule())); }
  async getLatestUpdates(page) { return this._tabResult(page, "latest", this._tabRule(this.latestRulePreference, this._defaultLatestRule())); }

  _filterValue(filters, type, fallback) {
    if (!filters) return fallback;
    const source = Array.isArray(filters) ? filters : Object.keys(filters).map(function(key) { return filters[key]; });
    for (const item of source) if (item && (item.type === type || item.name === type)) {
      if (Array.isArray(item.values) && item.values.length) {
        const index = Number(item.state);
        const selected = item.values[Number.isFinite(index) && index >= 0 ? index : 0];
        if (selected && selected.value !== undefined) return this._text(selected.value);
      }
      const value = item.value !== undefined ? item.value : item.state;
      if (value && typeof value === "object" && value.value !== undefined) return this._text(value.value);
      if (typeof value === "string" && value && !/^\d+$/.test(value)) return value;
      return fallback;
    }
    return fallback;
  }
  _applyTabRuleAction(page, filters, rule) {
    if (Number(page) !== 1) return;
    const action = Number(this._filterValue(filters, "tabRuleAction", "0"));
    if (action === 1) this._setPreference(this.popularRulePreference, this._encodeTabRule(rule));
    else if (action === 2) this._setPreference(this.latestRulePreference, this._encodeTabRule(rule));
    else if (action === 3) this._setPreference(this.popularRulePreference, "");
    else if (action === 4) this._setPreference(this.latestRulePreference, "");
    else if (action === 5) { this._setPreference(this.popularRulePreference, ""); this._setPreference(this.latestRulePreference, ""); }
  }
  async search(query, page, filters) {
    const base = await this._resolveBaseUrl(), text = this._normalize(query);
    const mode = this._filterValue(filters, "mode", "latest"), category = this._filterValue(filters, "category", "all"), period = this._filterValue(filters, "period", "d");
    if (text) {
      const sort = mode === "popular" ? "wr_good" : "subIdx";
      const url = base + "/search?stx=" + encodeURIComponent(text) + "&sst=" + encodeURIComponent(sort) + (category !== "all" ? "&onetable=" + encodeURIComponent(category) : "") + "&page=" + Math.max(1, Number(page) || 1);
      const html = await this._get(url, base + "/", "검색"), document = new Document(html);
      let list = this._parseCards(document, base);
      if (!list.length) list = this._parseCardsHtml(html, base);
      if (Number(page) === 1) list.unshift(this._searchCard(category, this._searchCount(document, category)));
      return { list, hasNextPage: this._hasNext(document, page) };
    }
    const rule = this._normalizeTabRule({ mode, category, period }, this._defaultLatestRule());
    const result = mode === "popular" ? await this._ranking(page, period, category, false) : await this._listing("/" + (category === "all" ? "drama" : category), page);
    this._applyTabRuleAction(page, filters, rule);
    return result;
  }

  _searchCount(document, category) {
    let fallback = NaN;
    for (const link of document.select(".board-tabs a[href]")) {
      const text = this._normalize(link.text), countMatch = text.match(/\((\d+)\)\s*$/), href = this._text(link.attr("href")).replace(/&amp;/g, "&");
      if (!countMatch) continue;
      const count = Number(countMatch[1]);
      if (!href.match(/[?&]onetable=/i)) fallback = count;
      const tableMatch = href.match(/[?&]onetable=([^&#]+)/i), table = tableMatch ? decodeURIComponent(tableMatch[1]) : "all";
      if (table === category) return count;
    }
    return category === "all" ? fallback : NaN;
  }

  _cleanSeriesTitle(value) {
    return this._normalize(value).replace(/\s+\d+(?:[-.]\d+)?화(?:\s+다시보기)?\s*$/i, "").replace(/\s+다시보기(?:\s*-\s*티비위키)?\s*$/i, "");
  }
  _episodeDisplayName(value) {
    const name = this._normalize(value);
    const explicitEpisode = name.match(/(?:^|\s)에피소드\s*(\d+(?:[-.]\d+)?화)(?:\s+다시보기)?\s*$/i);
    if (explicitEpisode) return explicitEpisode[1];
    const leadingEpisode = name.match(/^(\d+(?:[-.]\d+)?화)(?:\s|$)/i);
    if (leadingEpisode) return leadingEpisode[1];
    const trailingEpisode = name.match(/(\d+(?:[-.]\d+)?화)(?:\s+다시보기)?\s*$/i);
    return trailingEpisode ? trailingEpisode[1] : name;
  }
  _chapterIdentity(seriesTitle, chapterName) {
    let name = this._text(chapterName).toLowerCase().replace(this._text(seriesTitle).toLowerCase(), "").trim().replace(/,/g, ".").replace(/-/g, ".");
    name = name.replace(/\s(?=extra|special|omake)/g, "");
    const seasonMatch = name.match(/\b(?:staffel|season|saison|temporada|s)\s*([0-9]+)/i);
    const season = seasonMatch ? Number(seasonMatch[1]) || 0 : 0;
    const episodeMatch = name.match(/\b(?:folge|episode|ep\.?)\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (episodeMatch) return season + "::" + episodeMatch[1];
    const stripped = name.replace(/\b(?:v|ver|vol|version|volume|season|staffel|saison|temporada|s)[^a-z]?[0-9]+/gi, "");
    const number = stripped.match(/([0-9]+)(\.[0-9]+)?(\.?[a-z]+)?/i);
    return number ? season + "::" + number[1] + (number[2] || "") : "";
  }
  _episodeVariantBase(sourceName, seriesTitle) {
    const source = this._normalize(sourceName);
    if (/코멘터리/i.test(source)) return "코멘터리";
    if (/비하인드/i.test(source)) return "비하인드";
    if (/스페셜|특별|번외|외전/i.test(source)) return "스페셜";
    if (source.toLowerCase().indexOf(this._normalize(seriesTitle).toLowerCase()) >= 0) return "본편";
    return "별도 영상";
  }
  _assignEpisodeVariants(episodes, seriesTitle) {
    const groups = {};
    for (const episode of episodes) {
      const key = this._chapterIdentity(seriesTitle, episode.name);
      if (!key) continue;
      if (!groups[key]) groups[key] = [];
      groups[key].push(episode);
    }
    for (const key of Object.keys(groups)) {
      const group = groups[key];
      if (group.length < 2) continue;
      const sourceNames = group.map((item) => this._normalize(item._sourceName));
      const sameName = sourceNames.every((value) => value === sourceNames[0]);
      const used = {};
      for (let index = 0; index < group.length; index++) {
        let label = sameName ? "동일 회차" : this._episodeVariantBase(group[index]._sourceName, seriesTitle);
        used[label] = (used[label] || 0) + 1;
        const total = sameName ? group.length : group.filter((item) => this._episodeVariantBase(item._sourceName, seriesTitle) === label).length;
        if (total > 1) label += " " + used[label];
        group[index].scanlator = label;
      }
    }
    for (const episode of episodes) delete episode._sourceName;
    return episodes;
  }
  _parseDate(value) { const match = this._text(value).match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/); return match ? String(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()) : ""; }
  async _searchSeriesDescription(base, path, title) {
    const cached = this._cachedDescription(path);
    if (cached) return cached;
    const category = path.split("/")[1];
    const prefix = base + "/search?stx=" + encodeURIComponent(title) + "&sst=subIdx&onetable=" + encodeURIComponent(category);
    for (let page = 1; page <= 2; page++) {
      let html = "";
      for (const kind of this._clientOrder()) {
        try {
          const response = await this._client(kind, 6).get(prefix + "&page=" + page, this._headers(base + "/"));
          if (!response || response.statusCode < 200 || response.statusCode >= 300) continue;
          html = this._text(response.body);
          this._setPreference(this.httpClientKey, kind);
          break;
        } catch (_) {}
      }
      if (!html) return "";
      const cards = this._parseCardsHtml(html, base, false);
      const match = cards.find(function(item) { return item.link === path; });
      if (match) {
        const description = this._safeSeriesDescription(match.description);
        this._rememberDescription(path, description);
        return description;
      }
      if (cards.length < 30) break;
    }
    return "";
  }
  async _cardDetail(url) {
    const match = this._text(url).match(/\/__tvwiki_card__\/([a-z0-9-]+)/i);
    if (!match) return null;
    const key = match[1];
    let item = null, description = "목록을 구분하는 안내 카드입니다. 뒤로 돌아가 작품을 선택해 주세요.", genre = ["구분 카드"];
    if (key.indexOf("remote-") === 0) {
      item = await this._remoteTabCard("popular");
      description = "공용 원격 카드입니다. 뒤로 돌아가 작품을 선택해 주세요.";
      genre = ["요일 안내"];
    } else if (key.indexOf("section-") === 0) {
      const sectionKey = key.slice(8), section = this.homeSections.find(function(value) { return value.key === sectionKey; });
      if (section) item = this._sectionCard(section.key, section.name);
    } else if (key.indexOf("top100-") === 0) {
      item = this._top100Card(key.slice(7));
      description = "티비위키 인기 영상 TOP 100 목록을 구분하는 안내 카드입니다.";
    } else if (key.indexOf("search-") === 0) {
      item = this._searchCard(key.slice(7), NaN);
      description = "검색 결과를 구분하는 안내 카드입니다.";
    }
    if (!item) throw new Error("잘못된 티비위키 안내 카드입니다.");
    return { name: item.name, link: this._text(url), imageUrl: item.imageUrl, author: "티비위키", artist: "", description, genre, status: 0, episodes: [], chapters: [] };
  }
  async getDetail(url) {
    const card = await this._cardDetail(url);
    if (card) return card;
    const base = await this._resolveBaseUrl(), path = this._seriesPath(url);
    if (!path) throw new Error("잘못된 티비위키 작품 주소입니다.");
    const document = new Document(await this._get(base + path, base + "/", "상세"));
    const heading = document.selectFirst("#bo_v_title .bo_v_tit") || document.selectFirst("#bo_v_title h1");
    const openGraphTitle = document.selectFirst("meta[property='og:title']");
    const headingTitle = heading && heading.text;
    const openGraphValue = openGraphTitle && openGraphTitle.attr && openGraphTitle.attr("content");
    const seriesTitle = this._cleanSeriesTitle(this._cachedTitle(path) || openGraphValue || headingTitle || "티비위키");
    this._rememberTitle(path, seriesTitle);
    const episodes = [], seen = {};
    const imageUrl = this._cachedPoster(path);
    const episodeItems = document.select("#other_list li[data-ep-idx]");
    const allEpisodeItems = episodeItems.length ? episodeItems : document.select("#other_list li");
    for (const item of allEpisodeItems) {
      const link = item.selectFirst("a.title.ep-link[href]") || item.selectFirst("a.title[href]") || item.selectFirst("a.ep-link[href]") || item.selectFirst("a[href]");
      const episodePath = link ? this._episodePath(link.attr("href")) : "";
      if (!episodePath || seen[episodePath]) continue;
      const sourceName = this._normalize((link && (link.attr("title") || link.text)) || item.text);
      const name = this._episodeDisplayName(sourceName);
      const info = item.selectFirst(".date, .datetime, time");
      episodes.push({ name: name || "회차", url: episodePath, dateUpload: this._parseDate(info ? info.text : item.text), _sourceName: sourceName });
      seen[episodePath] = true;
    }
    this._assignEpisodeVariants(episodes, seriesTitle);
    const searchDescription = await this._searchSeriesDescription(base, path, seriesTitle);
    const description = searchDescription;
    this._rememberDescription(path, description);
    const category = path.split("/")[1], categoryName = (this.categories.find(function(item) { return item[1] === category; }) || [category])[0];
    return { name: seriesTitle, link: path, imageUrl, author: "", artist: "", description, genre: [categoryName], status: 0, episodes, chapters: episodes };
  }

  _base64Url(value) {
    const bytes = [];
    const encoded = unescape(encodeURIComponent(this._text(value)));
    for (let i = 0; i < encoded.length; i++) bytes.push(encoded.charCodeAt(i));
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; let out = "";
    for (let i = 0; i < bytes.length; i += 3) { const a = bytes[i], hb = i + 1 < bytes.length, hc = i + 2 < bytes.length, b = hb ? bytes[i + 1] : 0, c = hc ? bytes[i + 2] : 0, n = (a << 16) | (b << 8) | c; out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + (hb ? chars[(n >> 6) & 63] : "=") + (hc ? chars[n & 63] : "="); }
    return out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async _episodeData(base, episodePath) {
    const parts = episodePath.split("/").filter(Boolean), endpoint = base + "/bbs/get_episode.php?bo_table=" + encodeURIComponent(parts[0]) + "&wr_id=" + encodeURIComponent(parts[1]) + "&ep_idx=" + encodeURIComponent(parts[2]);
    const body = await this._get(endpoint, base + episodePath, "회차 정보", { "Accept": "application/json", "X-Requested-With": "XMLHttpRequest" });
    const data = JSON.parse(body);
    if (!data || data.success !== true || !data.episode) throw new Error("사이트가 회차 정보를 제공하지 않았습니다.");
    return data.episode;
  }
  _sessionPayloads(sessionData) {
    const output = [];
    for (let payload of sessionData || []) {
      if (!payload) continue;
      if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch (_) {} }
      const encoded = JSON.stringify(payload);
      if (!output.some(function(item) { return item.encoded === encoded; })) output.push({ value: payload, encoded });
    }
    return output;
  }
  _validSession(result) { return result && result.success && result.player_url && result.t && result.sig; }
  async _directSession(client, base, headers, payload) {
    const response = await client.post(base + "/api/create_session.php", headers, payload);
    if (!response || response.statusCode < 200 || response.statusCode >= 300) throw new Error("직접 HTTP " + (response && response.statusCode));
    const result = JSON.parse(this._text(response.body));
    if (!this._validSession(result)) throw new Error("직접 응답 형식 불일치");
    return result;
  }
  async _bridgeSession(client, base, episodePath, headers, payload) {
    const requestBody = { baseUrl: base, episodePath, sessionData: payload };
    const response = await client.post(this.bridgeBaseUrl + "/api/tvwiki-session", headers, requestBody);
    if (!response || response.statusCode < 200 || response.statusCode >= 300) throw new Error("복구 HTTP " + (response && response.statusCode));
    const result = JSON.parse(this._text(response.body));
    if (!this._validSession(result)) throw new Error("복구 응답 형식 불일치");
    return result;
  }
  async _createSession(base, episodePath, sessionData) {
    const payloads = this._sessionPayloads(sessionData);
    if (!payloads.length) throw new Error("티비위키 재생 세션 자료가 없습니다.");
    const headers = this._headers(base + episodePath, "application/json");
    headers["Content-Type"] = "application/json; charset=utf-8";
    headers["Origin"] = base;
    const bridgeHeaders = this._headers(this.bridgeBaseUrl + "/", "application/json");
    bridgeHeaders["Content-Type"] = "application/json; charset=utf-8";
    const failures = [];
    for (const payload of payloads) {
      for (const kind of this._clientOrder()) {
        try {
          return await this._bridgeSession(this._client(kind, 12), base, episodePath, bridgeHeaders, payload.value);
        } catch (error) { failures.push("복구 " + kind.toUpperCase() + ": " + this._text(error && error.message || error)); }
      }
      for (const kind of this._clientOrder()) {
        try {
          return await this._directSession(this._client(kind, 14), base, headers, payload.value);
        } catch (error) { failures.push("직접 " + kind.toUpperCase() + ": " + this._text(error && error.message || error)); }
      }
    }
    throw new Error("티비위키 재생 세션을 만들지 못했습니다: " + (failures.join(" || ") || "응답 없음"));
  }
  async getVideoList(url) {
    const base = await this._resolveBaseUrl(), episodePath = this._episodePath(url);
    if (!episodePath) throw new Error("잘못된 티비위키 회차 주소입니다.");
    const episode = await this._episodeData(base, episodePath);
    if ((!episode.session_data1 && !episode.session_data2) || !episode.hls_url) throw new Error("사이트가 재생 정보를 제공하지 않았습니다.");
    const session = await this._createSession(base, episodePath, [episode.session_data1, episode.session_data2]);
    const separator = this._text(session.player_url).indexOf("?") >= 0 ? "&" : "?";
    const playerUrl = this._absolute(base + episodePath, session.player_url) + separator + "t=" + encodeURIComponent(session.t) + "&sig=" + encodeURIComponent(session.sig);
    const playlistUrl = this._absolute(playerUrl, episode.hls_url);
    const headers = { "User-Agent": this.userAgent, "Accept": "*/*", "Referer": playerUrl, "Origin": this._origin(playerUrl) };
    const playlist = await this._get(playlistUrl, playerUrl, "재생목록", headers), keyMatch = playlist.match(/#EXT-X-KEY:[^\r\n]*URI="([^"]+)"/i);
    if (!keyMatch) return [{ url: playlistUrl, originalUrl: playlistUrl, quality: "자동 (HLS)", headers, subtitles: [], audios: [] }];
    const keyUrl = this._absolute(playlistUrl, keyMatch[1]), envelope = await this._get(keyUrl, playerUrl, "영상 키", headers);
    JSON.parse(envelope);
    const common = "u=" + encodeURIComponent(this._base64Url(playlistUrl)) + "&r=" + encodeURIComponent(this._base64Url(playerUrl)) + "&x=" + encodeURIComponent(this._base64Url(envelope));
    return [
      { url: this.bridgeBaseUrl + "/api/tvwiki-playlist.m3u8?m=f&" + common, originalUrl: playlistUrl, quality: "빠른 재생 (CDN 직접)", headers, subtitles: [], audios: [] },
      { url: this.bridgeBaseUrl + "/api/tvwiki-playlist.m3u8?m=p&" + common, originalUrl: playlistUrl, quality: "호환 재생 (중계)", headers, subtitles: [], audios: [] }
    ];
  }

  async getPageList() { return []; }
  async getHtmlContent() { return ""; }
  async cleanHtmlContent(html) { return html; }
  getHeaders(url) { return this._headers(this._origin(url) + "/", "*/*"); }
  _option(name, value) { return { type_name: "SelectOption", name, value }; }
  _select(type, name, pairs) { const option = this._option.bind(this); return { type, name, type_name: "SelectFilter", values: pairs.map(function(item) { return option(item[0], item[1]); }) }; }
  getFilterList() {
    return [
      { type: "usage", name: "인기/최신 탭 구성", type_name: "HeaderFilter" },
      this._select("category", "카테고리", this.categories),
      this._select("period", "기간", this.periods),
      this._select("mode", "목록 방식", [["최신", "latest"], ["인기", "popular"]]),
      this._select("tabRuleAction", "인기/최신 탭 저장", [["저장하지 않음", "0"], ["현재 조건을 인기 탭에 저장", "1"], ["현재 조건을 최신 탭에 저장", "2"], ["인기 탭 기본값 복원", "3"], ["최신 탭 기본값 복원", "4"], ["두 탭 모두 기본값 복원", "5"]])
    ];
  }
  getSourcePreferences() {
    return [
      { key: "tvwiki_domain_url", editTextPreference: { title: "티비위키 주소 직접 지정 (선택)", summary: "빈 값이면 중앙신호등의 최신 주소를 사용하고, 실패하면 마지막 정상 주소로 복구합니다.", value: "", dialogTitle: "https://tvwiki49.net", dialogMessage: "tvwiki숫자.net 형식의 HTTPS 주소만 허용됩니다." } },
      { key: "tvwiki_custom_card_json_url", editTextPreference: { title: "커스텀 목록 카드 (선택)", summary: "공개 JSON 주소 1개로 요일별 카드 7장을 설정합니다. 360×540 GIF·WebP를 권장하며 용량·프레임 제한은 없습니다.", value: "", dialogTitle: "커스텀 목록 카드 JSON 주소", dialogMessage: "Google Drive 공개 공유 링크 또는 직접 JSON 주소를 넣으세요. 개인 카드를 설정하면 공용 이벤트 카드는 표시되지 않습니다. 빈 값이면 공용 이벤트 또는 기본 원격 카드를 사용합니다." } }
    ];
  }
}

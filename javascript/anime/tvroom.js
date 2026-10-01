const mangayomiSources = [{
  name: "티비룸",
  lang: "ko",
  baseUrl: "https://tvroom36.org",
  apiUrl: "",
  iconUrl: "https://dc-toki-mangayomi-media.pages.dev/icon/ko.media.png",
  typeSource: "single",
  itemType: 1,
  isNsfw: false,
  hasCloudflare: false,
  version: "0.1.22",
  dateFormat: "",
  dateFormatLocale: "",
  pkgPath: "anime/src/ko/tvroom.js",
  notes: "애니 목록·상세 제목 한국어/일본어 전환 · 제목 언어 설정 캐시 키 갱신 · Anissia 일본어 원제 우선 + AniList 보조 · 새로고침 즉시 반영 · 영화·드라마 등 한국어 유지 · 기본 인기: 메인 추천 · 기본 최신: 카테고리별 최신 12개 · 커스텀 목록 카드 · HLS 영상 캐시 최적화 · 호환 재생 제공 · 영상 다운로드 호환"
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
    this.fallbackBaseUrl = "https://tvroom32.org";
    this.assetBaseUrl = "https://dc-toki-mangayomi-media.pages.dev";
    this.userAgent = "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/143.0.0.0 Mobile Safari/537.36";
    this.popularRulePreference = "tvroom_popular_rule_v1";
    this.latestRulePreference = "tvroom_latest_rule_v1";
    this.titleLanguagePreference = "tvroom_anime_title_language_v2";
    this.titleCachePrefix = "tvroom_anime_title_meta_v3_";
    this.animePathCachePrefix = "tvroom_anime_path_v1_";
    this.categories = [
      { key: "movie", name: "영화", path: "영화", search: "영화", section: "최신영화", image: "movie.jpg" },
      { key: "drama", name: "드라마", path: "드라마", search: "드라마", section: "최신드라마", image: "drama.jpg" },
      { key: "variety", name: "예능", path: "TV예능", search: "예능", section: "최신예능", image: "variety.jpg" },
      { key: "music", name: "음악프로", path: "음악프로", search: "음악프로", section: "최신음악프로", image: "music.jpg" },
      { key: "anime", name: "애니", path: "애니", search: "애니", section: "최신애니", image: "anime.jpg" },
      { key: "current", name: "시사·다큐", path: "시사다큐", search: "시사다큐", section: "최신시사/다큐", image: "current-documentary.jpg" }
    ];
    this.contentOptions = [["전체", "all"]].concat(this.categories.map(function(c) { return [c.name, c.key]; }));
    this.countryOptions = [["전체", "전체"], ["한국", "한국"], ["외국", "외국"]];
    this.orderOptions = [["시간순", "시간순"], ["인기순", "인기순"]];
  }

  get supportsLatest() { return true; }
  _text(v) { return v === null || v === undefined ? "" : String(v); }
  _trimSlash(v) { return this._text(v).trim().replace(/\/+$/, ""); }
  _origin(v) { const m = this._text(v).match(/^(https?:\/\/[^/]+)/i); return m ? m[1] : ""; }
  _relativePath(v) { let s = this._text(v).trim(); if (/^https?:\/\//i.test(s)) s = s.replace(/^https?:\/\/[^/]+/i, ""); if (s && !s.startsWith("/")) s = "/" + s; return s; }
  _absoluteUrl(base, v) { let s = this._text(v).trim().replace(/\\\//g, "/").replace(/&amp;/g, "&"); if (!s) return ""; if (s.startsWith("//")) return "https:" + s; if (/^https?:\/\//i.test(s)) return s; if (s.startsWith("/")) return this._origin(base) + s; return base.replace(/[?#].*$/, "").replace(/[^/]*$/, "") + s; }
  _hlsOriginalUrl(v) { const url = this._text(v).trim().replace(/#.*$/, ""); if (!url) return ""; return /\.(?:m3u8|m3u)$/i.test(url) ? url : url + "#download.m3u8"; }
  _normalize(v) { let s = this._text(v); try { s = s.normalize("NFKC"); } catch (_) {} return s.trim().replace(/\s+/g, " "); }
  _searchKey(v) { return this._normalize(v).toLowerCase().replace(/\s+/g, "").replace(/[.,/#!$%^&*;:{}=\-_`~()'"\[\]<>?·…+|\\]/g, ""); }

  _preference(key, fallback) { try { const v = new SharedPreferences().get(key); return v === null || v === undefined ? fallback : v; } catch (_) { return fallback; } }
  _preferenceString(key, fallback) { try { const v = new SharedPreferences().getString(key, fallback); return v === null || v === undefined ? fallback : this._text(v); } catch (_) { return fallback; } }
  _setPreferenceString(key, value) { try { new SharedPreferences().setString(key, this._text(value)); } catch (_) {} }
  _titleCacheToken(value) { const text = this._text(value); let hash = 2166136261; for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(36); }
  _titleLanguage() { const value = this._text(this._preference(this.titleLanguagePreference, this._preferenceString(this.titleLanguagePreference, "ko"))).trim().toLowerCase(); return value === "ja" || value === "1" || value.indexOf("일본") >= 0 ? "ja" : "ko"; }
  async _freshDetailTitleLanguage() { if (typeof setTimeout === "function") await this._pause(250); return this._titleLanguage(); }
  _titleBridgeKey(value) { let text = this._text(value); try { text = text.normalize("NFKC"); } catch (_) {} return text.toLowerCase().replace(/[^a-z0-9가-힣ぁ-んァ-ヶ一-龯]+/g, ""); }
  _anissiaSearchNames(value) { const original = this._text(value).trim(), cleaned = original.replace(/\s*[\(\[]?\d{4}[\)\]]?\s*$/g, "").replace(/\s*[\(\[](더빙|자막|무삭제)[\)\]]\s*$/g, "").replace(/^\s*\((고화질|저화질)\)\s*/g, "").replace(/\s+BD\s*$/i, "").trim(), plain = cleaned.replace(/[~～!！「」『』…:：·・,]+/g, " ").replace(/\s+/g, " ").trim(), season = plain.replace(/시즌\s*(\d+)/g, "$1기"), numbered = season.replace(/\s+(\d+)$/g, " $1기"), korean = (season.match(/^[가-힣0-9][가-힣0-9\s:：\-·・~～!?！？'’.,]*/) || [""])[0].replace(/[\s:：\-·・~～!?！？'’.,]+$/g, "").trim(); return [original, cleaned, plain, season, numbered, korean].filter(function(item, index, list) { return item && list.indexOf(item) === index; }); }
  async _anissiaMetadata(original) { const names = this._anissiaSearchNames(original); for (const query of names) { try { const response = await new Client({ persistentConnection: false, noProxy: true, timeout: 7, connectTimeout: 4 }).get("https://api.anissia.net/anime/list/0?q=" + encodeURIComponent(query), { Accept: "application/json", Referer: "https://anissia.net/anime" }); if (!response || response.statusCode < 200 || response.statusCode >= 300) continue; const payload = JSON.parse(this._text(response.body)), items = payload && payload.data && Array.isArray(payload.data.content) ? payload.data.content : [], wanted = this._titleBridgeKey(query), match = items.find((item) => this._titleBridgeKey(item && item.subject) === wanted); if (match && this._text(match.originalSubject).trim()) return { ko: original, ja: this._text(match.originalSubject).trim(), anissiaId: Number(match.animeNo) || 0, confidence: 500 }; } catch (_) {} } return null; }
  async _titleBridgeOrigin() { const cached = this._trimSlash(this._preferenceString("dc_title_bridge_anilife_origin", "")), cachedAt = Number(this._preferenceString("dc_title_bridge_anilife_origin_time", "0")); if (/^https:\/\/(?:www\.)?anilife\d+\.tv$/i.test(cached) && cachedAt > 0 && Date.now() - cachedAt < 10 * 60 * 1000) return cached; try { const response = await new Client({ persistentConnection: false, noProxy: true, timeout: 8, connectTimeout: 5 }).get(this.signalUrl, { Accept: "application/json", "Cache-Control": "no-cache" }); const data = JSON.parse(this._text(response.body)), candidate = this._trimSlash(data && data.domains && data.domains.anilife && data.domains.anilife.baseUrl); if (/^https:\/\/(?:www\.)?anilife\d+\.tv$/i.test(candidate)) { this._setPreferenceString("dc_title_bridge_anilife_origin", candidate); this._setPreferenceString("dc_title_bridge_anilife_origin_time", String(Date.now())); return candidate; } } catch (_) {} return /^https:\/\/(?:www\.)?anilife\d+\.tv$/i.test(cached) ? cached : "https://anilife01.tv"; }
  _plainEnglishTitle(value) { const text = this._text(value).trim(); return /[a-z]/i.test(text) && !/[가-힣ぁ-んァ-ヶ一-龯]/.test(text) ? text : ""; }
  _decodeTitleText(value) { return this._text(value).replace(/&#(\d+);/g, function(_, code) { return String.fromCharCode(Number(code)); }).replace(/&#x([0-9a-f]+);/gi, function(_, code) { return String.fromCharCode(parseInt(code, 16)); }).replace(/&amp;/gi, "&").replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'").replace(/&nbsp;/gi, " ").trim(); }
  _anilistIdFromText(value) { const match = this._text(value).match(/(?:\/|%2f)anime(?:\/|%2f)(\d{4,})/i); return match ? Number(match[1]) : 0; }
  _titleBridgeMetadataFromItem(original, item) { if (!item) return null; const japanese = this._text(item.titleJp).trim(), english = this._plainEnglishTitle(item.titleOriginal); if (!japanese && !english) return null; return { ko: original, ja: japanese, en: english, romaji: english, sourceId: Number(item.id) || 0, confidence: 200 }; }
  _metadataFromAniListMedia(original, media) { if (!media || !media.id) return null; const title = media.title || {}; return { ko: original, ja: this._text(title.native).trim(), en: this._text(title.english || title.romaji).trim(), romaji: this._text(title.romaji).trim(), anilistId: Number(media.id), confidence: 300 }; }
  async _aniListMetadata(original, candidate, anilistId) { try { const byId = Number(anilistId) > 0, query = byId ? "query($id:Int!){Media(id:$id,type:ANIME){id synonyms title{romaji english native}}}" : "query($search:String!){Page(page:1,perPage:12){media(search:$search,type:ANIME){id synonyms title{romaji english native}}}}", variables = byId ? { id: Number(anilistId) } : { search: this._text(candidate).trim() }; if (!byId && !variables.search) return null; const response = await new Client({ persistentConnection: false, noProxy: true, timeout: 12, connectTimeout: 6 }).post("https://graphql.anilist.co", { "Content-Type": "application/json", Accept: "application/json" }, JSON.stringify({ query, variables })); if (!response || response.statusCode < 200 || response.statusCode >= 300) return null; const payload = JSON.parse(this._text(response.body)); if (byId) return this._metadataFromAniListMedia(original, payload && payload.data && payload.data.Media); const media = payload && payload.data && payload.data.Page && Array.isArray(payload.data.Page.media) ? payload.data.Page.media : [], wanted = this._titleBridgeKey(variables.search), match = media.find((item) => [item && item.title && item.title.native, item && item.title && item.title.romaji, item && item.title && item.title.english].concat(Array.isArray(item && item.synonyms) ? item.synonyms : []).some((value) => this._titleBridgeKey(value) === wanted)); return this._metadataFromAniListMedia(original, match); } catch (_) { return null; } }
  _linkkfOriginCandidates(body) { const raw = this._text(body), match = raw.match(/원제[\s\S]{0,100}?<\/span>\s*([^<]+)/i); if (!match) return []; return this._decodeTitleText(match[1]).split(/\s*,\s*/).map((value) => value.trim()).filter(Boolean); }
  async _linkkfMetadata(original, url) { if (!/^https:\/\/(?:www\.)?linkkf\.(?:tv|com)\/ani\/\d+\/?/i.test(this._text(url).trim())) return null; try { const response = await new Client({ persistentConnection: false, noProxy: true, timeout: 10, connectTimeout: 6 }).get(this._text(url).trim(), { Accept: "text/html,application/xhtml+xml", Referer: "https://linkkf.tv/" }); if (!response || response.statusCode < 200 || response.statusCode >= 300) return null; const body = this._text(response.body), id = this._anilistIdFromText(body); if (id) { const direct = await this._aniListMetadata(original, "", id); if (direct) return direct; } const candidates = this._linkkfOriginCandidates(body), ordered = candidates.filter((value) => /[ぁ-んァ-ヶ一-龯]/.test(value)).concat(candidates.filter((value) => this._plainEnglishTitle(value))); for (const candidate of ordered) { const data = await this._aniListMetadata(original, candidate, 0); if (data) return data; } } catch (_) {} return null; }
  async _titleBridgeMetadata(name) { const anissia = await this._anissiaMetadata(name); if (anissia) return anissia; try { const base = await this._titleBridgeOrigin(); for (const query of this._anissiaSearchNames(name)) { const response = await new Client({ persistentConnection: false, noProxy: true, timeout: 10, connectTimeout: 6 }).get(base + "/api/anime?page=1&limit=10&q=" + encodeURIComponent(query), { Accept: "application/json, text/plain, */*", Referer: base + "/" }); if (!response || response.statusCode < 200 || response.statusCode >= 300) continue; const payload = JSON.parse(this._text(response.body)), items = Array.isArray(payload && payload.items) ? payload.items : [], wanted = this._titleBridgeKey(query), match = items.find((item) => this._titleBridgeKey(item && item.title) === wanted || this._titleBridgeKey(item && item.titleOriginal) === wanted); if (!match) continue; const direct = await this._fillBridgeMetadata(this._titleBridgeMetadataFromItem(name, match)); if (direct && direct.ja) return direct; const linked = await this._linkkfMetadata(name, match.sourceUrl); if (linked) return linked; if (direct) return direct; } return null; } catch (_) { return null; } }
  async _fillBridgeMetadata(data) { if (!data) return data; if (data.ja) return data; const filled = await this._aniListMetadata(data.ko || "", data.ja || data.romaji || data.en, data.anilistId); return filled || data; }
  _rememberAnimePath(path) { const clean = this._relativePath(path).split(/[?#]/)[0]; if (clean) this._setPreferenceString(this.animePathCachePrefix + this._titleCacheToken(clean), "1"); }
  _isRememberedAnimePath(path) { const clean = this._relativePath(path).split(/[?#]/)[0]; return clean ? this._preferenceString(this.animePathCachePrefix + this._titleCacheToken(clean), "") === "1" : false; }
  async _titleMetadata(name) {
    const original = this._text(name).trim(); if (!original) return null; const key = this.titleCachePrefix + this._titleCacheToken(original), timeKey = key + "_time"; const cached = this._preferenceString(key, ""), cachedAt = Number(this._preferenceString(timeKey, "0"));
    if (cached && cachedAt > 0) { try { const parsed = JSON.parse(cached), ttl = parsed && parsed.miss ? 6 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000; if (Date.now() - cachedAt < ttl) return parsed && parsed.miss ? null : parsed; } catch (_) {} }
    try { const data = await this._fillBridgeMetadata(await this._titleBridgeMetadata(original)); if (!data || !data.ja) { this._setPreferenceString(key, JSON.stringify({ miss: true })); this._setPreferenceString(timeKey, String(Date.now())); return null; } this._setPreferenceString(key, JSON.stringify(data)); this._setPreferenceString(timeKey, String(Date.now())); return data; } catch (_) { return null; }
  }
  async _localizedTitle(name, languageOverride) { const original = this._text(name).trim(), language = languageOverride || this._titleLanguage(); if (!original || language === "ko") return original; const data = await this._titleMetadata(original), localized = data ? this._text(data[language]).trim() : ""; return localized || original; }
  async _localizeResult(result) {
    if (!result || !Array.isArray(result.list)) return result;
    const items = result.list, language = this._titleLanguage(), workers = []; let cursor = 0;
    const work = async () => { while (true) { const index = cursor++; if (index >= items.length) return; const item = items[index]; if (!item) continue; const anime = item.__dcAnime === true; delete item.__dcAnime; if (anime && language !== "ko") item.name = await this._localizedTitle(item.name); } };
    for (let index = 0; index < Math.min(4, items.length); index++) workers.push(work());
    await Promise.all(workers); return result;
  }
  _isAllowedBaseUrl(v) { return /^https:\/\/(?:www\.)?tvroom\d+\.org\/?$/i.test(this._text(v).trim()); }
  async _resolveBaseUrl() {
    const manual = this._text(this._preference("tvroom_domain_url", "")).trim();
    if (this._isAllowedBaseUrl(manual)) return this._trimSlash(manual);
    try {
      const r = await new Client({ persistentConnection: false, noProxy: true, timeout: 8, connectTimeout: 5 }).get(this.signalUrl, { "User-Agent": this.userAgent, "Accept": "application/json", "Cache-Control": "no-cache" });
      if (r.statusCode >= 200 && r.statusCode < 300) {
        const data = JSON.parse(r.body);
        const candidate = data && data.domains && data.domains.tvroom ? data.domains.tvroom.baseUrl : "";
        if (this._isAllowedBaseUrl(candidate)) return this._trimSlash(candidate);
      }
    } catch (_) {}
    return this.fallbackBaseUrl;
  }

  _headers(url, referer) {
    const origin = this._origin(url) || this.fallbackBaseUrl;
    return { "User-Agent": this.userAgent, "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8", "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8", "Referer": referer || origin + "/" };
  }
  async _pause(ms) { if (typeof setTimeout === "function") await new Promise(function(resolve) { setTimeout(resolve, ms); }); }
  _failureCode(r, e) { if (r && r.statusCode) return "HTTP" + r.statusCode; const s = this._text(e && (e.message || e)); if (/timeout/i.test(s)) return "TIMEOUT"; if (/certificate|handshake|TLS|SSL/i.test(s)) return "TLS"; return "NETWORK"; }
  _responseHeader(response, name) {
    const headers = response && response.headers ? response.headers : {}, wanted = this._text(name).toLowerCase();
    for (const key of Object.keys(headers)) if (this._text(key).toLowerCase() === wanted) return this._text(headers[key]);
    return "";
  }
  _repairRedirectLocation(value) {
    const text = this._text(value); if (!/[\u0080-\u00ff]/.test(text)) return text;
    try {
      let encoded = "";
      for (let i = 0; i < text.length; i++) { const code = text.charCodeAt(i); if (code > 255) return text; encoded += "%" + code.toString(16).padStart(2, "0"); }
      return decodeURIComponent(encoded);
    } catch (_) { return text; }
  }
  _redirectLocation(response) {
    const header = this._responseHeader(response, "location");
    if (header) return this._repairRedirectLocation(header);
    const body = this._text(response && response.body);
    const anchor = body.match(/<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>\s*https?:\/\//i);
    if (anchor) return anchor[1].replace(/&amp;/g, "&");
    const title = body.match(/<title>\s*Redirecting\s+to\s+(https?:\/\/[^<]+)<\/title>/i);
    if (title) return title[1].trim().replace(/&amp;/g, "&");
    const refresh = body.match(/http-equiv=["']refresh["'][^>]+content=["'][^>]*?url=['"]?(https?:\/\/[^'" >]+)/i);
    return refresh ? refresh[1].replace(/&amp;/g, "&") : "";
  }
  async _requestText(url, referer, stage, extraHeaders) {
    const transports = [{ name: "RHTTP", options: { persistentConnection: false, noProxy: true, timeout: 30, connectTimeout: 10, followRedirects: false, maxRedirects: 0 } }, { name: "DART", options: { useDartHttpClient: true, persistentConnection: false, followRedirects: false, maxRedirects: 0 } }];
    const diagnostics = [];
    for (const t of transports) {
      try {
        let currentUrl = url, currentReferer = referer;
        for (let redirect = 0; redirect <= 5; redirect++) {
          const headers = this._headers(currentUrl, currentReferer); Object.assign(headers, extraHeaders || {});
          const r = await new Client(t.options).get(currentUrl, headers);
          if (r.statusCode >= 200 && r.statusCode < 300) return this._text(r.body);
          const location = r.statusCode >= 300 && r.statusCode < 400 ? this._redirectLocation(r) : "";
          if (location && redirect < 5) { currentReferer = currentUrl; currentUrl = this._absoluteUrl(currentUrl, location); continue; }
          diagnostics.push(t.name + "=" + this._failureCode(r)); break;
        }
      } catch (e) { diagnostics.push(t.name + "=" + this._failureCode(null, e)); if (t.name === "RHTTP") await this._pause(120); }
    }
    throw new Error("티비룸 " + (stage || "요청") + " 연결에 실패했습니다. 진단: " + diagnostics.join(","));
  }

  _koreaWeekday() { return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCDay()]; }
  _weekdayName(slug) { return ({ monday: "월요일", tuesday: "화요일", wednesday: "수요일", thursday: "목요일", friday: "금요일", saturday: "토요일", sunday: "일요일" })[slug] || "오늘"; }
  _driveDirect(url, image) { const s = this._text(url).trim(); const m = s.match(/drive\.google\.com\/file\/d\/([^/]+)/i); return m ? "https://drive.google.com/uc?export=" + (image ? "view" : "download") + "&id=" + m[1] : s; }
  async _customCardUrl(slug) {
    const source = this._text(this._preference("tvroom_custom_card_json_url", "")).trim();
    if (!source) return "";
    const preferences = new SharedPreferences(), cacheKey = "tvroom_custom_card_cache", sourceKey = cacheKey + "_source", timeKey = cacheKey + "_time";
    let data = null, cached = "";
    if (this._preferenceString(sourceKey, "") === source) cached = this._preferenceString(cacheKey, "");
    const cachedAt = Number(this._preferenceString(timeKey, "0"));
    if (cached && cachedAt > 0 && Date.now() - cachedAt < 5 * 60 * 1000) { try { data = JSON.parse(cached); } catch (_) {} }
    if (!data) { try { const direct = this._driveDirect(source, false), join = direct.indexOf("?") >= 0 ? "&" : "?"; data = JSON.parse(await this._requestText(direct + join + "card_json=" + Date.now(), source, "커스텀 목록 카드", { "Accept": "application/json", "Cache-Control": "no-cache" })); preferences.setString(cacheKey, JSON.stringify(data)); preferences.setString(sourceKey, source); preferences.setString(timeKey, String(Date.now())); } catch (_) { if (cached) { try { data = JSON.parse(cached); } catch (_) {} } } }
    if (!data || typeof data !== "object") return "";
    const cards = data.cards && typeof data.cards === "object" ? data.cards : {};
    let image = this._text(cards[slug] || data.default || data.card).trim();
    if (!image) return "";
    image = this._driveDirect(image, true);
    if (data.revision !== undefined && this._text(data.revision).trim()) image += (image.indexOf("?") >= 0 ? "&" : "?") + "revision=" + encodeURIComponent(this._text(data.revision));
    return image;
  }
  async _tabCard(slug, tab) {
    const day = slug || this._koreaWeekday();
    const customSource = this._text(this._preference("tvroom_custom_card_json_url", "")).trim();
    const customImage = await this._customCardUrl(day);
    const event = customSource ? null : await dcOfficialEventCard();
    const official = customImage || event ? null : await dcOfficialListCardSystem("tvroom", tab, "오늘의 미디어");
    return { name: customImage ? this._weekdayName(day) : event ? event.name : official.name, link: "/__tvroom_weekday_card__/" + day, imageUrl: customImage || (event && event.imageUrl) || official.imageUrl };
  }
  _category(key) { return this.categories.find(function(c) { return c.key === key; }) || null; }
  _categoryCard(category) { return { name: category.name, link: "/__tvroom_category_card__/" + category.key, imageUrl: this.assetBaseUrl + "/card/tvroom-category/" + category.image }; }

  _defaultPopularRule() { return { mode: "homePopular", content: "all", country: "전체", order: "시간순" }; }
  _defaultLatestRule() { return { mode: "homeLatest", content: "all", country: "전체", order: "시간순" }; }
  _allowed(value, pairs, fallback) { const s = this._text(value); return pairs.some(function(p) { return p[1] === s; }) ? s : fallback; }
  _normalizeRule(rule, fallback) {
    const f = fallback || this._defaultLatestRule(), r = rule || f;
    const mode = ["homePopular", "homeLatest", "filter"].indexOf(r.mode) >= 0 ? r.mode : f.mode;
    return { mode, content: this._allowed(r.content, this.contentOptions, "all"), country: this._allowed(r.country, this.countryOptions, "전체"), order: this._allowed(r.order, this.orderOptions, "시간순") };
  }
  _encodeRule(rule) { const r = this._normalizeRule(rule, this._defaultLatestRule()); return ["1", r.mode, r.content, r.country, r.order].join("|"); }
  _decodeRule(value, fallback) { const p = this._text(value).split("|"); return p.length === 5 && p[0] === "1" ? this._normalizeRule({ mode: p[1], content: p[2], country: p[3], order: p[4] }, fallback) : this._normalizeRule(fallback, this._defaultLatestRule()); }
  _tabRule(key, fallback) { const value = this._preferenceString(key, ""); return value ? this._decodeRule(value, fallback) : this._normalizeRule(fallback, this._defaultLatestRule()); }
  _nameFor(pairs, value, fallback) { const found = pairs.find(function(p) { return p[1] === value; }); return found ? found[0] : fallback; }
  _ruleSummary(rule) { const r = this._normalizeRule(rule, this._defaultLatestRule()); if (r.mode === "homePopular") return "메인 추천"; if (r.mode === "homeLatest") return "카테고리별 최신 12개"; return this._nameFor(this.contentOptions, r.content, "전체") + " + " + r.country + " + " + r.order; }

  _imageUrl(base, node) {
    if (!node) return "";
    const candidates = [node, node.selectFirst ? node.selectFirst("img") : null].filter(Boolean);
    for (const item of candidates) for (const key of ["data-src", "data-original", "src"]) { const value = this._text(item.attr(key)).trim(); if (value && !/^data:/i.test(value)) return this._absoluteUrl(base, value); }
    const style = this._text(node.attr && node.attr("style")); const m = style.match(/url\(["']?([^"')]+)["']?\)/i); return m ? this._absoluteUrl(base, m[1]) : "";
  }
  _validDetailPath(path) { const clean = this._relativePath(path).split(/[?#]/)[0]; return /^\/video\/[^/]+$/.test(clean); }
  _validContentPath(path) { const clean = this._relativePath(path).split(/[?#]/)[0]; return /^\/video\/[^/]+(?:\/[^/]+)?$/.test(clean); }
  _parseList(scope, base, limit, isAnime) {
    const list = [], seen = {};
    for (const item of scope.select(".module-item .v-item, .v-item")) {
      const link = item.selectFirst("a.v-item-hitarea[href]") || item.selectFirst("a[href]");
      const path = link ? this._relativePath(link.attr("href")) : "";
      if (!this._validDetailPath(path) || seen[path]) continue;
      const titleNode = item.selectFirst(".v-item-title");
      const name = this._normalize((link && link.attr("aria-label")) || (titleNode && titleNode.text) || (link && link.text));
      if (!name) continue;
      const parsed = { name, link: path, imageUrl: this._imageUrl(base, item) };
      if (isAnime === true) { parsed.__dcAnime = true; this._rememberAnimePath(path); }
      list.push(parsed); seen[path] = true;
      if (limit && list.length >= limit) break;
    }
    return list;
  }
  _hasNext(document) { return !!(document.selectFirst("a[rel='next'][href]") || document.selectFirst(".pagination a.next[href], .page-numbers.next[href]")); }
  async _homepage() { const base = await this._resolveBaseUrl(); return { base, document: new Document(await this._requestText(base + "/", base + "/", "메인 화면")) }; }
  async _homePopular() {
    const page = await this._homepage(), list = [], seen = {};
    for (const item of page.document.select(".pic-list .item, .carousel-box .item")) {
      const link = item.selectFirst("a.pic[href]") || item.selectFirst("a[href]"); const path = link ? this._relativePath(link.attr("href")) : "";
      if (!this._validDetailPath(path) || seen[path]) continue;
      const name = this._normalize((link && link.attr("title")) || (link && link.attr("aria-label")) || (item.selectFirst(".sname") && item.selectFirst(".sname").text));
      if (!name) continue;
      list.push({ name, link: path, imageUrl: this._imageUrl(page.base, link) || this._imageUrl(page.base, item) }); seen[path] = true;
    }
    return { list, hasNextPage: false };
  }
  _sectionFor(document, category) {
    const wanted = this._searchKey(category.section);
    for (const section of document.select(".section-box")) { const h = section.selectFirst(".section-header-title"); if (h && this._searchKey(h.text) === wanted) return section; }
    return null;
  }
  async _homeLatest() {
    const page = await this._homepage(), list = [];
    for (const category of this.categories) { const section = this._sectionFor(page.document, category); const items = section ? this._parseList(section, page.base, 12, category.key === "anime") : []; list.push(this._categoryCard(category)); Array.prototype.push.apply(list, items); }
    return { list, hasNextPage: false };
  }
  _listingUrl(base, category, country, order, page) { return base + "/video/" + encodeURIComponent(category.path) + "/" + encodeURIComponent(country) + "/" + encodeURIComponent(order) + "?page=" + Math.max(1, Number(page) || 1); }
  async _categoryListing(base, category, country, order, page) {
    const url = this._listingUrl(base, category, country, order, page), doc = new Document(await this._requestText(url, base + "/", category.name + " 목록"));
    return { list: this._parseList(doc, base, 0, category.key === "anime"), hasNextPage: this._hasNext(doc) };
  }
  async _filterListing(page, rule) {
    const r = this._normalizeRule(rule, { mode: "filter", content: "all", country: "전체", order: "시간순" }), base = await this._resolveBaseUrl();
    if (r.content !== "all") {
      const category = this._category(r.content), result = await this._categoryListing(base, category, r.country, r.order, page);
      if (Number(page) === 1 && result.list.length) result.list.unshift(this._categoryCard(category));
      return result;
    }
    const list = []; let hasNextPage = false;
    for (const category of this.categories) { const result = await this._categoryListing(base, category, r.country, r.order, page); if (result.list.length) { list.push(this._categoryCard(category)); Array.prototype.push.apply(list, result.list); } hasNextPage = hasNextPage || result.hasNextPage; }
    return { list, hasNextPage };
  }
  async _list(page, rule) { const r = this._normalizeRule(rule, this._defaultLatestRule()); if (r.mode === "homePopular") return Number(page) === 1 ? this._homePopular() : { list: [], hasNextPage: false }; if (r.mode === "homeLatest") return Number(page) === 1 ? this._homeLatest() : { list: [], hasNextPage: false }; return this._filterListing(page, r); }
  async _prependCard(result, page, tab) { if (Number(page) !== 1) return result; return { list: [await this._tabCard(undefined, tab)].concat(result.list || []), hasNextPage: result.hasNextPage === true }; }
  async getPopular(page) { return this._localizeResult(await this._prependCard(await this._list(page, this._tabRule(this.popularRulePreference, this._defaultPopularRule())), page, "popular")); }
  async getLatestUpdates(page) { return this._localizeResult(await this._prependCard(await this._list(page, this._tabRule(this.latestRulePreference, this._defaultLatestRule())), page, "latest")); }

  _searchCategory(label) {
    const key = this._searchKey(label);
    if (key.indexOf("시사") >= 0 || key.indexOf("다큐") >= 0) return this._category("current");
    if (key.indexOf("음악") >= 0) return this._category("music");
    return this.categories.find((c) => key.indexOf(this._searchKey(c.search)) >= 0 || key.indexOf(this._searchKey(c.name)) >= 0) || null;
  }
  _parseSearch(document, base) {
    const grouped = {}; for (const category of this.categories) grouped[category.key] = [];
    const seen = {};
    for (const item of document.select(".search-result-list .search-result-item, .search-result-item")) {
      const category = this._searchCategory((item.selectFirst(".search-result-item-header > div") || item.selectFirst(".search-result-item-header") || { text: "" }).text);
      const link = item.selectFirst("a.search-result-item-hitarea[href]") || item.selectFirst("a[href]"); const path = link ? this._relativePath(link.attr("href")) : "";
      if (!category || !this._validDetailPath(path) || seen[path]) continue;
      const title = item.selectFirst(".search-result-item-main .title"); const name = this._normalize((link && link.attr("aria-label")) || (title && title.text) || (link && link.text));
      if (!name) continue;
      const parsed = { name, link: path, imageUrl: this._imageUrl(base, item.selectFirst(".search-result-item-pic")) || this._imageUrl(base, item) };
      if (category.key === "anime") { parsed.__dcAnime = true; this._rememberAnimePath(path); }
      grouped[category.key].push(parsed); seen[path] = true;
    }
    const list = [];
    for (const category of this.categories) if (grouped[category.key].length) { list.push(this._categoryCard(category)); Array.prototype.push.apply(list, grouped[category.key]); }
    return { list, hasNextPage: this._hasNext(document) };
  }
  async _textSearch(query, page) {
    const base = await this._resolveBaseUrl(), compact = this._searchKey(query), normalized = this._normalize(query), words = [compact, normalized].filter(function(v, i, a) { return v && a.indexOf(v) === i; });
    for (let i = 0; i < words.length; i++) {
      const url = base + "/search/" + encodeURIComponent(words[i]) + "?page=" + Math.max(1, Number(page) || 1);
      const result = this._parseSearch(new Document(await this._requestText(url, base + "/", "통합 검색")), base);
      if (result.list.length || i === words.length - 1) return result;
    }
    return { list: [], hasNextPage: false };
  }

  _filterValue(filters, type, fallback) { if (!Array.isArray(filters)) return fallback; for (const f of filters) { if (!f || f.type !== type || !Array.isArray(f.values)) continue; const option = f.values[Number(f.state) || 0]; return option && option.value !== undefined ? this._text(option.value) : fallback; } return fallback; }
  _filterRule(filters) {
    const unset = "__unset__", content = this._filterValue(filters, "contentType", unset), country = this._filterValue(filters, "country", unset), order = this._filterValue(filters, "order", unset);
    if (content === unset) return null;
    return this._normalizeRule({ mode: "filter", content, country: country === unset ? "전체" : country, order: order === unset ? "시간순" : order }, { mode: "filter", content: "all", country: "전체", order: "시간순" });
  }
  _applyTabRuleAction(page, filters, rule) {
    if (Number(page) !== 1) return;
    const action = Number(this._filterValue(filters, "tabRuleAction", "0")), preferences = new SharedPreferences();
    if (action === 1) preferences.setString(this.popularRulePreference, this._encodeRule(rule));
    else if (action === 2) preferences.setString(this.latestRulePreference, this._encodeRule(rule));
    else if (action === 3) preferences.setString(this.popularRulePreference, "");
    else if (action === 4) preferences.setString(this.latestRulePreference, "");
    else if (action === 5) { preferences.setString(this.popularRulePreference, ""); preferences.setString(this.latestRulePreference, ""); }
  }
  async search(query, page, filters) {
    const q = this._normalize(query);
    if (q) return this._localizeResult(await this._textSearch(q, page));
    const action = Number(this._filterValue(filters, "tabRuleAction", "0")); let rule = this._filterRule(filters);
    if (!rule && action >= 3 && action <= 5) rule = { mode: "filter", content: "all", country: "전체", order: "시간순" };
    if (!rule) throw new Error("필터 탭에서 콘텐츠 종류를 먼저 선택하세요.");
    const result = await this._filterListing(page, rule); this._applyTabRuleAction(page, filters, rule); return this._localizeResult(result);
  }

  _parseDate(text) { const m = this._text(text).match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/); return m ? String(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()) : ""; }
  _detailInfo(document) { const info = {}; for (const row of document.select(".detail-info-row")) { const side = row.selectFirst(".detail-info-row-side"), main = row.selectFirst(".detail-info-row-main"); if (side && main) info[this._normalize(side.text).replace(/:$/, "")] = this._normalize(main.text); } return info; }
  _parseEpisodes(document) {
    const episodes = [], seen = {};
    for (const item of document.select(".episode-list a.episode-item[href]")) {
      const path = this._relativePath(item.attr("href")); if (!path || seen[path]) continue;
      const label = item.selectFirst("span"); const name = this._normalize((label && label.text) || item.text); if (!name) continue;
      episodes.push({ name, url: path, dateUpload: "" }); seen[path] = true;
    }
    return episodes;
  }
  async getDetail(url) {
    const weekday = this._text(url).match(/\/__tvroom_weekday_card__\/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (weekday) { const item = await this._tabCard(weekday[1]); return { name: item.name, link: item.link, imageUrl: item.imageUrl, author: "티비룸", description: "오늘의 시간 흐름을 담은 움직이는 요일 카드입니다. 뒤로 돌아가 작품을 선택해 주세요.", genre: ["요일 안내"], status: 0, episodes: [], chapters: [] }; }
    const divider = this._text(url).match(/\/__tvroom_category_card__\/([a-z]+)/);
    if (divider) { const category = this._category(divider[1]); if (!category) throw new Error("잘못된 구분 카드입니다."); const item = this._categoryCard(category); return { name: item.name, link: item.link, imageUrl: item.imageUrl, author: "티비룸", description: category.name + " 목록을 구분하는 안내 카드입니다. 뒤로 돌아가 작품을 선택해 주세요.", genre: ["구분 카드"], status: 0, episodes: [], chapters: [] }; }
    const base = await this._resolveBaseUrl(), path = this._relativePath(url).split("#")[0]; if (!this._validContentPath(path)) throw new Error("잘못된 티비룸 작품 주소입니다.");
    const document = new Document(await this._requestText(base + path, base + "/", "상세"));
    const title = document.selectFirst(".play-box-side-header .detail-title strong") || document.selectFirst(".detail-box-header h1") || document.selectFirst("meta[property='og:title']");
    if (!title) throw new Error("작품 제목을 찾지 못했습니다.");
    const info = this._detailInfo(document), image = document.selectFirst(".detail-pic img") || document.selectFirst("meta[property='og:image']"), desc = document.selectFirst(".detail-desc"), episodes = this._parseEpisodes(document);
    const genres = this._text(info["장르"]).split(/[,/]/).map((v) => this._normalize(v)).filter(Boolean);
    const content = title.attr && title.attr("content") ? title.attr("content") : title.text;
    const originalName = this._normalize(content).replace(/\s+-\s+.*$/, "");
    const detailLanguage = await this._freshDetailTitleLanguage();
    const detailName = this._isRememberedAnimePath(path) ? await this._localizedTitle(originalName, detailLanguage) : originalName;
    return { name: detailName, link: path, imageUrl: image && image.attr("content") ? this._absoluteUrl(base, image.attr("content")) : this._imageUrl(base, image), author: info["감독"] || "", artist: info["출연"] || "", description: desc ? this._normalize(desc.text) : "", genre: genres, status: 0, episodes, chapters: episodes };
  }

  _base64Decode(input) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", clean = this._text(input).replace(/[^A-Za-z0-9+/=]/g, ""), out = []; let buffer = 0, bits = 0;
    for (let i = 0; i < clean.length; i++) { if (clean[i] === "=") break; const value = chars.indexOf(clean[i]); if (value < 0) continue; buffer = (buffer << 6) | value; bits += 6; if (bits >= 8) { bits -= 8; out.push((buffer >> bits) & 255); } }
    return out;
  }
  _base64Encode(bytes) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; let out = "";
    for (let i = 0; i < bytes.length; i += 3) { const a = bytes[i], hasB = i + 1 < bytes.length, hasC = i + 2 < bytes.length, b = hasB ? bytes[i + 1] : 0, c = hasC ? bytes[i + 2] : 0, n = (a << 16) | (b << 8) | c; out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + (hasB ? chars[(n >> 6) & 63] : "=") + (hasC ? chars[n & 63] : "="); }
    return out;
  }
  _base64UrlEncode(bytes) { return this._base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  _ascii(bytes) { let out = ""; for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]); return out; }
  _asciiBytes(text) { const out = []; for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i) & 255); return out; }
  _decodePlayerKey(envelope) {
    const data = JSON.parse(this._ascii(this._base64Decode(this._text(envelope).trim()))), encrypted = this._base64Decode(data.encrypted_key), rule = data.rule || {}, noise = Number(rule.noise_length), sizes = rule.segment_sizes || [], permutation = rule.permutation || [];
    if (!sizes.length || sizes.length !== permutation.length || !Number.isFinite(noise)) throw new Error("영상 키 조각 형식 오류");
    const shuffled = []; let offset = 0;
    for (let i = 0; i < permutation.length; i++) { const original = Number(permutation[i]), size = Number(sizes[original]) + noise; if (original < 0 || original >= sizes.length || size <= noise || offset + size > encrypted.length) throw new Error("영상 키 조각 형식 오류"); shuffled.push(encrypted.slice(offset, offset + size)); offset += size; }
    const inverse = new Array(permutation.length); for (let i = 0; i < permutation.length; i++) inverse[Number(permutation[i])] = i;
    const output = []; for (let original = 0; original < sizes.length; original++) { const piece = shuffled[inverse[original]], count = Number(sizes[original]); for (let i = 0; i < count; i++) output.push(piece[i]); }
    if (output.length !== Number(rule.key_length || 16)) throw new Error("영상 키 길이 오류"); return output;
  }
  _rewritePlaylist(playlist, playlistUrl, keyBytes) {
    const keyData = "data:application/octet-stream;base64," + this._base64Encode(keyBytes), lines = this._text(playlist).split(/\r?\n/), output = [];
    for (const raw of lines) { const line = raw.trim(); if (/^#EXT-X-KEY:/i.test(line)) output.push(raw.replace(/URI="[^"]+"/i, "URI=\"" + keyData + "\"")); else if (line && line[0] !== "#") output.push(this._absoluteUrl(playlistUrl, line)); else output.push(raw); }
    return output.join("\n") + "\n";
  }
  _playlistBridgeUrl(playlist, playlistUrl, keyBytes, playerUrl, mode) {
      if (!/#EXT-X-KEY:/i.test(this._text(playlist))) return "";
      const query = ["v=3", "m=" + (mode === "proxy" ? "p" : "f"), "u=" + encodeURIComponent(this._base64UrlEncode(this._asciiBytes(playlistUrl))), "r=" + encodeURIComponent(this._base64UrlEncode(this._asciiBytes(playerUrl))), "k=" + encodeURIComponent(this._base64UrlEncode(keyBytes))].join("&"), url = this.assetBaseUrl + "/api/tvroom-playlist.m3u8?" + query;
      if (url.length > 1800) throw new Error("HLS 재생목록 주소가 너무 깁니다.");
      return url;
    }
  async getVideoList(url) {
    const base = await this._resolveBaseUrl(), episodeUrl = base + this._relativePath(url), episodeDocument = new Document(await this._requestText(episodeUrl, base + "/", "회차")), frame = episodeDocument.selectFirst("iframe#view_iframe[src]");
    if (!frame) throw new Error("사이트의 재생 프레임을 찾지 못했습니다.");
    const playerUrl = this._absoluteUrl(episodeUrl, frame.attr("src")); if (!/^https:\/\//i.test(playerUrl)) throw new Error("사이트의 재생 주소가 올바르지 않습니다.");
    const playerOrigin = this._origin(playerUrl), playerHtml = await this._requestText(playerUrl, episodeUrl, "플레이어", { "Origin": base });
    const playerDocument = new Document(playerHtml), player = playerDocument.selectFirst("#player[data-m3u8]"); let streamUrl = player ? this._text(player.attr("data-m3u8")).replace(/&amp;/g, "&") : "";
    if (!streamUrl) { const match = playerHtml.match(/https?:\/\/[^"'\s<>]+\.m3u8(?:\?[^"'\s<>]*)?/i); streamUrl = match ? match[0].replace(/&amp;/g, "&") : ""; }
    if (!streamUrl) throw new Error("사이트가 HLS 주소를 제공하지 않았습니다.");
    const streamHeaders = { "Accept": "*/*", "Referer": playerUrl, "Origin": playerOrigin, "User-Agent": this.userAgent }, playlist = await this._requestText(streamUrl, playerUrl, "재생목록", streamHeaders), keyMatch = playlist.match(/#EXT-X-KEY:[^\r\n]*URI="([^"]+)"/i);
    if (!keyMatch) return [{ url: streamUrl, originalUrl: this._hlsOriginalUrl(streamUrl), quality: "자동 (HLS)", headers: streamHeaders, subtitles: [], audios: [] }];
    const keyUrl = this._absoluteUrl(streamUrl, keyMatch[1]), envelope = await this._requestText(keyUrl, playerUrl, "영상 키", streamHeaders), key = this._decodePlayerKey(envelope), directUrl = this._playlistBridgeUrl(playlist, streamUrl, key, playerUrl, "direct"), proxyUrl = this._playlistBridgeUrl(playlist, streamUrl, key, playerUrl, "proxy");
    return [
      { url: directUrl, originalUrl: this._hlsOriginalUrl(directUrl), quality: "빠른 재생 (캐시)", headers: streamHeaders, subtitles: [], audios: [] },
      { url: proxyUrl, originalUrl: this._hlsOriginalUrl(proxyUrl), quality: "호환 재생 (중계)", headers: streamHeaders, subtitles: [], audios: [] }
    ];
  }

  async getPageList() { return []; }
  async getHtmlContent() { return ""; }
  async cleanHtmlContent(html) { return html; }
  getHeaders(url) { return { "User-Agent": this.userAgent, "Referer": (this._origin(url) || this.fallbackBaseUrl) + "/", "Accept": "*/*" }; }
  _option(name, value) { return { type_name: "SelectOption", name, value }; }
  _select(type, name, values) { return { type, name, type_name: "SelectFilter", values }; }
  getFilterList() {
    const option = this._option.bind(this), choices = function(pairs) { return [option("선택하세요", "__unset__")].concat(pairs.map(function(p) { return option(p[0], p[1]); })); }, separator = function(type) { return { type, name: "", type_name: "SeparatorFilter" }; }, header = function(type, name) { return { type, name, type_name: "HeaderFilter" }; }, popular = this._tabRule(this.popularRulePreference, this._defaultPopularRule()), latest = this._tabRule(this.latestRulePreference, this._defaultLatestRule());
    return [separator("top"), header("usage", "필터 탭에서 콘텐츠 종류를 먼저 선택하세요. 국가와 정렬은 생략하면 전체·시간순으로 처리합니다."), this._select("contentType", "콘텐츠 종류", choices(this.contentOptions)), this._select("country", "국가", choices(this.countryOptions)), this._select("order", "정렬", choices(this.orderOptions)), separator("save"), header("defaultHelp", "기본 인기: 메인 추천 · 기본 최신: 카테고리별 최신 12개"), header("cardHelp", "목록 카드는 Popular/Latest 1번에만 표시되며 필터 결과와 통합 검색에서는 숨깁니다."), header("popularSummary", "현재 Popular: " + this._ruleSummary(popular)), header("latestSummary", "현재 Latest: " + this._ruleSummary(latest)), this._select("tabRuleAction", "Popular/Latest 규칙", [option("저장하지 않음 (필터 결과만 보기)", "0"), option("현재 조건을 Popular 탭에 저장", "1"), option("현재 조건을 Latest 탭에 저장", "2"), option("Popular 탭을 기본값으로 복원", "3"), option("Latest 탭을 기본값으로 복원", "4"), option("두 탭 모두 기본값으로 복원", "5")])];
  }
  getSourcePreferences() {
    return [{ key: "tvroom_anime_title_language_v2", listPreference: { title: "애니 작품 제목 언어", summary: "애니 작품은 한국어와 일본어 중에서 선택합니다. 변경 후 현재 화면을 새로고침하세요. 영화·드라마·예능·시사 등은 한국어 제목을 유지합니다.", valueIndex: 0, entries: ["한국어", "일본어"], entryValues: ["ko", "ja"] } }, { key: "tvroom_domain_url", editTextPreference: { title: "티비룸 주소 직접 지정 (선택)", summary: "빈 값이면 토끼 중앙신호등이 공식 텔레그램에서 가져온 최신 주소를 사용합니다.", value: "", dialogTitle: "https://tvroom32.org", dialogMessage: "자동 주소를 사용하려면 빈 값으로 두세요." } }, { key: "tvroom_custom_card_json_url", editTextPreference: { title: "커스텀 목록 카드 (선택)", summary: "공개 JSON 주소 1개로 요일별 카드 7장을 설정합니다. 360×540 GIF를 권장하며 용량·프레임 제한은 없습니다.", value: "", dialogTitle: "커스텀 목록 카드 JSON 주소", dialogMessage: "Google Drive 공개 공유 링크 또는 직접 JSON 주소를 넣으세요. 개인 카드를 설정하면 공용 이벤트 카드는 표시되지 않습니다. 빈 값이면 공용 이벤트 또는 기본 미디어 요일 카드를 사용합니다." } }];
  }
}

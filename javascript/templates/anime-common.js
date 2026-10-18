// Shared standalone runtime. Keep the two generated anime sources in sync.
class AnimeProvider extends MProvider {
  get supportsLatest() { return true; }
  _text(v) { return v === null || v === undefined ? "" : String(v); }
  _origin(v) { const m = this._text(v).match(/^(https:\/\/[^/?#]+)/i); return m ? m[1] : ""; }
  _absolute(base, value) {
    const s = this._text(value).trim().replace(/&amp;/g, "&");
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith("//")) return "https:" + s;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return "";
    const origin = this._origin(base), clean = base.replace(/[?#].*$/, "");
    if (s[0] === "?") return clean + s;
    const rel = s[0] === "/" ? s : (clean.slice(origin.length) || "/").replace(/[^/]*$/, "") + s;
    const m = rel.match(/^([^?#]*)([\s\S]*)$/), parts = [];
    for (const p of m[1].split("/")) { if (p === "..") { if (parts.length > 1) parts.pop(); } else if (p !== ".") parts.push(p); }
    return origin + parts.join("/") + m[2];
  }
  _https(value) { return /^https:\/\/[a-z0-9.-]+(?::443)?(?:[/?#][^\s]*)?$/i.test(this._text(value)); }
  _saved(key, fallback) { try { return new SharedPreferences().getString(key, fallback); } catch (_) { return fallback; } }
  _save(key, value) { try { new SharedPreferences().setString(key, String(value)); } catch (_) {} }
  _validBase(value) { return this.domainPattern.test(this._text(value)); }
  _baseNumber(value) { return Number((this._text(value).match(/(\d+)\.(?:net|tv)$/) || [])[1] || 0); }
  async _resolveBaseUrl() {
    const manual = this._text(this._saved(this.site + "_domain_url", "")).trim().replace(/\/+$/, "");
    if (this._validBase(manual)) return manual;
    const configured = this._text(this.source && this.source.baseUrl).replace(/\/+$/, "");
    let base = this._validBase(configured) && this._baseNumber(configured) >= this._baseNumber(this.fallbackBaseUrl) ? configured : this.fallbackBaseUrl;
    const key = this.site + "_last_base_v1", saved = this._saved(key, "");
    if (this._validBase(saved) && this._baseNumber(saved) >= this._baseNumber(base)) base = saved;
    if (this._validBase(saved) && base === saved && Date.now() - Number(this._saved(key + "_time", "0")) < 600000) return base;
    try {
      const r = await this._request(this.signalUrl, { Accept: "application/json" });
      const data = JSON.parse(r.body), value = this._text(data && data.domains && data.domains[this.site] && data.domains[this.site].baseUrl).replace(/\/+$/, "");
      if (this._validBase(value) && this._baseNumber(value) >= this._baseNumber(base)) { base = value; this._save(key, base); this._save(key + "_time", Date.now()); }
    } catch (_) {}
    return base;
  }
  _headers(referer) { return { "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36", Accept: "application/json, text/html, */*", "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8", Referer: referer, Origin: this._origin(referer) }; }
  async _request(url, headers, body, guarded) {
    if (!this._https(url)) throw new Error("HTTPS 요청 주소 오류");
    const client = new Client({ persistentConnection: false, noProxy: true, timeout: 25, connectTimeout: 8, followRedirects: !guarded, maxRedirects: guarded ? 0 : 5 });
    const r = body === undefined ? await client.get(url, headers) : await client.post(url, headers, body);
    if (!r || r.statusCode < 200 || r.statusCode >= 300) throw new Error(this.name + " HTTP " + (r && r.statusCode) + ". WebView 접속 또는 소스 주소를 확인하세요.");
    return r;
  }
  _query(values) { return Object.keys(values).filter(k => values[k] !== "" && values[k] !== undefined).map(k => encodeURIComponent(k) + "=" + encodeURIComponent(values[k])).join("&"); }
  _filter(filters, type, fallback) {
    for (const f of Array.isArray(filters) ? filters : []) if (f && f.type === type && Array.isArray(f.values)) {
      const o = f.values[Number(f.state) || 0]; return o && o.value !== undefined ? String(o.value) : fallback;
    }
    return fallback;
  }
  _select(type, name, pairs) { return { type, name, type_name: "SelectFilter", values: pairs.map(p => ({ type_name: "SelectOption", name: p[0], value: p[1] })) }; }
  _page(page) { return Math.max(1, Math.floor(Number(page) || 1)); }
  _unique(list, field) { const seen = {}; return list.filter(item => { const k = item[field]; if (!k || seen[k]) return false; seen[k] = true; return true; }); }
  _playlist(body, url, headers) {
    if (!/^#EXTM3U(?:\r?\n|$)/.test(body.trim())) throw new Error("HLS 재생목록 형식 오류");
    const lines = body.trim().split(/\r?\n/).map(l => l.trim()), videos = [], subtitles = [], audios = [];
    const attrs = line => { const a = {}; for (const m of line.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g)) a[m[1]] = m[2] || m[3]; return a; };
    for (let i = 0; i < lines.length; i++) {
      if (/^#EXT-X-MEDIA:/.test(lines[i])) { const a = attrs(lines[i]), u = this._absolute(url, a.URI); if (this._https(u)) { const track = { file: u, label: a.NAME || a.LANGUAGE || "사이트 자막" }; if (a.TYPE === "SUBTITLES") subtitles.push(track); if (a.TYPE === "AUDIO") audios.push(track); } }
      if (!/^#EXT-X-STREAM-INF:/.test(lines[i])) continue;
      const a = attrs(lines[i]);
      if (a.CODECS && a.CODECS.split(",").every(c => c.trim().startsWith("mp4a"))) continue;
      const next = lines.slice(i + 1).find(l => l && l[0] !== "#"), u = this._absolute(url, next);
      if (this._https(u)) videos.push({ url: u, originalUrl: u, quality: a.RESOLUTION ? a.RESOLUTION.split("x")[1] + "p" : "자동 (HLS)", bandwidth: Number(a.BANDWIDTH) || 0, headers });
    }
    if (!videos.length && !lines.some(l => /^#EXT-X-STREAM-INF:/.test(l))) videos.push({ url, originalUrl: url, quality: "자동 (HLS)", bandwidth: 0, headers });
    if (!videos.length) throw new Error("사용 가능한 영상 트랙이 없습니다.");
    return this._unique(videos, "url").sort((a, b) => b.bandwidth - a.bandwidth).map(v => ({ url: v.url, originalUrl: v.originalUrl, quality: v.quality, headers, subtitles, audios }));
  }
  async getPageList() { return []; }
  async getHtmlContent() { return ""; }
  async cleanHtmlContent(html) { return html; }
  getHeaders(url) { return this._headers(this._origin(url) + "/"); }
  getSourcePreferences() { return [{ key: this.site + "_domain_url", editTextPreference: { title: this.name + " 주소 직접 지정 (선택)", summary: "빈 값이면 공통 주소 목록을 사용합니다.", value: "", dialogTitle: this.fallbackBaseUrl, dialogMessage: "자동 주소를 사용하려면 비워두세요." } }]; }
}

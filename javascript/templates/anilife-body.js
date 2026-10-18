class DefaultExtension extends AnimeProvider {
  constructor() {
    super();
    this.name = "애니라이프"; this.site = "anilife";
    this.fallbackBaseUrl = mangayomiSources[0].baseUrl;
    this.domainPattern = /^https:\/\/(?:www\.)?anilife\d+\.tv$/i;
    this.signalUrl = "https://daeokim.github.io/my-mangayomi/domains.json";
  }
  _id(value) {
    const path = this._text(value).replace(/^https:\/\/(?:www\.)?anilife\d+\.tv/i, "").split(/[?#]/)[0];
    const m = path.match(/^\/?(?:content\/)?([A-Za-z0-9_-]+)(?:\/1)?\/?$/);
    if (!m) throw new Error("애니라이프 작품 주소 오류");
    return m[1];
  }
  _item(item, base) {
    if (!item || !/^[A-Za-z0-9_-]+$/.test(item.id) || !this._text(item.title).trim()) throw new Error("애니라이프 작품 응답 형식 오류");
    return { name: item.title, link: "/content/" + item.id + "/1", imageUrl: this._absolute(base + "/", item.image), author: item.studio || "", description: item.description || "", genre: Array.isArray(item.genres) ? item.genres : [], status: item.status === "완결" ? 1 : 0 };
  }
  async _catalog(page, options) {
    const base = await this._resolveBaseUrl(), url = base + "/api/anime?" + this._query(Object.assign({ page: this._page(page), limit: 24, sort: "latest", v: "catalog-media-2" }, options));
    const data = JSON.parse((await this._request(url, this._headers(base + "/tags"))).body);
    if (!Array.isArray(data.items)) throw new Error("애니라이프 목록 응답 형식 오류");
    const p = data.pagination || {};
    return { list: this._unique(data.items.map(i => this._item(i, base)), "link"), hasNextPage: Number(p.page || 1) < Number(p.pages || 1) };
  }
  async getPopular(page) { return this._catalog(page, { sort: "popular" }); }
  async getLatestUpdates(page) { return this._catalog(page, { scope: "updates" }); }
  async search(query, page, filters) {
    const options = { q: this._text(query).trim() };
    for (const key of ["sort", "genre", "year", "status", "day"]) options[key] = this._filter(filters, key, key === "sort" ? "latest" : "");
    return this._catalog(page, options);
  }
  async getDetail(url) {
    const base = await this._resolveBaseUrl(), id = this._id(url), referer = base + "/content/" + id + "/1";
    const data = JSON.parse((await this._request(base + "/api/anime/" + id + "?v=playback-policy-v2", this._headers(referer))).body);
    const detail = this._item(data.item, base);
    const episodes = this._unique((Array.isArray(data.item.episodes) ? data.item.episodes : []).filter(e => e.playable === true && /^\/api\/playback\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(e.playbackUrl)).map(e => {
      const n = Number(e.number) || 0;
      return { name: n + "화" + (e.title ? " · " + e.title : ""), url: e.playbackUrl, dateUpload: "", number: n };
    }), "url").sort((a, b) => b.number - a.number).map(e => ({ name: e.name, url: e.url, dateUpload: e.dateUpload }));
    return Object.assign(detail, { episodes, chapters: episodes });
  }
  _cookies(headers) {
    const key = Object.keys(headers || {}).find(k => k.toLowerCase() === "set-cookie");
    const raw = key ? headers[key] : "";
    return (Array.isArray(raw) ? raw : String(raw).split(/,(?=\s*[^;,=\s]+=[^;,]*)/)).map(c => String(c).split(";")[0].trim()).filter(Boolean).join("; ");
  }
  async _session(base, referer) {
    if (this.session && this.session.base === base && this.session.expires > Date.now() + 30000) return this.session;
    const headers = Object.assign(this._headers(referer), { "X-Anilife-Player": "1", "Content-Type": "application/x-www-form-urlencoded" });
    const response = await this._request(base + "/api/playback/session", headers, "", true), data = JSON.parse(response.body);
    if (!data.token || /[\r\n]/.test(data.token)) throw new Error("애니라이프 재생 세션을 받지 못했습니다.");
    this.session = { base, token: data.token, cookie: this._cookies(response.headers), expires: Number(data.expiresAt) * 1000 };
    return this.session;
  }
  async getVideoList(url) {
    const path = this._text(url);
    if (!/^\/api\/playback\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(path)) throw new Error("애니라이프 회차 주소 오류");
    const base = await this._resolveBaseUrl(), parts = path.split("/"), referer = base + "/content/" + parts[3] + "/" + parts[4];
    let failure;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const session = await this._session(base, referer);
        const headers = Object.assign(this._headers(referer), { "X-Anilife-Playback": session.token, "X-Anilife-Delivery": "source-v1" });
        if (session.cookie) headers.Cookie = session.cookie;
        const data = JSON.parse((await this._request(base + path + "?request=" + Date.now() + "-" + attempt, headers, undefined, true)).body);
        const subtitle = data.subtitleUrl ? this._absolute(base + "/", data.subtitleUrl) : "";
        const videoHeaders = Object.assign(this._headers(referer), { Accept: "*/*" });
        const videos = [[data.videoUrl, "자동 (HLS)"], [data.backupUrl, "보조 영상"]].filter(p => p[0] && p[0] !== "null").map(p => ({ url: this._absolute(base + "/", p[0]), quality: p[1] })).filter(v => this._https(v.url)).map(v => Object.assign(v, { originalUrl: v.url, headers: videoHeaders, subtitles: this._https(subtitle) ? [{ file: subtitle, label: "사이트 자막" }] : [], audios: [] }));
        if (videos.length) return this._unique(videos, "url");
        throw new Error(data.error || "애니라이프 영상 주소를 받지 못했습니다.");
      } catch (e) { this.session = null; failure = e; }
    }
    throw failure;
  }
  getFilterList() {
    const labeled = values => [["전체", ""]].concat(values.map(v => [v, v]));
    return [this._select("sort", "정렬", [["최신순", "latest"], ["인기순", "popular"], ["평점순", "score"], ["이름순", "name"]]),
      this._select("genre", "장르", labeled(["코미디", "액션", "판타지", "드라마", "로맨스", "일상", "모험", "SF", "초자연", "미스터리", "스포츠", "음악", "메카", "심리", "호러", "마법소녀", "스릴러", "소년", "학원"])),
      this._select("year", "연도", labeled(Array.from({ length: new Date().getUTCFullYear() - 1977 + 1 }, (_, i) => String(new Date().getUTCFullYear() - i)))),
      this._select("status", "상태", labeled(["방영중", "완결", "방영예정"])), this._select("day", "요일", labeled(["월", "화", "수", "목", "금", "토", "일"]))];
  }
}

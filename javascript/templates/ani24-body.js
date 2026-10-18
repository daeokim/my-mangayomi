class DefaultExtension extends AnimeProvider {
  constructor() {
    super(); this.name = "애니24"; this.site = "ani24";
    this.fallbackBaseUrl = mangayomiSources[0].baseUrl;
    this.domainPattern = /^https:\/\/(?:www\.)?ohli\d+\.net$/i;
    this.signalUrl = "https://daeokim.github.io/my-mangayomi/domains.json";
  }
  _path(value) {
    const raw = this._text(value).trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https:\/\/(?:www\.)?ohli\d+\.net\//i.test(raw)) throw new Error("애니24 주소 오류");
    if (raw.startsWith("//")) throw new Error("애니24 주소 오류");
    const path = raw.replace(/^https:\/\/(?:www\.)?ohli\d+\.net/i, "").split("#")[0];
    if (!/^\/\d+\/[^/\s]+$/.test(path.split("?")[0]) || /[\r\n]/.test(path)) throw new Error("애니24 작품·회차 주소 오류");
    return path;
  }
  _image(base, node) { if (!node) return ""; return this._absolute(base + "/", node.attr("data-src") || node.attr("src") || node.attr("content")); }
  _parseList(html, base, api) {
    const doc = new Document(html), list = [];
    for (const node of doc.select(".show-item")) {
      const a = node.selectFirst("a.show-item-img-link[href], a.show-item-tile-link[href], a[href]");
      if (!a) continue;
      let path; try { path = this._path(a.attr("href")); } catch (_) { continue; }
      const title = node.selectFirst(".show-item-title"); let name = title ? this._text(title.text).trim() : "";
      if (!name || /(?:\.\.\.|…)$/.test(name)) { try { name = decodeURIComponent(path.split("/").pop().replace(/\.html$/, "")).replace(/-/g, " "); } catch (_) {} }
      if (!name) continue;
      list.push({ name, link: path, imageUrl: this._image(base, node.selectFirst(".show-item-img img, img")) });
    }
    const pagination = doc.select(".page-numbers");
    const hasNextPage = pagination.length ? doc.select(".page-numbers a").some(a => /^(?:>|다음)$/.test(this._text(a.text).trim())) : api && list.length >= 25;
    return { list: this._unique(list, "link"), hasNextPage };
  }
  _jsonp(body) {
    const text = this._text(body).trim(), json = text[0] === "{" ? text : text.slice(text.indexOf("(") + 1, text.lastIndexOf(")"));
    const data = JSON.parse(json);
    if (typeof data.msg !== "string") throw new Error("애니24 목록 응답 형식 오류");
    return data.msg;
  }
  async _catalog(page, category, sort, day, genre) {
    const base = await this._resolveBaseUrl(), name = ["ong", "list", "movie"].indexOf(category) >= 0 ? category : "ong";
    const url = base + "/index.php?" + this._query({ s: "api", c: "api", m: "template", format: "jsonp", name: name + ".html", catid: name === "movie" ? "2" : name === "list" ? "1" : "3", order: sort || "updatetime", page: this._page(page), keyword: genre || "", weeks: day || "" });
    return this._parseList(this._jsonp((await this._request(url, this._headers(base + "/"))).body), base, true);
  }
  async getPopular(page) { return this._catalog(page, "ong", "hits", "", ""); }
  async getLatestUpdates(page) { return this._catalog(page, "ong", "updatetime", "", ""); }
  async search(query, page, filters) {
    const text = this._text(query).trim();
    if (!text) return this._catalog(page, this._filter(filters, "category", "ong"), this._filter(filters, "sort", "updatetime"), this._filter(filters, "day", ""), this._filter(filters, "genre", ""));
    const base = await this._resolveBaseUrl(), suffix = this._page(page) === 1 ? ".html" : "-parent_id-0-page-" + this._page(page) + ".html";
    const url = base + "/search/keyword-" + encodeURIComponent(text) + suffix;
    return this._parseList((await this._request(url, this._headers(base + "/"))).body, base, false);
  }
  async getDetail(url) {
    const base = await this._resolveBaseUrl(), path = this._path(url), doc = new Document((await this._request(base + path, this._headers(base + "/"))).body);
    const title = doc.selectFirst(".list-content .top-movies-list-title h2"), og = doc.selectFirst("meta[property='og:title']");
    const name = this._text(title ? title.text : og && og.attr("content")).replace(/\s+자막.*$/, "").trim();
    if (!name) throw new Error("애니24 작품 정보를 찾지 못했습니다.");
    const info = {};
    for (const li of doc.select(".article-box-meta li")) { const spans = li.select("span"); if (spans.length) info[this._text(spans[0].text).replace(/:$/, "")] = spans.slice(1).map(s => s.text).join(" "); }
    const episodes = [];
    for (const a of doc.select(".eps-box .eps-item a[href]")) {
      let p; try { p = this._path(a.attr("href")); } catch (_) { continue; }
      const d = a.selectFirst(".eps-date"), date = d ? this._text(d.text).trim() : "";
      const dateText = (date.match(/\d{4}-\d{2}-\d{2}/) || [""])[0], timestamp = dateText ? Date.parse(dateText + "T00:00:00+09:00") : NaN;
      const label = this._text(a.text).replace(date, "").trim();
      episodes.push({ name: label || "재생", url: p, dateUpload: Number.isFinite(timestamp) ? String(timestamp) : "" });
    }
    const all = this._unique(episodes, "url"), desc = doc.selectFirst(".movie-coment");
    const completed = doc.select(".page-breadcrumb a[href]").some(a => /\/(?:finished|movie)\/?$/.test(a.attr("href")));
    return { name, link: path, imageUrl: this._image(base, doc.selectFirst(".article-box-img img") || doc.selectFirst("meta[property='og:image']")), author: info["원작"] || "", artist: info["제작사"] || "", genre: this._text(info["장르"]).split(/[,/]/).map(g => g.trim()).filter(Boolean), description: desc ? desc.text : "", status: completed ? 1 : 0, episodes: all, chapters: all };
  }
  _unpack(html) {
    // Decode the substitution table without executing remote JavaScript.
    const unpacked = [], chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const pattern = /\}\s*\('((?:\\.|[^'])*)',\s*(\d+),\s*(\d+),\s*'((?:\\.|[^'])*)'\.split\('\|'\)/g;
    for (const m of html.matchAll(pattern)) {
      const radix = Number(m[2]), words = m[4].split("|");
      if (radix < 2 || radix > 62 || words.length !== Number(m[3])) continue;
      unpacked.push(m[1].replace(/\b\w+\b/g, token => { let n = 0; for (const c of token) { const digit = chars.indexOf(c); if (digit < 0 || digit >= radix) return token; n = n * radix + digit; if (n > 2147483647) return token; } return words[n] || token; }).replace(/\\'/g, "'").replace(/\\\//g, "/"));
    }
    return unpacked.length ? unpacked.join(" ") : html;
  }
  async getVideoList(url) {
    const base = await this._resolveBaseUrl(), path = this._path(url), doc = new Document((await this._request(base + path, this._headers(base + "/"))).body);
    const frame = doc.selectFirst("iframe#video[src]") || doc.select("iframe[src]").find(f => /\/video\//.test(f.attr("src")));
    const player = this._absolute(base + path, frame && frame.attr("src"));
    if (!this._https(player)) throw new Error("애니24 플레이어를 찾지 못했습니다.");
    const origin = this._origin(player), playerHeaders = Object.assign(this._headers(player), { "X-Requested-With": "XMLHttpRequest" });
    let hash = player.replace(/[?#].*$/, "").split("/").pop();
    if (!/^[0-9a-f]{32}$/i.test(hash)) {
      const html = this._unpack((await this._request(player, playerHeaders)).body);
      hash = (html.match(/FirePlayer\(["']([^"']+)["']/) || [])[1];
    }
    if (!hash || hash.length > 512 || /[\x00-\x1f]/.test(hash)) throw new Error("애니24 플레이어 식별자 오류");
    const api = origin + "/player/index.php?" + this._query({ data: hash, do: "getVideo" });
    const headers = Object.assign({}, playerHeaders, { "Content-Type": "application/x-www-form-urlencoded" });
    const data = JSON.parse((await this._request(api, headers, this._query({ hash, r: "" }) + "&r=")).body);
    const video = data.securedLink || data.videoSource;
    if (!this._https(video)) throw new Error("애니24 영상 주소 오류");
    const videoHeaders = Object.assign(this._headers(this._origin(video) + "/"), { Accept: "*/*" });
    if (/\.mp4(?:[?#]|$)/i.test(video)) return [{ url: video, originalUrl: video, quality: "자동 (MP4)", headers: videoHeaders, subtitles: [], audios: [] }];
    return this._playlist((await this._request(video, videoHeaders)).body, video, videoHeaders);
  }
  getFilterList() {
    return [this._select("category", "분류", [["방영중", "ong"], ["완결", "list"], ["극장판", "movie"]]),
      this._select("sort", "정렬", [["업데이트", "updatetime"], ["인기순", "hits"], ["방영일", "air_date"]]),
      this._select("day", "요일 (방영중)", [["전체", ""], ["일", "1"], ["월", "2"], ["화", "3"], ["수", "4"], ["목", "5"], ["금", "6"], ["토", "7"], ["기타", "8"]]),
      this._select("genre", "장르", [["전체", ""]].concat(["미스테리", "추리", "거대로봇", "SF", "모험", "판타지", "이세계", "코미디", "학원", "로맨스", "액션", "닌자", "아이돌", "게임", "스포츠", "청춘", "능력", "드라마", "성장", "일상", "연애", "배틀"].map(g => [g, g])))];
  }
}

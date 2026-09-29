var mangayomiSources = [{
  id: 1676055829884576659,
  name: "11toon",
  lang: "ko",
  baseUrl: "https://www.11toon144.com",
  apiUrl: "",
  iconUrl: "https://www.google.com/s2/favicons?sz=128&domain=11toon144.com",
  typeSource: "single",
  itemType: 0,
  isManga: true,
  isFullData: false,
  isNsfw: false,
  hasCloudflare: false,
  version: "1.0.15",
  appMinVerReq: "",
  additionalParams: "",
  sourceCodeLanguage: 1,
  dateFormat: "",
  dateFormatLocale: "",
  pkgPath: "javascript/11toon.js"
}];

var PersonalSourceBase = class extends MProvider {
  constructor(options) {
    super();
    this.options = options || {};
    this.client = new Client();
    this.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
  }

  _text(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  _clean(value) {
    return this._text(value).replace(/\s+/g, " ").trim();
  }

  _attr(element, name) {
    if (!element) return "";
    try {
      return this._text(element.attr(name));
    } catch (_) {
      return "";
    }
  }

  _nodeText(element) {
    if (!element) return "";
    try {
      return this._clean(element.text);
    } catch (_) {
      return "";
    }
  }

  _sourceBase() {
    var configured = this.source && this.source.baseUrl ? this.source.baseUrl : this.options.fallbackBaseUrl;
    return this._text(configured).replace(/\/+$/, "");
  }

  async _resolveBaseUrl() {
    return this._sourceBase();
  }

  _origin(url) {
    var match = this._text(url).match(/^(https?:\/\/[^/?#]+)/i);
    return match ? match[1] : "";
  }

  _absolute(base, value) {
    var link = this._text(value).replace(/\\\//g, "/").replace(/&amp;/g, "&").trim();
    if (!link) return "";
    if (/^https?:\/\//i.test(link)) return link;
    if (/^\/\//.test(link)) return "https:" + link;

    var origin = this._origin(base);
    if (link.charAt(0) === "/") return origin + link;

    var directory = this._text(base).replace(/[?#].*$/, "").replace(/\/[^/]*$/, "/");
    return directory + link.replace(/^\.\//, "");
  }

  _path(value) {
    var link = this._text(value).replace(/&amp;/g, "&");
    var match = link.match(/^https?:\/\/[^/]+(\/[^#]*)/i);
    return match ? match[1] : link;
  }

  _styleImage(element) {
    var style = this._attr(element, "style");
    var match = style.match(/url\(\s*["']?([^"')]+)["']?\s*\)/i);
    return match ? match[1] : "";
  }

  _image(element, base) {
    if (!element) return "";
    var value = this._attr(element, "data-src") ||
      this._attr(element, "data-original") ||
      this._attr(element, "data-mobile-image") ||
      this._attr(element, "src") ||
      this._styleImage(element);
    return this._absolute(base, value);
  }

  _headers(referer, extra) {
    var headers = {
      "User-Agent": this.userAgent,
      "Referer": referer || this._sourceBase() + "/",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
    };
    var values = extra || {};
    for (var key in values) headers[key] = values[key];
    return headers;
  }

  async _request(url, label, referer, extra) {
    var response = await this.client.get(url, this._headers(referer, extra));
    if (response.statusCode && response.statusCode >= 400) {
      throw new Error((label || "요청") + " 실패: HTTP " + response.statusCode);
    }
    return this._text(response.body);
  }

  _hasNext(document) {
    var next = document.selectFirst("a[rel='next'], .pagination .next, .page-numbers.next, li.next a, a.next, .paging-nav a:last-child");
    if (!next) return false;
    var text = this._nodeText(next);
    return !!this._attr(next, "href") && !/^(?:이전|‹|«)$/.test(text);
  }

  _date(value) {
    var text = this._clean(value);
    var match = text.match(/(?:^|\D)(\d{2,4})[.\/-](\d{1,2})[.\/-](\d{1,2})(?:\D|$)/);
    if (!match) return "";
    var year = Number(match[1]);
    if (year < 100) year += 2000;
    var stamp = new Date(year, Number(match[2]) - 1, Number(match[3])).valueOf();
    return isNaN(stamp) ? "" : String(stamp);
  }
};

var DefaultExtension = class extends PersonalSourceBase {
  constructor() {
    super({
      key: "11toon",
      displayName: "11toon",
      fallbackBaseUrl: "https://www.11toon144.com",
      hostPattern: /^https:\/\/(?:www\.)?11toon\d*\.com$/i
    });
  }

  get supportsLatest() {
    return true;
  }

  _cleanTitle(title) {
    return this._clean(title)
      .replace(/\([^)]*\)/g, "")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/<[^>]*>/g, "")
      .trim();
  }

  _detailPath(title, id) {
    if (id) return "/bbs/board.php?bo_table=toons&is=" + encodeURIComponent(this._clean(id));
    return "/bbs/board.php?bo_table=toons&stx=" + encodeURIComponent(this._clean(title));
  }

  _titleFromHref(value) {
    var match = this._text(value).replace(/&amp;/g, "&").match(/[?&]stx=([^&#]+)/i);
    if (!match) return "";
    try {
      return this._clean(decodeURIComponent(match[1].replace(/\+/g, "%20")));
    } catch (_) {
      return this._clean(match[1]);
    }
  }

  _parseList(document, base) {
    var list = [];
    var seen = {};

    for (var anchor of document.select("a[href*='bo_table=toons']")) {
      var href = this._attr(anchor, "href");
      if (!href || /[?&]wr_id=/.test(href)) continue;

      var link = this._path(this._absolute(base + "/", href));
      if (seen[link]) continue;

      var title = anchor.selectFirst(".homelist-title, .curationHot__title, .title, h2, h3");
      var image = anchor.selectFirst(".homelist-thumb, .curationHot__img, img");
      var name = this._clean(
        this._nodeText(title) ||
        this._attr(anchor, "title") ||
        this._attr(image, "alt") ||
        this._titleFromHref(href)
      );
      if (!name) continue;

      list.push({ name: name, link: link, imageUrl: this._image(image, base) });
      seen[link] = true;
    }

    for (var item of document.select(".toons_item[data-id]")) {
      var id = this._attr(item, "data-id");
      var name = this._clean(this._attr(item, "data-title") || this._nodeText(item.selectFirst(".homelist-title")));
      var link = this._detailPath(name, id);
      if (!id || !name || seen[link]) continue;

      var image = item.selectFirst(".homelist-thumb, img");
      list.push({ name: name, link: link, imageUrl: this._image(image, base) });
      seen[link] = true;
    }

    return { list: list, hasNextPage: this._hasNext(document) };
  }

  async _catalog(path, label) {
    var base = await this._resolveBaseUrl();
    var html = await this._request(base + path, label, base + "/");
    return this._parseList(new Document(html), base);
  }

  async getPopular(page) {
    var number = Math.max(1, Number(page) || 1);
    return this._catalog("/bbs/board.php?bo_table=toon_c&tablename=" + encodeURIComponent("인기만화") + "&page=" + number, "인기 목록");
  }

  async getLatestUpdates(page) {
    var number = Math.max(1, Number(page) || 1);
    return this._catalog("/bbs/board.php?bo_table=toon_c&type=upd&tablename=" + encodeURIComponent("최신만화") + "&page=" + number, "최신 목록");
  }

  async search(query, page) {
    var number = Math.max(1, Number(page) || 1);
    return this._catalog("/bbs/search_stx.php?stx=" + encodeURIComponent(this._clean(query)) + "&page=" + number, "검색");
  }

  _meta(document, selector) {
    return this._attr(document.selectFirst(selector), "content");
  }

  _extractWrId(text) {
    if (!text) return "";
    var match = String(text).replace(/&amp;/g, "&").match(/[?&]wr_id=(\d+)/i);
    return match ? match[1] : "";
  }

  _isNavigationName(name) {
    return /^(?:처음부터|처음보기|첫화보기|첫화|최신화보기|최신화|마지막화보기|끝으로|이어보기|최근본|이전|다음|맨끝|목록)$/i.test(name);
  }

  _chapterDisplayName(name) {
    var value = this._clean(name);
    if (!value) return "";
    if (/(?:화|회|장|chapter|ch\.?)\s*$/i.test(value)) return value;
    var trailing = value.match(/^(.*\D)(\d+(?:[.-]\d+)?)\s*$/);
    return trailing ? trailing[1] + trailing[2] + "화" : value;
  }

  _episodePageUrl(pageUrl, page) {
    var source = this._text(pageUrl).split("#")[0];
    var question = source.indexOf("?");
    var pathname = question >= 0 ? source.substring(0, question) : source;
    var query = question >= 0 ? source.substring(question + 1) : "";
    var kept = [];
    for (var value of query.split("&")) {
      if (value && !/^page=\d+$/i.test(value)) kept.push(value);
    }
    return pathname + (kept.length ? "?" + kept.join("&") + "&" : "?") + "page=" + page;
  }

  _maxEpisodePage(document) {
    var maximum = 1;
    for (var anchor of document.select("nav.pg_wrap a[href*='page='], .pg_wrap a[href*='page='], a.pg_page[href*='page=']")) {
      var match = this._attr(anchor, "href").replace(/&amp;/g, "&").match(/[?&]page=(\d+)/i);
      if (match) maximum = Math.max(maximum, Number(match[1]) || 1);
    }
    return maximum;
  }

  _chapterSequence(name) {
    var text = this._clean(name).replace(/,/g, "");
    var matched = null;
    var match = null;
    var explicitPattern = /(\d+(?:\.\d+)?)\s*(?:화|회|장|chapter|ch\.?)(?=\D|$)/ig;
    while ((match = explicitPattern.exec(text)) !== null) matched = Number(match[1]);
    if (matched !== null && !isNaN(matched)) return matched;

    var trailing = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*$/);
    return trailing ? Number(trailing[1]) : null;
  }

  _oldestFirst(chapters) {
    var first = null;
    var last = null;
    for (var i = 0; i < chapters.length; i += 1) {
      first = this._chapterSequence(chapters[i].name);
      if (first !== null) break;
    }
    for (var j = chapters.length - 1; j >= 0; j -= 1) {
      last = this._chapterSequence(chapters[j].name);
      if (last !== null) break;
    }
    if (first !== null && last !== null && first > last) chapters.reverse();
    return chapters;
  }

  _appendEpisodes(document, episodes, seen) {
    var added = 0;
    for (var ep of document.select(".episode, li.episode, .toon-episode, .chapter-item, li[class*='episode']")) {
      var onclick = this._attr(ep, "onclick");
      var wrId = this._extractWrId(onclick);
      if (!wrId) {
        var aTag = ep.selectFirst("a[href*='wr_id=']");
        if (aTag) wrId = this._extractWrId(this._attr(aTag, "href"));
      }
      if (!wrId) continue;

      var url = "/bbs/board.php?bo_table=toons&wr_id=" + wrId;
      if (seen[url]) continue;

      var titleNode = ep.selectFirst(".episode-title, .title, .subject, .name, a");
      var name = this._chapterDisplayName(this._nodeText(titleNode) || this._nodeText(ep));
      if (!name || this._isNavigationName(name)) continue;

      var dateNode = ep.selectFirst(".free-date, .date, .datetime, time");
      episodes.push({
        name: name,
        url: url,
        dateUpload: this._date(this._nodeText(dateNode))
      });
      seen[url] = true;
      added += 1;
    }

    if (added > 0) return added;

    for (var a of document.select("a[href*='wr_id=']")) {
      var href = this._attr(a, "href");
      var wrId = this._extractWrId(href);
      if (!wrId) continue;

      var url = "/bbs/board.php?bo_table=toons&wr_id=" + wrId;
      if (seen[url]) continue;

      var name = this._chapterDisplayName(this._nodeText(a) || this._attr(a, "title") || this._attr(a, "aria-label"));
      if (!name || this._isNavigationName(name)) continue;

      episodes.push({ name: name, url: url, dateUpload: "" });
      seen[url] = true;
      added += 1;
    }
    return added;
  }

  async getDetail(url) {
    var base = await this._resolveBaseUrl();
    var path = this._path(url);
    var pageUrl = this._absolute(base + "/", path);

    if (/[?&]wr_id=\d+/i.test(pageUrl)) {
      var viewerHtml = await this._request(pageUrl, "뷰어", base + "/");
      var viewerDocument = new Document(viewerHtml);
      var seriesAnchor = viewerDocument.selectFirst(
        "a[href*='bo_table=toons'][href*='stx='], a[href*='bo_table=toons'][href*='is='], a.btn_toons, a.homelist-title"
      );
      if (seriesAnchor) {
        path = this._path(this._absolute(pageUrl, this._attr(seriesAnchor, "href")));
        pageUrl = this._absolute(base + "/", path);
      }
    }

    var requestUrl = pageUrl;
    var seriesId = pageUrl.match(/[?&]is=(\d+)/i);
    var seriesTitle = pageUrl.match(/[?&]stx=([^&#]+)/i);
    if (seriesId && seriesTitle) {
      var decodedTitle = "";
      try {
        decodedTitle = decodeURIComponent(seriesTitle[1].replace(/\+/g, "%20"));
      } catch (_) {
        decodedTitle = seriesTitle[1];
      }
      requestUrl = base + "/bbs/board.php?bo_table=toons&is=" + seriesId[1] + "&stx=" + encodeURIComponent(this._cleanTitle(decodedTitle));
    }

    var html = await this._request(requestUrl, "상세", base + "/");
    var document = new Document(html);
    var title = document.selectFirst(".cover-info .title, h1, meta[property='og:title']");
    var cover = document.selectFirst(".cover-info img.banner, .cover-info img, meta[property='og:image']");
    var description = document.selectFirst(".cover-info .content .genre-link, meta[property='og:description'], meta[name='description']");
    var author = this._meta(document, "meta[name='author'], meta[property='og:author']");

    var genres = [];
    var genreNode = document.selectFirst(".cover-info .genre .genre-link");
    var genreText = this._nodeText(genreNode);
    if (genreText) {
      genres = genreText.split(/[,/·]/).map(function (value) { return value.trim(); }).filter(Boolean);
    }

    var episodes = [];
    var seen = {};
    this._appendEpisodes(document, episodes, seen);

    var lastPage = this._maxEpisodePage(document);
    var emptyCount = 0;

    for (var episodePage = 2; episodePage <= lastPage; episodePage += 1) {
      var episodePageUrl = this._episodePageUrl(requestUrl, episodePage);
      var episodePageHtml = "";
      for (var attempt = 0; attempt < 2; attempt += 1) {
        try {
          episodePageHtml = await this._request(episodePageUrl, "회차 목록 " + episodePage + "페이지", requestUrl);
          if (episodePageHtml) break;
        } catch (_) {}
      }

      if (!episodePageHtml) {
        emptyCount += 1;
        if (emptyCount >= 2) break;
        continue;
      }

      var episodeDocument = new Document(episodePageHtml);
      var added = this._appendEpisodes(episodeDocument, episodes, seen);
      if (added > 0) {
        emptyCount = 0;
      } else {
        emptyCount += 1;
        if (emptyCount >= 2) break;
      }
    }

    if (!episodes.length) {
      throw new Error("11toon 상세 페이지에서 회차 목록을 찾지 못했습니다.");
    }

    episodes = this._oldestFirst(episodes);
    var rawCover = this._attr(cover, "content");
    var rawDescription = this._attr(description, "content");

    return {
      name: this._clean(this._nodeText(title) || this._attr(title, "content")),
      link: path,
      imageUrl: rawCover ? this._absolute(pageUrl, rawCover) : this._image(cover, pageUrl),
      author: author,
      artist: "",
      description: this._clean(rawDescription || this._nodeText(description)),
      genre: genres,
      status: 0,
      chapters: episodes
    };
  }

  _scriptArray(html, variable) {
    var expression = new RegExp("(?:var\\s+)?" + variable + "\\s*=\\s*(\\[[\\s\\S]*?\\])\\s*;", "i");
    var match = this._text(html).match(expression);
    if (!match) return [];
    try {
      var parsed = JSON.parse(match[1]);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      var values = [];
      var pattern = /["']([^"']+)["']/g;
      var item = null;
      while ((item = pattern.exec(match[1])) !== null) values.push(item[1]);
      return values;
    }
  }

  async getPageList(url) {
    var base = await this._resolveBaseUrl();
    var pageUrl = this._absolute(base + "/", this._path(url));
    var html = await this._request(pageUrl, "회차", base + "/");
    var document = new Document(html);
    var images = this._scriptArray(html, "img_list");
    if (!images.length) images = this._scriptArray(html, "img_list_2");
    if (!images.length) {
      for (var image of document.select(".view-content img, .scroll-viewer img, img.viewer-img")) {
        var value = this._attr(image, "data-src") || this._attr(image, "data-original") || this._attr(image, "src");
        if (value) images.push(value);
      }
    }

    var pages = [];
    var seen = {};
    for (var value of images) {
      var imageUrl = this._absolute(pageUrl, value);
      if (!/^https?:\/\//i.test(imageUrl) || seen[imageUrl]) continue;
      pages.push({
        url: imageUrl,
        headers: {
          "Referer": pageUrl,
          "User-Agent": this.userAgent,
          "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        }
      });
      seen[imageUrl] = true;
    }

    if (!pages.length) throw new Error("11toon 회차 본문에서 이미지 주소를 찾지 못했습니다.");
    return pages;
  }

  async getVideoList() { return []; }
  async getHtmlContent() { return ""; }
  async cleanHtmlContent(html) { return html; }
  getFilterList() { return []; }
};

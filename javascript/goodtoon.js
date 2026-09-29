var mangayomiSources = [{
  id: 6666598639145141353,
  name: "GoodToon",
  lang: "ko",
  baseUrl: "https://www.goodtoon005.com",
  apiUrl: "",
  iconUrl: "https://www.google.com/s2/favicons?sz=128&domain=goodtoon005.com",
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
  pkgPath: "javascript/goodtoon.js"
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

  _image(element, base) {
    if (!element) return "";
    var value = this._attr(element, "data-src") || this._attr(element, "data-original") || this._attr(element, "data-lazy-src");
    if (!value || /^data:image/i.test(value)) {
      value = this._attr(element, "src");
    }
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

  async _postRequest(url, label, referer, body) {
    var headers = this._headers(referer, {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Accept": "text/html,*/*;q=0.8"
    });
    var response = await this.client.post(url, headers, body || "");
    if (response.statusCode && response.statusCode >= 400) {
      throw new Error((label || "요청") + " 실패: HTTP " + response.statusCode);
    }
    return this._text(response.body);
  }

  _hasNext(document) {
    var next = document.selectFirst("a[rel='next'], .pagination .next, .page-numbers.next, li.next a");
    if (next && this._attr(next, "href")) return true;
    for (var anchor of document.select(".pagination a, a.page-numbers")) {
      if (/다음|next|»/i.test(this._nodeText(anchor)) && this._attr(anchor, "href")) return true;
    }
    return false;
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
      key: "goodtoon",
      displayName: "GoodToon",
      fallbackBaseUrl: "https://www.goodtoon005.com",
      hostPattern: /^https:\/\/(?:www\.)?goodtoon\d*\.com$/i
    });
  }

  get supportsLatest() {
    return true;
  }

  _isNavigationName(name) {
    return /^(?:처음부터|처음보기|첫화보기|첫화|최신화보기|최신화|마지막화보기|끝으로|이어보기|최근본|이전|다음|맨끝|목록)$/i.test(name);
  }

  _parseList(document, base) {
    var list = [];
    var seen = {};
    var selectors = ["a.card[href]", ".card-grid a[href*='/manga/']", ".page-item-detail a[href*='/manga/']", ".item-thumb a[href*='/manga/']"];
    for (var card of document.select(selectors.join(", "))) {
      var href = this._attr(card, "href");
      if (!/\/manga\/[^/]+\/?/i.test(href)) continue;
      var link = this._path(this._absolute(base + "/", href));
      if (seen[link]) continue;

      var title = card.selectFirst(".subject, .post-title, h2, h3, .heading");
      var image = card.selectFirst(".thumb img.img-responsive, img.img-responsive, img");
      var name = this._clean(this._nodeText(title) || this._attr(image, "alt") || this._attr(card, "title"));
      if (!name) continue;

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
    return this._catalog("/recommend/?pg=" + number, "인기 목록");
  }

  async getLatestUpdates(page) {
    var number = Math.max(1, Number(page) || 1);
    return this._catalog("/?pg=" + number, "최신 목록");
  }

  async search(query, page) {
    var number = Math.max(1, Number(page) || 1);
    return this._catalog("/?q=" + encodeURIComponent(this._clean(query)) + "&pg=" + number, "검색");
  }

  _meta(document, selector) {
    return this._attr(document.selectFirst(selector), "content");
  }

  _status(text) {
    var value = this._clean(text);
    if (/완결|complete/i.test(value)) return 1;
    if (/휴재|hiatus/i.test(value)) return 2;
    if (/취소|중단|cancel/i.test(value)) return 3;
    return 0;
  }

  _cleanChapterName(text) {
    return this._clean(text).replace(/^(?:(?:UP|NEW)\s*)+/i, "").trim();
  }

  _chapterSequence(name) {
    var text = this._cleanChapterName(name).replace(/,/g, "");
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

  _chapterRows(document) {
    return document.select(".wp-manga-chapter, .listing-chapters_wrap li, ul.main.version-chap li, ul.sub-chap li, .chapter-item, .chapter-li");
  }

  _canonicalChapterUrl(pageUrl, value) {
    var link = this._path(this._absolute(pageUrl, value));
    return link.replace(/[?#].*$/, "").replace(/\/+$/, "/");
  }

  _extractChapters(doc, pageUrl, mangaPrefix, chapters, seen) {
    var before = chapters.length;
    var rows = this._chapterRows(doc);
    for (var row of rows) {
      var a = row.selectFirst("a[href]");
      if (!a) continue;

      var href = this._attr(a, "href");
      var cUrl = this._canonicalChapterUrl(pageUrl, href);
      if (!cUrl || seen[cUrl] || cUrl.indexOf(mangaPrefix) !== 0 || cUrl === mangaPrefix) continue;

      var name = this._cleanChapterName(this._nodeText(a));
      if (!name || this._isNavigationName(name)) continue;

      var dateText = this._nodeText(row.selectFirst(".chapter-release-date, .date, small"));
      chapters.push({
        name: name,
        url: cUrl,
        dateUpload: this._date(dateText)
      });
      seen[cUrl] = true;
    }

    if (chapters.length === before) {
      for (var direct of doc.select(".listing-chapters_wrap a[href], #manga-chapters-holder a[href], a[href*='/chapter-'], a[href*='/ch-']")) {
        var directUrl = this._canonicalChapterUrl(pageUrl, this._attr(direct, "href"));
        if (!directUrl || seen[directUrl] || directUrl.indexOf(mangaPrefix) !== 0 || directUrl === mangaPrefix) continue;
        var directName = this._cleanChapterName(this._nodeText(direct));
        if (!directName || this._isNavigationName(directName)) continue;
        chapters.push({ name: directName, url: directUrl, dateUpload: "" });
        seen[directUrl] = true;
      }
    }
  }

  async _loadChapterDocument(pageUrl, fallbackDocument, mangaId) {
    var bestDocument = fallbackDocument;
    var bestCount = this._chapterRows(fallbackDocument).length;
    if (bestCount > 0) return bestDocument;

    var baseChapterUrl = pageUrl.replace(/[?#].*$/, "").replace(/\/+$/, "") + "/ajax/chapters/";
    var endpoints = [baseChapterUrl, baseChapterUrl + "?t=1"];

    for (var endpoint of endpoints) {
      try {
        var chapterHtml = await this._request(endpoint, "회차 목록", pageUrl, {
          "X-Requested-With": "XMLHttpRequest",
          "Accept": "text/html,*/*;q=0.8"
        });
        if (chapterHtml) {
          var chapterDocument = new Document(chapterHtml);
          var count = this._chapterRows(chapterDocument).length;
          if (count > 0) return chapterDocument;
        }
      } catch (_) {}
    }

    try {
      var postHtml = await this._postRequest(baseChapterUrl, "회차 목록 POST", pageUrl, "");
      var postDocument = new Document(postHtml);
      if (this._chapterRows(postDocument).length > 0) return postDocument;
    } catch (_) {}

    if (mangaId) {
      try {
        var base = this._origin(pageUrl);
        var adminHtml = await this._postRequest(base + "/wp-admin/admin-ajax.php", "관리자 회차 목록", pageUrl, "action=manga_get_chapters&manga=" + encodeURIComponent(mangaId));
        var adminDocument = new Document(adminHtml);
        if (this._chapterRows(adminDocument).length > 0) return adminDocument;
      } catch (_) {}
    }

    return fallbackDocument;
  }

  async getDetail(url) {
    var base = await this._resolveBaseUrl();
    var path = this._path(url);
    var pageUrl = this._absolute(base + "/", path);
    var mangaPrefix = path.replace(/[?#].*$/, "").replace(/\/+$/, "") + "/";

    var html = await this._request(pageUrl, "상세", base + "/");
    var document = new Document(html);
    var title = document.selectFirst(".manga-summary-info .summary-title, .post-title h1, h1");
    var cover = document.selectFirst(".manga-summary-cover img, .summary_image img, meta[property='og:image']");
    var authorNode = document.selectFirst(".manga-summary-author .author-text, .author-content a, .author-content");
    var description = document.selectFirst(".manga-summary-desc, .description-summary .summary__content, meta[property='og:description'], meta[name='description']");
    var statusNode = document.selectFirst(".summary-meta-row .meta-value, .post-status .summary-content");

    var genres = [];
    var genreContainer = document.selectFirst(".manga-summary-genres, .genres-content");
    if (genreContainer) {
      var genreLinks = genreContainer.select("a");
      if (genreLinks.length) {
        for (var genre of genreLinks) {
          var genreName = this._nodeText(genre);
          if (genreName) genres.push(genreName);
        }
      } else {
        genres = this._nodeText(genreContainer).split(/[,/·]/).map(function (value) { return value.trim(); }).filter(Boolean);
      }
    }

    var chapters = [];
    var seen = {};
    var holder = document.selectFirst("#manga-chapters-holder[data-id], div[id^='manga-chapters-holder'][data-id], .manga-chapters-holder[data-id]");
    var mangaId = holder ? this._attr(holder, "data-id") : "";
    if (!mangaId) {
      var idMatch = html.match(/(?:data-id|manga_id|data-manga)\s*=\s*["'](\d+)["']/i);
      if (idMatch) mangaId = idMatch[1];
    }

    var chapterDocument = await this._loadChapterDocument(pageUrl, document, mangaId);
    this._extractChapters(chapterDocument, pageUrl, mangaPrefix, chapters, seen);

    if (!chapters.length) {
      throw new Error("GoodToon 상세 페이지에서 회차 목록을 찾지 못했습니다.");
    }

    chapters = this._oldestFirst(chapters);
    var rawCover = this._attr(cover, "content");
    var rawDescription = this._attr(description, "content");

    return {
      name: this._clean(this._nodeText(title) || this._meta(document, "meta[property='og:title']")),
      link: path,
      imageUrl: rawCover ? this._absolute(pageUrl, rawCover) : this._image(cover, pageUrl),
      author: this._nodeText(authorNode),
      artist: "",
      description: this._clean(rawDescription || this._nodeText(description) || this._meta(document, "meta[property='og:description']")),
      genre: genres,
      status: this._status(this._nodeText(statusNode)),
      chapters: chapters
    };
  }

  async getPageList(url) {
    var base = await this._resolveBaseUrl();
    var pageUrl = this._absolute(base + "/", this._path(url));
    var html = await this._request(pageUrl, "회차", base + "/");
    var document = new Document(html);
    var pages = [];
    var seen = {};

    var selectors = [
      ".reading-content img",
      "img.wp-manga-chapter-img",
      ".page-break img",
      ".chapter-video-frame img",
      ".entry-content img",
      ".view-content img",
      ".scroll-viewer img",
      "div#viewer img"
    ];

    for (var image of document.select(selectors.join(", "))) {
      var value = this._attr(image, "data-src") || this._attr(image, "data-original") || this._attr(image, "data-lazy-src");
      if (!value || /^data:image/i.test(value)) {
        value = this._attr(image, "src");
      }
      if (!value || /^data:image/i.test(value)) continue;

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

    if (!pages.length) throw new Error("GoodToon 회차 본문에서 이미지 주소를 찾지 못했습니다.");
    return pages;
  }

  async getVideoList() { return []; }
  async getHtmlContent() { return ""; }
  async cleanHtmlContent(html) { return html; }
  getFilterList() { return []; }
};

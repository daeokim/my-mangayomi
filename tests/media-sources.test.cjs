const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const entries = JSON.parse(fs.readFileSync(path.join(root, 'anime_index.json'), 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));
function load(file, extra = {}) {
  const preferences = new Map(), calls = [], responses = [];
  const context = {
    MProvider: class {},
    SharedPreferences: class {
      get(k) { return preferences.get(k); }
      getString(k, fallback) { return preferences.get(k) ?? fallback; }
      setString(k, value) { preferences.set(k, value); }
    },
    Client: class {
      constructor(options) { this.options = options; }
      async get(url, headers) { return this.send(url, headers); }
      async post(url, headers, body) { return this.send(url, headers, body); }
      async send(url, headers, body) {
        calls.push({ url, headers, body, options: this.options });
        const r = responses.shift();
        if (r instanceof Error) throw r;
        if (!r) throw new Error('unexpected network request: ' + url);
        return { statusCode: 200, headers: {}, ...r };
      }
    },
    Document: class { select() { return []; } selectFirst() { return null; } },
    ...extra
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'javascript/anime', file + '.js'), 'utf8') + '\nglobalThis.ext = new DefaultExtension(); globalThis.meta = mangayomiSources[0];', context);
  const extension = context.ext;
  const entry = entries.find(e => e.sourceCodeUrl.endsWith('/' + file + '.js'));
  extension.source = { baseUrl: entry.baseUrl };
  return { context, extension, entry, preferences, calls, responses };
}
function node(text = '', attrs = {}, selectors = {}) {
  return { text, attr: k => attrs[k] || '', select: s => selectors[s] || [], selectFirst: s => (selectors[s] || [])[0] || null };
}
const groups = {
  variety: ['ent', 'ott_ent', 'old_ent'], movie: ['movie', 'kor_movie'],
  drama: ['drama', 'world', 'short_drama', 'old_drama'], anime: ['animation', 'ani_movie']
};
test('existing integrated source IDs and paths remain unchanged', () => {
  assert.equal(entries[0].id, 780920260911801);
  assert.equal(entries[1].id, 780920260915001);
  assert.equal(entries.length, 12);
  assert.equal(new Set(entries.map(e => e.id)).size, 12);
  assert.ok(entries.every(e => Number.isSafeInteger(e.id)));
});
for (const group of Object.keys(groups)) {
  test('TVRoom ' + group + ': popular/latest/empty search stay in the fixed category on every page', async () => {
    const { extension: e, preferences } = load('tvroom-' + group), calls = [];
    e._resolveBaseUrl = async () => e.fallbackBaseUrl;
    e._localizeResult = async r => r;
    e._categoryListing = async (base, c, country, order, page) => { calls.push({ key: c.key, country, order, page }); return { list: [{ name: '작품', link: '/video/11' }], hasNextPage: true }; };
    preferences.set(e.popularRulePreference, '1|homePopular|all|전체|시간순');
    await e.getPopular(2); await e.getLatestUpdates(3); await e.search('', 4);
    assert.deepEqual(calls.map(c => c.key), [group, group, group]);
    assert.deepEqual(calls.map(c => c.order), ['인기순', '시간순', '시간순']);
    assert.deepEqual(calls.map(c => c.page), [2, 3, 4]);
    assert.ok(e.getFilterList().every(f => !['contentType', 'tabRuleAction'].includes(f.type)));
  });
  test('TVRoom ' + group + ': text parser excludes other content categories', () => {
    const { extension: e } = load('tvroom-' + group), labels = { variety: '예능', movie: '영화', drama: '드라마', anime: '애니' };
    const items = Object.keys(labels).map((key, i) => node('작품', {}, {
      '.search-result-item-header > div': [node(labels[key])],
      'a.search-result-item-hitarea[href]': [node('작품 ' + i, { href: '/video/' + (100 + i) })]
    }));
    const result = e._parseSearch({ select: () => items, selectFirst: () => null }, e.fallbackBaseUrl);
    const works = result.list.filter(i => !i.link.includes('__tvroom_'));
    assert.equal(works.length, 1);
    assert.equal(works[0].link, '/video/' + (100 + Object.keys(labels).indexOf(group)));
  });
  test('TVWiki ' + group + ': includes all relevant boards, deduplicates and preserves paging', async () => {
    const { extension: e } = load('tvwiki-' + group), calls = [];
    assert.deepEqual(plain(e.categoryBoards), groups[group]);
    e._listing = async (p, page) => { calls.push([p, page]); return { list: [{ name: p, link: p + '/123' }, { name: p, link: p + '/123' }, { name: 'other', link: '/sisa/11' }], hasNextPage: p === '/' + groups[group][0] }; };
    e._ranking = async (page, period, board) => e._listing('/' + board, page);
    const latest = await e.getLatestUpdates(3), popular = await e.getPopular(4);
    assert.equal(latest.list.length, groups[group].length);
    assert.equal(latest.hasNextPage, true);
    assert.equal(popular.list.length, groups[group].length);
    assert.deepEqual(calls.slice(0, groups[group].length), groups[group].map(b => ['/' + b, 3]));
    assert.deepEqual(calls.slice(groups[group].length), groups[group].map(b => ['/' + b, 4]));
  });
  test('TVWiki ' + group + ': text queries scope each request to its board', async () => {
    const { extension: e } = load('tvwiki-' + group), requests = [];
    let current;
    e._resolveBaseUrl = async () => e.fallbackBaseUrl;
    e._get = async url => { requests.push(url); current = new URL(url).searchParams.get('onetable'); return 'fixture'; };
    e._parseCards = () => [{ name: '검색 결과', link: '/' + current + '/12' }];
    e._assertListPage = () => {};
    e._hasNext = () => false;
    const result = await e.search('작품 이름', 2, []);
    assert.equal(result.list.length, groups[group].length);
    assert.deepEqual(requests.map(u => new URL(u).searchParams.get('onetable')), groups[group]);
    assert.ok(requests.every(u => new URL(u).searchParams.get('stx') === '작품 이름' && new URL(u).searchParams.get('page') === '2'));
  });
}
for (const site of ['ani24', 'anilife']) {
  test(site + ': rejects foreign/old registry addresses and preserves cache through outage', async () => {
    const s = load(site), e = s.extension, key = site + '_last_base_v1';
    const future = site === 'ani24' ? 'https://ohli25.net' : 'https://anilife02.tv';
    s.responses.push({ body: JSON.stringify({ domains: { [site]: { baseUrl: future } } }) });
    assert.equal(await e._resolveBaseUrl(), future);
    assert.equal(await e._resolveBaseUrl(), future);
    assert.equal(s.calls.length, 1);
    s.preferences.set(key + '_time', '1');
    s.responses.push({ body: JSON.stringify({ domains: { [site]: { baseUrl: e.fallbackBaseUrl } } }) });
    assert.equal(await e._resolveBaseUrl(), future);
    s.responses.push(new Error('outage'));
    assert.equal(await e._resolveBaseUrl(), future);
    s.responses.push({ body: JSON.stringify({ domains: { [site]: { baseUrl: 'https://evil.invalid' } } }) });
    assert.equal(await e._resolveBaseUrl(), future);
    s.preferences.set(site + '_domain_url', e.fallbackBaseUrl);
    assert.equal(await e._resolveBaseUrl(), e.fallbackBaseUrl);
    assert.ok(!e._validBase('https://user@evil.invalid'));
  });
}
test('shared anime runtime and generated files are reproducible', () => {
  const run = require('node:child_process').spawnSync('python', ['domain-manager/build_sources.py'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes('already current'), run.stdout);
});
test('AniLife catalog paging, filters, relative covers, metadata and unique works', async () => {
  const s = load('anilife'), e = s.extension; e._resolveBaseUrl = async () => e.fallbackBaseUrl;
  const item = { id: 'abc', title: '작품', image: '/cover.jpg', studio: '제작사', genres: ['액션'], status: '완결' };
  s.responses.push({ body: JSON.stringify({ items: [item, item], pagination: { page: 1, pages: 3 } }) });
  const result = await e.getPopular(1);
  assert.equal(result.list.length, 1); assert.equal(result.hasNextPage, true);
  assert.equal(result.list[0].imageUrl, e.fallbackBaseUrl + '/cover.jpg');
  assert.equal(result.list[0].status, 1);
  assert.equal(new URL(s.calls[0].url).searchParams.get('sort'), 'popular');
  const filters = e.getFilterList(); filters.find(f => f.type === 'status').state = 2;
  s.responses.push({ body: JSON.stringify({ items: [], pagination: { page: 2, pages: 2 } }) });
  const result2 = await e.search('작품 & 질문?', 2, filters);
  assert.equal(result2.hasNextPage, false);
  assert.equal(new URL(s.calls[1].url).searchParams.get('q'), '작품 & 질문?');
  assert.equal(new URL(s.calls[1].url).searchParams.get('status'), '완결');
  s.responses.push({ body: '{}' }); await assert.rejects(() => e.getLatestUpdates(1), /응답 형식/);
});
test('AniLife detail keeps stable playable episode URLs and descending episode numbers', async () => {
  const s = load('anilife'), e = s.extension; e._resolveBaseUrl = async () => e.fallbackBaseUrl;
  s.responses.push({ body: JSON.stringify({ item: { id: 'abc', title: '작품', episodes: [
    { number: 1, playable: true, playbackUrl: '/api/playback/abc/ep1' },
    { number: 2, title: '다음 이야기', playable: true, playbackUrl: '/api/playback/abc/ep2' },
    { number: 3, playable: false, playbackUrl: '/api/playback/abc/ep3' },
    { number: 4, playable: true, playbackUrl: 'https://evil.invalid/path' },
    { number: 1, playable: true, playbackUrl: '/api/playback/abc/ep1' }
  ] } }) });
  const d = await e.getDetail('/content/abc/1');
  assert.deepEqual(plain(d.episodes.map(x => x.url)), ['/api/playback/abc/ep2', '/api/playback/abc/ep1']);
  assert.equal(d.episodes[0].name, '2화 · 다음 이야기');
  assert.equal(d.chapters, d.episodes);
  await assert.rejects(() => e.getDetail('https://evil.invalid/content/abc/1'), /주소 오류/);
});
test('AniLife refreshes an expired session once and never exports tokens/cookies to CDN headers', async () => {
  const s = load('anilife'), e = s.extension; e._resolveBaseUrl = async () => e.fallbackBaseUrl;
  s.responses.push({ body: '{"token":"first","expiresAt":9999999999}', headers: { 'set-cookie': 'sid=first; HttpOnly; Path=/' } }, { statusCode: 403 },
    { body: '{"token":"second","expiresAt":9999999999}', headers: { 'Set-Cookie': ['sid=second; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Path=/', 'other=ok; Path=/'] } },
    { body: '{"videoUrl":"https://cdn.example.org/video.m3u8","backupUrl":"https://cdn.example.org/video.m3u8","subtitleUrl":"/subs.vtt"}' });
  const videos = await e.getVideoList('/api/playback/abc/ep2');
  assert.equal(s.calls.length, 4); assert.equal(videos.length, 1);
  assert.equal(s.calls[3].headers['X-Anilife-Playback'], 'second');
  assert.equal(s.calls[3].headers.Cookie, 'sid=second; other=ok');
  assert.ok(s.calls.every(c => c.options.followRedirects === false && c.options.maxRedirects === 0));
  assert.equal(videos[0].headers.Cookie, undefined);
  assert.equal(videos[0].headers['X-Anilife-Playback'], undefined);
  assert.equal(videos[0].subtitles[0].file, e.fallbackBaseUrl + '/subs.vtt');
  assert.equal(videos[0].headers.Referer, e.fallbackBaseUrl + '/content/abc/ep2');
  await assert.rejects(() => e.getVideoList('https://evil.invalid/api/playback/abc/ep2'), /주소 오류/);
});
test('AniLife redirects fail closed and retries are bounded', async () => {
  const s = load('anilife'), e = s.extension; e._resolveBaseUrl = async () => e.fallbackBaseUrl;
  s.responses.push({ statusCode: 302 }, { statusCode: 302 });
  await assert.rejects(() => e.getVideoList('/api/playback/a/b'), /HTTP 302/);
  assert.equal(s.calls.length, 2);
});
test('Ani24 JSONP is decoded as data without evaluating code', () => {
  const e = load('ani24').extension;
  assert.equal(e._jsonp('callback({"msg":"<div>작품</div>"});'), '<div>작품</div>');
  assert.throws(() => e._jsonp('callback({"wrong":"body"});'), /응답 형식/);
  assert.equal(e._path('https://www.ohli24.net/123/작품?-1화.html'), '/123/작품?-1화.html');
  assert.throws(() => e._path('https://evil.invalid/123/name.html'), /주소 오류/);
  assert.equal(e._unpack("eval(function(p,a,c,k,e,d){}('0(\"1\")',2,2,'FirePlayer|hash'.split('|')))"), 'FirePlayer("hash")');
});
test('Ani24 listing parses cards, long title slug, lazy cover and paging', () => {
  const cards = [node('', {}, {
    'a.show-item-img-link[href], a.show-item-tile-link[href], a[href]': [node('', { href: '/123/긴-작품.html' })],
    '.show-item-title': [node('긴...')], '.show-item-img img, img': [node('', { 'data-src': '/cover.jpg' })]
  })];
  const s = load('ani24', { Document: class { select(q) { return q === '.show-item' ? cards : q === '.page-numbers' ? [node()] : q === '.page-numbers a' ? [node('다음')] : []; } } });
  const r = s.extension._parseList('fixture', s.entry.baseUrl, true);
  assert.equal(r.list[0].name, '긴 작품'); assert.equal(r.list[0].imageUrl, s.entry.baseUrl + '/cover.jpg'); assert.equal(r.hasNextPage, true);
});
test('Ani24 movie filters and keyword search produce encoded first-party URLs', async () => {
  const s = load('ani24'), e = s.extension; e._resolveBaseUrl = async () => e.fallbackBaseUrl;
  const filters = e.getFilterList(); filters.find(f => f.type === 'category').state = 2;
  s.responses.push({ body: 'callback({"msg":"empty"})' }); await e.search('', 2, filters);
  const u = new URL(s.calls[0].url); assert.equal(u.searchParams.get('name'), 'movie.html'); assert.equal(u.searchParams.get('catid'), '2'); assert.equal(u.searchParams.get('page'), '2');
  s.responses.push({ body: 'empty' }); await e.search('작품? / 제목', 3, []);
  assert.ok(s.calls[1].url.includes(encodeURIComponent('작품? / 제목') + '-parent_id-0-page-3.html'));
});
test('Ani24 detail preserves episode URLs, cover and Korean upload date', async () => {
  const episode = node('1화 2026-10-18', { href: '/222/작품-1화.html' }, { '.eps-date': [node('2026-10-18')] });
  const doc = node('', {}, { '.list-content .top-movies-list-title h2': [node('작품')], '.article-box-img img': [node('', { src: '/cover.jpg' })], '.eps-box .eps-item a[href]': [episode, episode] });
  const s = load('ani24', { Document: class { constructor() { return doc; } } }), e = s.extension;
  e._resolveBaseUrl = async () => e.fallbackBaseUrl; s.responses.push({ body: 'fixture' });
  const d = await e.getDetail('/123/작품.html');
  assert.equal(d.episodes.length, 1); assert.equal(d.episodes[0].url, '/222/작품-1화.html');
  assert.equal(d.episodes[0].name, '1화'); assert.equal(d.episodes[0].dateUpload, String(Date.parse('2026-10-18T00:00:00+09:00')));
});
test('Ani24 resolves FirePlayer POST and HLS variants with correct media headers/tracks', async () => {
  const hash = '0123456789abcdef0123456789abcdef', player = 'https://player.example.org/video/' + hash;
  const s = load('ani24', { Document: class { selectFirst(q) { return q === 'iframe#video[src]' ? node('', { src: player }) : null; } } }), e = s.extension;
  e._resolveBaseUrl = async () => e.fallbackBaseUrl;
  s.responses.push({ body: 'episode' }, { body: '{"securedLink":"https://cdn.example.org/hls/master.m3u8"}' }, { body: '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="한국어",URI="ko.vtt"\n#EXT-X-STREAM-INF:BANDWIDTH=800,RESOLUTION=1280x720,CODECS="avc1,mp4a"\n720/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1600,RESOLUTION=1920x1080\n1080/index.m3u8\n' });
  const videos = await e.getVideoList('/222/작품-1화.html');
  assert.equal(videos[0].quality, '1080p'); assert.equal(videos[0].url, 'https://cdn.example.org/hls/1080/index.m3u8');
  assert.equal(videos[0].subtitles[0].file, 'https://cdn.example.org/hls/ko.vtt');
  assert.equal(new URL(s.calls[1].url).searchParams.get('do'), 'getVideo'); assert.equal(s.calls[1].body, 'hash=' + hash + '&r=');
  assert.equal(videos[0].headers.Origin, 'https://cdn.example.org'); assert.equal(videos[0].headers.Referer, 'https://cdn.example.org/');
});

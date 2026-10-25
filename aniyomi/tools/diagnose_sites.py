"""Read-only snapshots of the TVWiki playback chain and the moved Ani24 site, taken from a runner that
can reach both. Mirrors the extensions' requests; session values are redacted before anything is saved."""
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else 'diag-out')
IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
REDACT = re.compile(r'("(?:session_data\d|t|sig|token|key|encrypted_key)"\s*:\s*)"[^"]{6,}"')
summary = []


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


opener = urllib.request.build_opener(NoRedirect)


def fetch(site, step, url, headers=None, data=None, limit=300_000):
    request = urllib.request.Request(url, data=data, headers=headers or {}, method='POST' if data else 'GET')
    try:
        with opener.open(request, timeout=20) as response:
            status, head, body = response.status, dict(response.headers), response.read(limit + 1)
    except urllib.error.HTTPError as error:
        status, head, body = error.code, dict(error.headers), error.read(limit + 1)
    except Exception as error:  # noqa: BLE001 - every failure is part of the report
        status, head, body = 0, {}, repr(error).encode()
    text = REDACT.sub(r'\1"<redacted>"', body[:limit].decode('utf-8', 'replace'))
    folder = OUT / site
    folder.mkdir(parents=True, exist_ok=True)
    name = f'{len(list(folder.iterdir())):02d}-{step}.txt'
    keep = {k: v for k, v in head.items() if k.lower() in ('content-type', 'location', 'server', 'set-cookie', 'cf-ray', 'content-length')}
    if 'Set-Cookie' in keep:
        keep['Set-Cookie'] = re.sub(r'=([^;]{4})[^;]*', r'=\1…', keep['Set-Cookie'])
    (folder / name).write_text(f'{"POST" if data else "GET"} {url}\nstatus {status}\nheaders {json.dumps(keep, ensure_ascii=False)}\n\n{text}')
    summary.append({'site': site, 'step': step, 'url': url, 'status': status, 'bytes': len(body), 'file': f'{site}/{name}'})
    return status, text, head


def tvwiki(base):
    h = {'User-Agent': IPHONE, 'Referer': base + '/'}
    _, html, _ = fetch('tvwiki', 'list', f'{base}/drama?page=1', h)
    work = next(iter(re.findall(r'href="(?:https?://[^"/]+)?(/drama/\d+)"', html)), None)
    if not work:
        return
    _, detail, _ = fetch('tvwiki', 'detail', base + work, h)
    episode = next(iter(re.findall(r'href="(?:https?://[^"/]+)?(/[a-z_]+/\d+/\d+)"', detail)), None)
    if not episode:
        return
    fetch('tvwiki', 'episode-page', base + episode, {**h, 'Referer': base + work})
    table, wr_id, ep_idx = episode.strip('/').split('/')
    api = {**h, 'Referer': base + episode, 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest'}
    status, body, _ = fetch('tvwiki', 'get_episode', f'{base}/bbs/get_episode.php?bo_table={table}&wr_id={wr_id}&ep_idx={ep_idx}', api)
    try:
        data = json.loads(urllib.request.urlopen(urllib.request.Request(f'{base}/bbs/get_episode.php?bo_table={table}&wr_id={wr_id}&ep_idx={ep_idx}', headers=api), timeout=20).read())
    except Exception:  # noqa: BLE001
        return
    ep = data.get('episode') or {}
    for field in ('session_data1', 'session_data2'):
        payload = ep.get(field)
        if not payload:
            continue
        payload = payload if isinstance(payload, str) else json.dumps(payload)
        post = {**h, 'Referer': base + episode, 'Origin': base, 'Accept': 'application/json', 'Content-Type': 'application/json; charset=utf-8'}
        try:
            raw = urllib.request.urlopen(urllib.request.Request(f'{base}/api/create_session.php', data=payload.encode(), headers=post, method='POST'), timeout=20).read()
            session = json.loads(raw)
            fetch('tvwiki', f'create_session-{field}', f'{base}/api/create_session.php', post, payload.encode())
        except urllib.error.HTTPError as error:
            fetch('tvwiki', f'create_session-{field}', f'{base}/api/create_session.php', post, payload.encode())
            continue
        except Exception:  # noqa: BLE001
            continue
        if not all(session.get(k) for k in ('player_url', 't', 'sig')):
            continue
        player = urllib.parse.urljoin(base + '/', session['player_url'])
        player += ('&' if '?' in player else '?') + urllib.parse.urlencode({'t': session['t'], 'sig': session['sig']})
        origin = re.match(r'https://[^/]+', player).group(0)
        fetch('tvwiki', 'player-page', player, {**h, 'Referer': base + episode})
        playlist = urllib.parse.urljoin(player, ep.get('hls_url', ''))
        vh = {'User-Agent': IPHONE, 'Referer': player, 'Origin': origin, 'Accept': '*/*'}
        status, m3u8, _ = fetch('tvwiki', 'playlist', playlist, vh)
        for line in m3u8.splitlines():
            line = line.strip()
            if line and not line.startswith('#'):
                child = urllib.parse.urljoin(playlist, line)
                _, inner, _ = fetch('tvwiki', 'child-or-segment', child, vh, limit=20_000)
                seg = next((l.strip() for l in inner.splitlines() if l.strip() and not l.startswith('#')), None)
                if seg and inner.lstrip().startswith('#EXTM3U'):
                    fetch('tvwiki', 'segment', urllib.parse.urljoin(child, seg), vh, limit=2_000)
                    fetch('tvwiki', 'segment-no-headers', urllib.parse.urljoin(child, seg), {'User-Agent': IPHONE}, limit=2_000)
                break
        return


def ani24(base):
    h = {'User-Agent': DESKTOP, 'Referer': base + '/'}
    _, home, _ = fetch('ani24', 'home', base + '/', h)
    for path in ('/ing', '/bbs/board.php?bo_table=ing', '/index.php?s=api&c=api&m=template&format=jsonp&name=ong.html&catid=3&order=updatetime&page=1'):
        fetch('ani24', 'probe', base + path, h, limit=60_000)
    links = list(dict.fromkeys(re.findall(r'href="([^"#]+)"', home)))
    (OUT / 'ani24' / 'links.txt').write_text('\n'.join(links[:300]))
    more = [l for l in links if '더보기' in home[max(0, home.find(l) - 400):home.find(l) + 400]]
    cards = [l for l in links if re.search(r'/(?:anime|ani|v|watch|detail|content|\d+)/', l)]
    for step, link in (('more', more[0] if more else None), ('card', cards[0] if cards else None)):
        if link:
            _, page, _ = fetch('ani24', step, urllib.parse.urljoin(base + '/', link), h)
            if step == 'card':
                inner = [l for l in dict.fromkeys(re.findall(r'href="([^"#]+)"', page)) if re.search(r'(?:ep|episode|화|play|watch|\d+\.html)', l)]
                if inner:
                    fetch('ani24', 'episode', urllib.parse.urljoin(base + '/', inner[0]), h)


import urllib.parse  # noqa: E402

registry = json.load(urllib.request.urlopen('https://raw.githubusercontent.com/daeokim/my-mangayomi/main/domains.json', timeout=20))
OUT.mkdir(parents=True, exist_ok=True)
for name, run in (('tvwiki', tvwiki), ('ani24', ani24)):
    try:
        run(registry['domains'][name]['baseUrl'].rstrip('/'))
    except Exception as error:  # noqa: BLE001
        summary.append({'site': name, 'step': 'crash', 'error': repr(error)})
(OUT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))
for row in summary:
    print(row)

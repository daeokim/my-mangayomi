"""Keep Mangayomi fallback addresses, versions and catalog rows in sync.

Python preserves the exact large integer source IDs in the catalogs.
Use --local to preview; --publish creates one fast-forward GitHub commit.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.request
from urllib.parse import urlsplit

PROFILES = {
    '11toon': ('javascript/11toon.js', 'index.json', r'(?:www\.)?11toon\d*\.com'),
    'blacktoon': ('javascript/blacktoon.js', 'index.json', r'(?:www\.)?blacktoon\d+\.com'),
    'goodtoon': ('javascript/goodtoon.js', 'index.json', r'(?:www\.)?goodtoon\d+\.com'),
    'tvwiki': ('javascript/anime/tvwiki.js', 'anime_index.json', r'(?:www\.)?tvwiki\d+\.net'),
    'tvroom': ('javascript/anime/tvroom.js', 'anime_index.json', r'(?:www\.)?tvroom\d+\.org'),
}

def origin(key, value):
    if not isinstance(value, str):
        raise ValueError('invalid_registry_address')
    u = urlsplit(value)
    if (u.scheme != 'https' or u.username or u.password or u.port or u.query or u.fragment
            or u.path not in ('', '/') or not re.fullmatch(PROFILES[key][2], u.hostname or '')):
        raise ValueError('invalid_registry_address')
    host = re.sub(r'^www\.', '', u.hostname)
    if int(re.search(r'(\d*)\.(?:com|net|org)$', host)[1] or 0) > 999999:
        raise ValueError('invalid_registry_number')
    return 'https://' + host

def bump(version):
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('invalid_extension_version')
    a, b, c = map(int, version.split('.'))
    return f'{a}.{b}.{c + 1}'

def build_changes(root):
    root = Path(root)
    state = json.loads((root / 'domains.json').read_text())
    if state.get('schemaVersion') != 1:
        raise ValueError('invalid_registry_schema')
    catalogs = {name: json.loads((root / name).read_text()) for name in ('index.json', 'anime_index.json')}
    originals = {name: json.dumps(value, ensure_ascii=False) for name, value in catalogs.items()}
    readme = (root / 'README.md').read_text()
    changes = {}
    for key, (source, catalog, _) in PROFILES.items():
        record = state['domains'][key]
        # A failed scan keeps the last confirmed address. Unconfirmed seeds and
        # temporary operator pins must not rewrite extension defaults.
        if (not record.get('lastConfirmedAt') or key in state.get('control', {}).get('overrides', {})):
            continue
        target = origin(key, record['baseUrl'])
        entries = [entry for entry in catalogs[catalog] if entry.get('sourceCodeUrl') ==
                   'https://daeokim.github.io/my-mangayomi/' + source]
        if len(entries) != 1:
            raise ValueError('source_catalog_match')
        entry = entries[0]
        code = (root / source).read_text()
        base = re.search(r'\bbaseUrl:\s*"([^"]+)"', code)
        version = re.search(r'\bversion:\s*"([^"]+)"', code)
        if not base or not version or version[1] != entry['version']:
            raise ValueError('source_metadata_mismatch')
        old = origin(key, base[1])
        old_number = int(re.search(r'(\d*)\.(?:com|net|org)$', old)[1] or 0)
        new_number = int(re.search(r'(\d*)\.(?:com|net|org)$', target)[1] or 0)
        if new_number < old_number:
            continue
        new_version = version[1]
        if target != old:
            new_version = bump(version[1])
            code = code.replace(base[1], target)
            code = re.sub(r'(\bversion:\s*")[^"]+(".*)',
                          lambda m: m[1] + new_version + m[2], code, count=1)
            if key == 'tvwiki':
                number = re.search(r'tvwiki(\d+)\.', target)[1]
                # Updating the extension must not revive an older fresh cache.
                code = re.sub(r'tvwiki_last_base_url_[A-Za-z0-9_]+', 'tvwiki_last_base_url_domain' + number, code)
                code = re.sub(r'tvwiki_last_base_time_[A-Za-z0-9_]+', 'tvwiki_last_base_time_domain' + number, code)
            if key in ('tvwiki', 'blacktoon'):
                code = re.sub(r'Number\(match\[1\]\) >= \d+', 'Number(match[1]) >= ' + str(new_number), code)
            elif key == 'goodtoon':
                code = re.sub(r'(Number\(\((?:candidate|saved)\.match\([^\n]+?\) \|\| \[\]\)\[1\]\) >= )\d+',
                              lambda m: m[1] + str(new_number), code)
            changes[source] = code
        entry['baseUrl'] = target
        entry['version'] = new_version
        row = f"| {entry['name']} | {new_version} | {target} | {entry['appMinVerReq']} |"
        pattern = r'^\| ' + re.escape(entry['name']) + r' \| [^\n]+$'
        readme, count = re.subn(pattern, lambda _: row, readme, count=1, flags=re.M)
        if count != 1:
            raise ValueError('readme_source_row_missing')
    for name, entries in catalogs.items():
        if json.dumps(entries, ensure_ascii=False) != originals[name]:
            changes[name] = json.dumps(entries, ensure_ascii=False, indent=2) + '\n'
    if readme != (root / 'README.md').read_text():
        changes['README.md'] = readme
    return changes

def publish_changes(root, changes):
    if not changes:
        return None
    token = os.environ.get('GITHUB_TOKEN')
    repo = os.environ.get('GITHUB_REPOSITORY', 'daeokim/my-mangayomi')
    if not token or not re.fullmatch(r'[\w.-]+/[\w.-]+', repo):
        raise ValueError('github_configuration')
    def api(path, data=None, method=None):
        request = urllib.request.Request('https://api.github.com/repos/' + repo + path,
            data=None if data is None else json.dumps(data, ensure_ascii=False).encode(),
            method=method, headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json', 'User-Agent': 'Daeo-Registry-Metadata', 'X-GitHub-Api-Version': '2022-11-28'})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    expected = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    if api('/git/ref/heads/main')['object']['sha'] != expected:
        raise RuntimeError('branch_changed_retry_workflow')
    commit = api('/git/commits/' + expected)
    tree = api('/git/trees', {'base_tree': commit['tree']['sha'], 'tree': [
        {'path': path, 'mode': '100644', 'type': 'blob', 'content': content} for path, content in changes.items()]})
    created = api('/git/commits', {'message': 'Sync validated addresses, extension versions and catalog rows',
                                  'tree': tree['sha'], 'parents': [expected]})
    # Never force: a concurrent main commit rejects this update without losing it.
    api('/git/refs/heads/main', {'sha': created['sha'], 'force': False}, 'PATCH')
    return created['sha']

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--local', action='store_true')
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    if args.local == args.publish:
        parser.error('choose exactly one of --local or --publish')
    root = Path(__file__).resolve().parents[1]
    changes = build_changes(root)
    if args.local:
        for path, content in changes.items():
            (root / path).write_text(content)
    else:
        sha = publish_changes(root, changes)
        if sha:
            print('Metadata commit:', sha)
    print('Synchronized files:', ', '.join(changes) or 'none; already current')

if __name__ == '__main__':
    main()

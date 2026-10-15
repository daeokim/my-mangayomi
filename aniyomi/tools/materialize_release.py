"""Reconstruct an immutable, already-signed APK from its verified binary delta.

No signing key is required or uploaded. The SHA-256 of both the input and output
is pinned in release.json. --publish stores the exact signed APK in GitHub and
uses a non-forced update so concurrent commits are never overwritten.
"""
import argparse
import base64
import bz2
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[2]

def digest(data):
    return hashlib.sha256(data).hexdigest()

def apply_delta(source, patch):
    # BSDIFF40 stores sign-magnitude little-endian offsets and three bzip2 streams.
    def integer(value):
        if len(value) != 8:
            raise ValueError('truncated_delta_integer')
        number = int.from_bytes(value, 'little')
        return -(number & ((1 << 63) - 1)) if number >> 63 else number
    if patch[:8] != b'BSDIFF40' or len(patch) < 32:
        raise ValueError('invalid_delta_format')
    control_size, diff_size, output_size = [integer(patch[i:i+8]) for i in (8, 16, 24)]
    if min(control_size, diff_size, output_size) < 0 or output_size > 100 * 1024 * 1024:
        raise ValueError('invalid_delta_size')
    a, b = 32 + control_size, 32 + control_size + diff_size
    control = bz2.decompress(patch[32:a])
    diff = bz2.decompress(patch[a:b])
    extra = bz2.decompress(patch[b:])
    out = bytearray(); old = di = ei = 0
    for offset in range(0, len(control), 24):
        x, y, seek = [integer(control[i:i+8]) for i in range(offset, offset+24, 8)]
        if min(x, y) < 0 or len(out) + x + y > output_size or di+x > len(diff) or ei+y > len(extra):
            raise ValueError('invalid_delta_control')
        out.extend((diff[di+i] + (source[old+i] if 0 <= old+i < len(source) else 0)) & 255 for i in range(x))
        out.extend(extra[ei:ei+y])
        old += x + seek; di += x; ei += y
    if len(out) != output_size or di != len(diff) or ei != len(extra):
        raise ValueError('incomplete_delta')
    return bytes(out)

def materialize(root=ROOT):
    root = Path(root)
    manifest = json.loads((root / 'aniyomi/releases/release.json').read_text())
    changes = {}
    for item in manifest['deltas']:
        target = root / item['target']
        if target.exists():
            if digest(target.read_bytes()) != item['sha256']:
                raise ValueError('existing_apk_hash_mismatch')
            continue
        source = (root / item['source']).read_bytes()
        patch = (root / item['patch']).read_bytes()
        if digest(source) != item['source_sha256'] or digest(patch) != item['patch_sha256']:
            raise ValueError('release_input_hash_mismatch')
        output = apply_delta(source, patch)
        if digest(output) != item['sha256']:
            raise ValueError('signed_apk_hash_mismatch')
        target.write_bytes(output)
        changes[item['target']] = output
    return changes

def publish(changes):
    if not changes:
        return
    repo = os.environ['GITHUB_REPOSITORY']
    token = os.environ['GITHUB_TOKEN']
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', repo):
        raise ValueError('invalid_repository')
    def api(path, data=None, method=None):
        req = urllib.request.Request('https://api.github.com/repos/' + repo + path,
            data=None if data is None else json.dumps(data).encode(), method=method,
            headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                     'Content-Type': 'application/json', 'User-Agent': 'Daeo-Signed-Release'})
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.load(response)
    expected = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if api('/git/ref/heads/main')['object']['sha'] != expected:
        raise RuntimeError('branch_changed_retry_workflow')
    parent = api('/git/commits/' + expected)
    elements = []
    for path, binary in changes.items():
        blob = api('/git/blobs', {'encoding': 'base64', 'content': base64.b64encode(binary).decode()})
        elements.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
    tree = api('/git/trees', {'base_tree': parent['tree']['sha'], 'tree': elements})
    commit = api('/git/commits', {'message': 'Publish verified signed Daeo TVRoom APK', 'parents': [expected], 'tree': tree['sha']})
    api('/git/refs/heads/main', {'sha': commit['sha'], 'force': False}, 'PATCH')
    print('Signed APK commit:', commit['sha'])

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    changes = materialize()
    if args.publish:
        publish(changes)
    print('Signed APKs:', ', '.join(changes) or 'already present; hashes verified')

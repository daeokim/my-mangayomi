"""Fail-closed extension signing and atomic, append-only repository publication.

Only trusted main jobs receive signing secrets. PR jobs run tests without them.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import tempfile
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
FINGERPRINT = '71d5e7b6fc35c90e4dae3c98e2e0001a545376eb52565fa743b49e8017eeb8c3'
MODULES = {'naver': 'manga', 'tvwiki': 'media', 'ani24': 'media', 'anilife': 'media'}
BINARY = {
    'daeomanga': ('manga', 'daeomanga-v1.4.1003.apk', 1003, '1.4.1003', 1004, '1.4.1004',
                  '527222caf3ab89401ce558a081e778d87a750e7a76efa07854c0d7e747ddc3a3'),
    'daemedia': ('media', 'daeotvroom-v14.1005.apk', 1005, '14.1005', 1006, '14.1006',
                '1b18360d186558c4f4c8f137fb0cd595fede5e8086a31e41f3ba2a6e9ac8bcc8'),
}
SECRETS = ('EXT_SIGNING_KEYSTORE_BASE64', 'EXT_SIGNING_STORE_PASSWORD',
           'EXT_SIGNING_KEY_ALIAS', 'EXT_SIGNING_KEY_PASSWORD')
STATE = 'aniyomi/releases/signed-state.json'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require_secrets(env):
    for name in SECRETS:
        if not env.get(name):
            raise RuntimeError('Repository secret ' + name + ' is not set')
    if env['EXT_SIGNING_KEY_ALIAS'] != 'dtoon-ext':
        raise RuntimeError('unexpected_extension_key_alias')


def checked_certificate(output):
    fingerprints = re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]+)$', output, re.M)
    if fingerprints != [FINGERPRINT]:
        raise RuntimeError('extension_certificate_mismatch')
    if not re.search(r'Verified using v[234][^\n]*: true', output):
        raise RuntimeError('APK_signature_v2_or_newer_required')


def patch_version(raw, old_code, old_version, code, version):
    """Change just the two manifest version attributes, preserving all other bytes.

    Transition versions have equal encoded lengths; reject any other layout.
    APK payload/DEX/resources and therefore source IDs remain untouched.
    """
    data = bytearray(raw)
    if struct.unpack_from('<HH', data) != (3, 8):
        raise ValueError('invalid_binary_manifest')
    pos, strings, locations, version_indices, count = 8, [], [], set(), 0
    while pos < len(data):
        kind, header, size = struct.unpack_from('<HHI', data, pos)
        if size < header or not size or pos + size > len(data):
            raise ValueError('invalid_manifest_chunk')
        if kind == 1:
            n, styles, flags, start, _ = struct.unpack_from('<5I', data, pos + 8)
            if strings or styles:
                raise ValueError('unsupported_manifest_string_pool')
            utf8 = bool(flags & 0x100)
            for i in range(n):
                p = pos + start + struct.unpack_from('<I', data, pos + header + i * 4)[0]
                def length(p, width):
                    value = int.from_bytes(data[p:p+width], 'little'); p += width
                    high = 1 << (width * 8 - 1)
                    if value & high:
                        value = ((value & (high-1)) << (width*8)) | int.from_bytes(data[p:p+width], 'little'); p += width
                    return value, p
                if utf8:
                    _, p = length(p, 1)
                    length_bytes, p = length(p, 1)
                else:
                    n16, p = length(p, 2); length_bytes = n16 * 2
                encoding = 'utf8' if utf8 else 'utf-16le'
                strings.append(bytes(data[p:p+length_bytes]).decode(encoding))
                locations.append((p, length_bytes, encoding))
        elif kind == 0x102 and strings[struct.unpack_from('<I', data, pos+20)[0]] == 'manifest':
            start, step, number = struct.unpack_from('<HHH', data, pos+24)
            for i in range(number):
                p = pos + 16 + start + i * step
                name = strings[struct.unpack_from('<I', data, p+4)[0]]
                if name == 'versionCode':
                    if data[p+15] != 0x10 or struct.unpack_from('<I', data, p+16)[0] != old_code or code != old_code + 1:
                        raise ValueError('unexpected_binary_version_code')
                    struct.pack_into('<I', data, p+16, code); count += 1
                elif name == 'versionName':
                    if data[p+15] != 3:
                        raise ValueError('unexpected_binary_version_name')
                    for offset in (8, 16):
                        idx = struct.unpack_from('<I', data, p+offset)[0]
                        if idx != 0xffffffff:
                            if strings[idx] != old_version:
                                raise ValueError('unexpected_binary_version_name')
                            version_indices.add(idx)
                    count += 1
        pos += size
    if count != 2 or not version_indices:
        raise ValueError('missing_manifest_versions')
    for idx in version_indices:
        p, size, encoding = locations[idx]
        encoded = version.encode(encoding)
        if len(encoded) != size:
            raise ValueError('transition_version_length_changed')
        data[p:p+size] = encoded
    return bytes(data)


def strip_and_bump(source, target, old_code, old_version, code, version):
    # ZipFile reserialization removes the APK v2/v3 signing block too.
    with zipfile.ZipFile(source) as src, zipfile.ZipFile(target, 'w') as dst:
        if len(src.namelist()) != len(set(src.namelist())):
            raise ValueError('duplicate_zip_entries')
        for info in src.infolist():
            if info.filename.upper().startswith('META-INF/') and info.filename.upper().endswith(('.SF', '.RSA', '.DSA', '.EC', 'MANIFEST.MF')):
                continue
            data = src.read(info.filename)
            if info.filename == 'AndroidManifest.xml':
                data = patch_version(data, old_code, old_version, code, version)
            info.extra = b''
            dst.writestr(info, data)


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def input_digest(module, ref='HEAD'):
    # Dependency closure: changing shared build/API/common/transport requires a bump.
    paths = ['aniyomi/native/' + module, 'aniyomi/native/common', 'aniyomi/native/api']
    if module != 'naver':
        paths.append('aniyomi/native/cronet')
    paths += ['aniyomi/native/build.gradle', 'aniyomi/native/settings.gradle',
              'aniyomi/native/gradle.properties', 'aniyomi/native/gradle']
    return sha(git('ls-tree', '-r', ref, '--', *paths))


def native_version(module):
    text = (ROOT / 'aniyomi/native' / module / 'build.gradle').read_text()
    return int(re.search(r'versionCode (\d+)', text)[1]), re.search(r"versionName '([^']+)'", text)[1]


def binary_digest(suffix,pinned,ref='HEAD'):
    if suffix!='daemedia':return pinned
    paths=['aniyomi/native/tvroom-recovery','aniyomi/tools/patch_tvroom_recovery.py','aniyomi/tools/tvroom']
    return sha(pinned.encode()+git('ls-tree','-r',ref,'--',*paths))


def run(*args, **kwargs):
    return subprocess.check_output(list(map(str, args)), text=True, stderr=subprocess.STDOUT, **kwargs)


def metadata(path):
    from androguard.core.apk import APK
    apk = APK(str(path))
    return apk, int(apk.get_androidversion_code()), apk.get_androidversion_name()


def verify(path, entry, signer):
    checked_certificate(run(signer, 'verify', '--verbose', '--print-certs', path))
    apk, code, version = metadata(path)
    if (apk.get_package(), code, version) != (entry['pkg'], entry['code'], entry['version']):
        raise RuntimeError('APK_package_or_version_mismatch')
    if apk.get_attribute_value('application', 'debuggable') not in (None, 'false', '0', '0x0', '0x00000000'):
        raise RuntimeError('debuggable_extension')
    return sha(path.read_bytes())


def prepare(temp):
    from loguru import logger
    logger.remove()
    require_secrets(os.environ)
    sdk = Path(os.environ['ANDROID_HOME']) / 'build-tools/35.0.0'
    signer, align = sdk / 'apksigner', sdk / 'zipalign'
    keystore = temp / 'extensions.jks'
    keystore.write_bytes(base64.b64decode(''.join(os.environ['EXT_SIGNING_KEYSTORE_BASE64'].split()), validate=True))
    keystore.chmod(0o600)
    # Verify the key BEFORE signing any APK; never display keytool output.
    cert = subprocess.check_output(['keytool', '-exportcert', '-keystore', str(keystore), '-alias', 'dtoon-ext',
                                    '-storepass:env', 'EXT_SIGNING_STORE_PASSWORD'], stderr=subprocess.DEVNULL)
    if sha(cert) != FINGERPRINT:
        raise RuntimeError('extension_keystore_certificate_mismatch')
    previous = json.loads((ROOT / STATE).read_text()) if (ROOT / STATE).exists() else {}
    catalogs = {kind: json.loads((ROOT / f'aniyomi/{kind}/index.min.json').read_text()) for kind in ('manga', 'media')}
    changes, state = {}, {}
    for kind, entries in catalogs.items():
        for entry in entries:
            suffix = entry['pkg'].rsplit('.', 1)[1]
            module = next((m for m in MODULES if suffix == 'daeo'+m), None)
            # TVWiki's package uses daeo, but Naver/others also follow this rule.
            if suffix == 'daemedia': module = None
            before = dict(entry)
            if module:
                code, version = native_version(module)
                provenance = input_digest(module)
                old = previous.get(entry['pkg'])
                if old and old['code'] == code:
                    if old['inputDigest'] != provenance:
                        raise RuntimeError('native_source_changed_without_versionCode_bump: ' + module)
                    if old['sha256'] != verify(ROOT / f'aniyomi/{kind}/apk' / entry['apk'], entry, signer):
                        raise RuntimeError('published_APK_hash_mismatch')
                    state[entry['pkg']] = old
                    continue
                if code <= entry['code']:
                    raise RuntimeError('native_versionCode_must_increase: ' + module)
                inputs = list((ROOT / f'aniyomi/native/{module}/build/outputs/apk/release').glob('*-unsigned.apk'))
                if len(inputs) != 1:
                    raise RuntimeError('exactly_one_unsigned_native_APK_required: ' + module)
                source = inputs[0]
                filename = f'{suffix}-v{version}.apk'
            elif suffix in BINARY:
                folder, filename_old, old_code, old_version, code, version, pinned = BINARY[suffix]
                filename = ('daeotvroom' if suffix == 'daemedia' else suffix) + f'-v{version}.apk'
                provenance = binary_digest(suffix,pinned)
                if entry['code'] == code:
                    old = previous.get(entry['pkg'])
                    if not old or old['inputDigest'] != provenance or old['sha256'] != verify(ROOT / f'aniyomi/{kind}/apk' / entry['apk'], entry, signer):
                        raise RuntimeError('binary_release_state_mismatch')
                    state[entry['pkg']] = old
                    continue
                if entry['code'] != old_code or entry['version'] != old_version:
                    raise RuntimeError('unexpected_binary_catalog_version')
                source_old = ROOT / f'aniyomi/{folder}/apk' / filename_old
                if sha(source_old.read_bytes()) != pinned:
                    raise RuntimeError('binary_input_hash_mismatch')
                if suffix=='daemedia':
                    from patch_tvroom_recovery import OUTPUT,verify_recovery_apk
                    source=OUTPUT
                    verify_recovery_apk(source,source_old)
                else:
                    source = temp / (suffix + '-unsigned.apk')
                    strip_and_bump(source_old, source, old_code, old_version, code, version)
            else:
                raise RuntimeError('unexpected_extension_package')
            entry.update(code=code, version=version, apk=filename)
            target = f'aniyomi/{kind}/apk/{filename}'
            if (ROOT / target).exists():
                raise RuntimeError('immutable_APK_filename_already_exists')
            aligned, signed = temp / (suffix + '-aligned.apk'), temp / filename
            run(align, '-P', '16', '-f', '4', source, aligned)
            run(signer, 'sign', '--ks', keystore, '--ks-key-alias', 'dtoon-ext',
                '--ks-pass', 'env:EXT_SIGNING_STORE_PASSWORD', '--key-pass', 'env:EXT_SIGNING_KEY_PASSWORD',
                '--v1-signing-enabled', 'false', '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'true',
                '--v4-signing-enabled', 'false', '--out', signed, aligned)
            digest = verify(signed, entry, signer)
            entry['sha256'] = digest
            changes[target] = signed.read_bytes()
            state[entry['pkg']] = {'code': code, 'sha256': digest, 'inputDigest': provenance}
            if entry['sources'] != before['sources'] or entry['lang'] != before['lang'] or entry['nsfw'] != before['nsfw']:
                raise RuntimeError('extension_identity_changed')
    if len(state) != 6:
        raise RuntimeError('six_verified_extensions_required')
    # Run the existing DEX/factory/source-ID checks against the complete proposed
    # catalog before making any remote changes. These are local generated files.
    for path, data in changes.items():
        (ROOT / path).write_bytes(data)
    for kind, entries in catalogs.items():
        (ROOT / f'aniyomi/{kind}/index.min.json').write_text(json.dumps(entries, ensure_ascii=False))
        path = ROOT / f'aniyomi/{kind}/repo.json'
        meta = json.loads(path.read_text())
        meta['meta']['signingKeyFingerprint'] = FINGERPRINT
        path.write_text(json.dumps(meta, ensure_ascii=False))
    run('python', ROOT / 'aniyomi/tools/verify_selected.py')
    return catalogs, changes, state


def publish(catalogs, changes, state):
    if not changes:
        print('All six current APKs already verified; nothing to publish.'); return
    # Re-read main so domain updates survive. Never publish an older native build.
    built = git('rev-parse', 'HEAD').decode().strip()
    repo = os.environ['GITHUB_REPOSITORY']
    if repo != 'daeokim/my-mangayomi':
        raise RuntimeError('unexpected_publication_repository')
    def api(path, data=None, method=None):
        request = urllib.request.Request('https://api.github.com/repos/' + repo + path,
            data=None if data is None else json.dumps(data).encode(), method=method,
            headers={'Authorization': 'Bearer ' + os.environ['GITHUB_TOKEN'], 'Accept': 'application/vnd.github+json',
                     'Content-Type': 'application/json', 'User-Agent': 'Dtoon-Extension-Release'})
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)
    for attempt in range(3):
        git('fetch', 'origin', 'main')
        parent = git('rev-parse', 'origin/main').decode().strip()
        for module in MODULES:
            if input_digest(module, built) != input_digest(module, parent):
                raise RuntimeError('main_native_source_changed_retry_latest_workflow')
        for suffix,values in BINARY.items():
            if binary_digest(suffix,values[-1],built)!=binary_digest(suffix,values[-1],parent):
                raise RuntimeError('main_binary_source_changed_retry_latest_workflow')
        # Signing/publisher inputs must also be current.
        for path in ('aniyomi/tools', '.github/workflows/aniyomi-native.yml'):
            if git('ls-tree', '-r', built, '--', path) != git('ls-tree', '-r', parent, '--', path):
                raise RuntimeError('main_release_tools_changed_retry_latest_workflow')
        merged = dict(changes)
        for kind, entries in catalogs.items():
            path = f'aniyomi/{kind}/index.min.json'
            latest = json.loads(git('show', parent + ':' + path))
            by_package = {e['pkg']: e for e in entries}
            for current in latest:
                new = by_package[current['pkg']]
                old = next(e for e in json.loads(git('show', built + ':' + path)) if e['pkg'] == current['pkg'])
                if any(current.get(k) != old.get(k) for k in ('code', 'version', 'apk', 'sha256', 'lang', 'nsfw')):
                    raise RuntimeError('main_catalog_release_changed_retry_latest_workflow')
                if [(s['id'], s['lang']) for s in current['sources']] != [(s['id'], s['lang']) for s in new['sources']]:
                    raise RuntimeError('main_source_identity_changed')
                for key in ('code', 'version', 'apk', 'sha256'):
                    if key in new: current[key] = new[key]
            merged[path] = (json.dumps(latest, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
            path = f'aniyomi/{kind}/repo.json'
            meta = json.loads(git('show', parent + ':' + path))
            meta['meta']['signingKeyFingerprint'] = FINGERPRINT
            merged[path] = (json.dumps(meta, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
        sums = git('show', parent + ':aniyomi/SHA256SUMS').decode()
        known = {line.split('  ', 1)[1]: line.split('  ', 1)[0] for line in sums.splitlines() if '  ' in line}
        for path, data in changes.items():
            relative = path.removeprefix('aniyomi/')
            # Do not overwrite any historical file, even if bytes happen to match.
            if subprocess.run(['git', 'cat-file', '-e', parent + ':' + path], cwd=ROOT, stderr=subprocess.DEVNULL).returncode == 0:
                raise RuntimeError('immutable_APK_already_published')
            if relative in known: raise RuntimeError('immutable_checksum_entry_exists')
            sums += f'{sha(data)}  {relative}\n'
        merged['aniyomi/SHA256SUMS'] = sums.encode()
        merged[STATE] = (json.dumps(state, indent=2, sort_keys=True) + '\n').encode()
        elements = []
        for path, data in merged.items():
            blob = api('/git/blobs', {'encoding': 'base64', 'content': base64.b64encode(data).decode()})
            elements.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
        base = api('/git/commits/' + parent)
        tree = api('/git/trees', {'base_tree': base['tree']['sha'], 'tree': elements})
        commit = api('/git/commits', {'message': 'Publish six verified Dtoon extensions', 'parents': [parent], 'tree': tree['sha']})
        try:
            api('/git/refs/heads/main', {'sha': commit['sha'], 'force': False}, 'PATCH')
        except urllib.error.HTTPError as error:
            if error.code in (409, 422) and attempt < 2: continue
            raise RuntimeError('atomic_publication_failed') from None
        print('Verified extension publication commit: ' + commit['sha']); return
    raise RuntimeError('concurrent_publication_retry_workflow')


if __name__ == '__main__':
    # Never print subprocess output: it may contain a keystore detail on failure.
    try:
        require_secrets(os.environ)
        with tempfile.TemporaryDirectory(prefix='dtoon-signing-', dir=os.environ['RUNNER_TEMP']) as directory:
            publish(*prepare(Path(directory)))
    except subprocess.CalledProcessError:
        raise SystemExit('Extension tool failed; publication stopped (sensitive tool output withheld).') from None

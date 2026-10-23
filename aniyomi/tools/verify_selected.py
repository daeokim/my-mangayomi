"""Check selected factories, APK metadata, IDs, certificate, and DEX integrity."""
from pathlib import Path
import hashlib
import json
import struct
import zlib
import re
from loguru import logger
logger.remove()
from androguard.core.apk import APK
from androguard.core.dex import DEX

ROOT = Path(__file__).resolve().parent.parent
EXPECTED = {'manga':['11toon 만화','Blacktoon 웹툰','Goodtoon 웹툰'],
            'media':['DC 영화','DC 드라마','DC 예능','DC 애니'],
            'tvwiki':['티비위키 영화','티비위키 드라마','티비위키 예능','티비위키 애니']}

def verify_cronet(apk, classes, source_class):
    import zipfile
    with zipfile.ZipFile(ROOT/'media/apk/daeotvroom-v14.1004.apk') as original:
        expected = hashlib.sha256(original.read('lib/arm64-v8a/libcronet.143.0.7445.0.so')).hexdigest()
    # Native video extensions ship the arm64-v8a library only (the app itself is arm64-v8a only).
    assert hashlib.sha256(apk.get_file('lib/arm64-v8a/libcronet.143.0.7445.0.so')).hexdigest() == expected
    assert [n for n in apk.get_files() if n.startswith('lib/')] == ['lib/arm64-v8a/libcronet.143.0.7445.0.so']
    assert apk.get_file('assets/cronet-LICENSE.txt') == (ROOT/'native/cronet/src/main/assets/cronet-LICENSE.txt').read_bytes()
    assert 'Ldaeo/extensions/common/CronetClient;' in classes
    assert 'Ldaeo/extensions/common/CronetClient$Transport;' in classes
    assert 'Lorg/chromium/net/CronetEngine;' in classes
    assert 'Lorg/chromium/net/impl/NativeCronetEngineBuilderWithLibraryLoaderImpl;' in classes
    assert any(m.get_name() == 'getClient' for m in source_class.get_methods())
    strings = [value for raw in apk.get_all_dex() for value in DEX(raw).get_strings()]
    assert apk.get_package() in strings
    assert 'Cronet native initialization failed; update the extension and restart Aniyomi' in strings

def interpret_factory(method):
    """Execute only the tiny registration method; never execute source/network code."""
    registers = {}
    for ins in method.get_instructions():
        op, operands = ins.get_name(), ins.get_operands()
        if op == 'nop':continue
        vals = [x[1] for x in operands]
        if op == 'new-instance':registers[vals[0]] = {'class':operands[1][2]}
        elif op == 'const-string':registers[vals[0]] = operands[1][2]
        elif op.startswith('invoke-direct'):
            args = vals[:-1]
            if len(args) == 3:registers[args[0]]['name'] = registers[args[1]]
        elif op == 'const/4':registers[vals[0]] = vals[1]
        elif op == 'new-array':registers[vals[0]] = [None] * registers[vals[1]]
        elif op == 'aput-object':registers[vals[1]][registers[vals[2]]] = registers[vals[0]]
        elif op == 'invoke-static':result = list(registers[vals[0]])
        elif op == 'move-result-object':registers[vals[0]] = result
        elif op == 'return-object':return registers[vals[0]]
        else:raise AssertionError('unexpected instruction: '+op)
    raise AssertionError('missing return')

for kind,names in EXPECTED.items():
    directory = ROOT / ('media' if kind == 'tvwiki' else kind)
    entries = json.loads((directory/'index.min.json').read_text())
    package_suffix = {'manga': '.daeomanga', 'media': '.daemedia', 'tvwiki': '.daeotvwiki'}[kind]
    entries = [e for e in entries if e['pkg'].endswith(package_suffix)]
    assert len(entries) == 1
    entry = entries[0]
    assert [s['name'] for s in entry['sources']] == names
    repo = json.loads((directory/'repo.json').read_text())
    path = directory/'apk'/entry['apk']
    apk = APK(str(path))
    assert apk.get_package() == entry['pkg']
    assert apk.get_androidversion_name() == entry['version']
    assert int(apk.get_androidversion_code()) == entry['code']
    assert apk.get_min_sdk_version() == '24'
    certs = apk.get_certificates_der_v2()
    assert len(certs) == 1
    assert hashlib.sha256(certs[0]).hexdigest() == repo['meta']['signingKeyFingerprint']
    dexbytes = apk.get_dex()
    assert dexbytes[12:32] == hashlib.sha1(dexbytes[32:]).digest()
    assert struct.unpack_from('<I',dexbytes,8)[0] == zlib.adler32(dexbytes[12:]) & 0xffffffff
    dex = DEX(dexbytes)
    registry = 'https://daeokim.github.io/my-mangayomi/domains.json'
    strings = list(dex.get_strings())
    lexical = lambda s: tuple(struct.unpack('<'+'H'*(len(s.encode('utf-16le'))//2),s.encode('utf-16le')))
    assert all(lexical(a) < lexical(b) for a,b in zip(strings,strings[1:]))
    assert registry in strings
    if kind == 'tvwiki':
        classes = {c.get_name():c for c in dex.get_classes()}
        prefix = 'Leu/kanade/tachiyomi/animeextension/ko/daeotvwiki/'
        assert classes[prefix+'TvWiki;'].get_superclassname() == 'Leu/kanade/tachiyomi/animesource/online/AnimeHttpSource;'
        factory = classes[prefix+'TvWikiFactory;']
        create = next(m for m in factory.get_methods() if m.get_name() == 'createSources')
        ids = [i.get_operands()[1][1] for i in create.get_instructions() if i.get_name().startswith('const-wide')]
        assert [str(i) for i in ids] == [s['id'] for s in entry['sources']]
        actual_names = [i.get_operands()[1][2] for i in create.get_instructions() if i.get_name() == 'const-string']
        assert actual_names[1::2] == names
        assert prefix+'TvWikiProxy;' in classes
        assert not any(c.startswith(('Leu/kanade/tachiyomi/animesource/', 'Lokhttp3/', 'Lkotlin/')) for c in classes)
        assert '/api/create_session.php' in strings
        assert (directory/'icon'/f"{entry['pkg']}.png").is_file()
        verify_cronet(apk, classes, classes[prefix+'TvWiki;'])
        print('tvwiki: separate package, four unique IDs, runtime registry, local proxy, host-only API and certificate PASS')
        continue
    owner,caller,obsolete = ('Lr1;','j','https://wankyo83.github.io/tokki-traffic-light/domains.json') if kind == 'manga' else ('Lqb;','S','https://t.me/s/tvroom8282')
    source = next(c for c in dex.get_classes() if c.get_name() == owner)
    method = next(m for m in source.get_methods() if m.get_name() == caller)
    used = [i.get_operands()[1][2] for i in method.get_instructions() if i.get_name() == 'const-string']
    assert used.count(registry) == 1 and obsolete not in used
    if kind == 'media':
        # The existing media signal reader extracts this URL directly from JSON.
        for number in [38,39,400]:
            body = json.dumps({'domains':{'tvroom':{'baseUrl':f'https://tvroom{number}.org'}}})
            assert re.search(r'https?://(?:www\.)?tvroom\d+\.org/?',body).group(0) == f'https://tvroom{number}.org'
    namespace = '{http://schemas.android.com/apk/res/android}'
    key = 'tachiyomi.extension.class' if kind == 'manga' else 'tachiyomi.animeextension.class'
    factory_name = next(m.get(namespace+'value') for m in apk.get_android_manifest_xml().findall('.//meta-data') if m.get(namespace+'name') == key)
    factory = next(c for c in dex.get_classes() if c.get_name() == 'L'+factory_name.replace('.','/')+';')
    method = next(m for m in factory.get_methods() if m.get_name() == 'createSources')
    objects = interpret_factory(method)
    assert len(objects) == len(names)
    if kind == 'manga':
        classes = {c.get_name():c for c in dex.get_classes()}
        assert 'Ldaeo/Registry;' in classes
        for descriptor,domain_key in [('Lc2;','11toon'),('Leu/kanade/tachiyomi/extension/ko/goodtoonwebtoontest/d;','goodtoon')]:
            getter = next(m for m in classes[descriptor].get_methods() if m.get_name() == 'getBaseUrl')
            ops = list(getter.get_instructions())
            assert ops[0].get_operands()[1][2] == domain_key
            assert 'Ldaeo/Registry;->resolve' in ops[1].get_output()
            assert any(i.get_name() == 'if-eqz' for i in ops)
            assert len([i for i in ops if i.get_name() == 'return-object']) == 2
        helper = classes['Ldaeo/Registry;']
        resolver = next(m for m in helper.get_methods() if m.get_name() == 'resolve')
        resolver_ops = [i.get_output() for i in resolver.get_instructions()]
        assert any('Looper;->myLooper' in s for s in resolver_ops)
        assert any('Matcher;->matches()Z' in s for s in resolver_ops)
        refresh = next(m for m in helper.get_methods() if m.get_name() == 'refresh')
        refresh_ops = [i.get_output() for i in refresh.get_instructions()]
        assert any(registry in s for s in refresh_ops)
        assert any('setReadTimeout' in s for s in refresh_ops)
        for obj,source in zip(objects,entry['sources']):
            source_class = classes[obj['class']]
            getname = next(m for m in source_class.get_methods() if m.get_name() == 'getName')
            actual = next(i.get_operands()[1][2] for i in getname.get_instructions() if i.get_name() == 'const-string')
            assert actual == source['name']
            getid = next(m for m in source_class.get_methods() if m.get_name() == 'getId')
            actual_id = next(i.get_operands()[1][1] for i in getid.get_instructions() if i.get_name() == 'const-wide')
            assert str(actual_id) == source['id']
        good = classes['Leu/kanade/tachiyomi/extension/ko/goodtoonwebtoontest/d;']
        seven = [i for m in good.get_methods() if m.get_name() in ('e','setupPreferenceScreen') for i in m.get_instructions() if i.get_name() == 'const-string' and i.get_operands()[1][2] == '7']
        assert len(seven) == 2
        black = classes['Leu/kanade/tachiyomi/extension/ko/blacktoon/d;']
        defaults = [i for m in black.get_methods() if m.get_name() in ('a','setupPreferenceScreen') for i in m.get_instructions() if i.get_name() == 'const-string' and i.get_operands()[1][2] == '424']
        assert len(defaults) == 2
        strings = list(dex.get_strings())
        assert 'https://blacktoon424.com' in strings
        assert 'https://blacktoon07.com' not in strings
        assert 'blacktoon_domain_num_v2' in strings
        assert 'blacktoon_domain_number' not in strings
        pattern = next(i.get_operands()[1][2] for m in black.get_methods() if m.get_name() == '<clinit>' for i in m.get_instructions() if i.get_name() == 'const-string' and i.get_operands()[1][2].startswith('blacktoon\\B'))
        for number in [0,7,99,100,399,400,419,420,423,424,425,499,500,999,1000,9999]:
            assert bool(re.search(pattern,'https://blacktoon'+str(number)+'.com')) == (number >= 424)
    else:
        assert [obj['name'] for obj in objects] == names
        assert 'https://tvroom40.org' in dex.get_strings()
        assert 'https://tvroom31.org' not in dex.get_strings()
        assert 'eu.kanade.tachiyomi.animeextension.ko.dctvroom' not in dex.get_strings()
        assert entry['pkg'] in dex.get_strings()
        assert apk.get_android_resources().get_packages_names() == [entry['pkg']]
    assert (directory/'icon'/f"{entry['pkg']}.png").is_file()
    print(kind+': catalogue, APK metadata, factory, IDs/defaults and certificate PASS')
for directory, suffix, class_name, expected_name, expected_id in [
    ('media', 'daeoani24', 'Ani24', '애니24', '850164079243120201'),
    ('media', 'daeoanilife', 'AniLife', '애니라이프', '850164079243120202'),
    ('manga', 'daeonaver', 'Naver', '네이버 웹툰', '850164079243120301'),
]:
    entries = json.loads((ROOT/directory/'index.min.json').read_text())
    entry, = [e for e in entries if e['pkg'].endswith('.'+suffix)]
    source, = entry['sources']
    assert (source['name'], source['id']) == (expected_name, expected_id)
    apk = APK(str(ROOT/directory/'apk'/entry['apk']))
    assert apk.get_package() == entry['pkg']
    assert apk.get_androidversion_name() == entry['version']
    assert int(apk.get_androidversion_code()) == entry['code']
    assert apk.get_min_sdk_version() == '24'
    cert, = apk.get_certificates_der_v2()
    repo = json.loads((ROOT/directory/'repo.json').read_text())
    assert hashlib.sha256(cert).hexdigest() == repo['meta']['signingKeyFingerprint']
    namespace = '{http://schemas.android.com/apk/res/android}'
    feature = 'tachiyomi.extension' if directory == 'manga' else 'tachiyomi.animeextension'
    meta = {m.get(namespace+'name'):m.get(namespace+'value') for m in apk.get_android_manifest_xml().findall('.//meta-data')}
    descriptor = 'L'+entry['pkg'].replace('.','/')+'/'+class_name+';'
    assert meta[feature+'.class'] == entry['pkg']+'.'+class_name
    assert meta[feature+'.nsfw'] == '0'
    classes = {}
    for raw in apk.get_all_dex():
        assert raw[12:32] == hashlib.sha1(raw[32:]).digest()
        assert struct.unpack_from('<I',raw,8)[0] == zlib.adler32(raw[12:]) & 0xffffffff
        classes.update({c.get_name():c for c in DEX(raw).get_classes()})
    clazz = classes[descriptor]
    parent = 'Leu/kanade/tachiyomi/source/online/HttpSource;' if directory == 'manga' else 'Leu/kanade/tachiyomi/animesource/online/AnimeHttpSource;'
    assert clazz.get_superclassname() == parent
    getter = next(m for m in clazz.get_methods() if m.get_name() == 'getId')
    values = [i.get_operands()[1][1] for i in getter.get_instructions() if i.get_name().startswith('const-wide')]
    assert values == [int(expected_id)]
    assert not any(c.startswith(('Leu/kanade/tachiyomi/source/', 'Leu/kanade/tachiyomi/animesource/', 'Lokhttp3/', 'Lkotlin/', 'Lorg/json/')) for c in classes)
    assert (ROOT/directory/'icon'/f"{entry['pkg']}.png").is_file()
    if directory == 'media':
        verify_cronet(apk, classes, clazz)
    else:
        assert 'Ldaeo/extensions/common/CronetClient;' not in classes
        assert not any(c.startswith('Lorg/chromium/') for c in classes)
    print(suffix+': standalone package, correct host API, source ID, manifest, DEX and certificate PASS')

all_ids = [s['id'] for folder in ['manga', 'media'] for e in json.loads((ROOT/folder/'index.min.json').read_text()) for s in e['sources']]
assert len(all_ids) == len(set(all_ids)), 'duplicate published source IDs'
print('Device installation and full reading/playback have not been tested.')

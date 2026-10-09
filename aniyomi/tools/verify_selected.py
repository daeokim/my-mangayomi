"""Check selected factories, APK metadata, IDs, certificate, and DEX integrity."""
from pathlib import Path
import hashlib
import json
import struct
import zlib
from loguru import logger
logger.remove()
from androguard.core.apk import APK
from androguard.core.dex import DEX

ROOT = Path(__file__).resolve().parent.parent
EXPECTED = {'manga':['11toon 만화','Blacktoon 웹툰','Goodtoon 웹툰'],
            'media':['DC 영화','DC 드라마','DC 예능','DC 애니']}

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
    directory = ROOT / kind
    entries = json.loads((directory/'index.min.json').read_text())
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
    namespace = '{http://schemas.android.com/apk/res/android}'
    key = 'tachiyomi.extension.class' if kind == 'manga' else 'tachiyomi.animeextension.class'
    factory_name = next(m.get(namespace+'value') for m in apk.get_android_manifest_xml().findall('.//meta-data') if m.get(namespace+'name') == key)
    factory = next(c for c in dex.get_classes() if c.get_name() == 'L'+factory_name.replace('.','/')+';')
    method = next(m for m in factory.get_methods() if m.get_name() == 'createSources')
    objects = interpret_factory(method)
    assert len(objects) == len(names)
    if kind == 'manga':
        classes = {c.get_name():c for c in dex.get_classes()}
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
    else:
        assert [obj['name'] for obj in objects] == names
        assert 'https://tvroom38.org' in dex.get_strings()
        assert 'https://tvroom31.org' not in dex.get_strings()
        assert 'eu.kanade.tachiyomi.animeextension.ko.dctvroom' not in dex.get_strings()
        assert entry['pkg'] in dex.get_strings()
        assert apk.get_android_resources().get_packages_names() == [entry['pkg']]
    assert (directory/'icon'/f"{entry['pkg']}.png").is_file()
    print(kind+': catalogue, APK metadata, factory, IDs/defaults and certificate PASS')
print('Device installation and live reading/playback have not been tested.')

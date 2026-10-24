"""Shared Dtoon artwork and display-only extension branding.

Binary APKs retain their DEX, resource table, source factory, package and payload;
only the manifest display/version fields and the five launcher PNGs change.
"""
from pathlib import Path
import argparse
import hashlib
import json
import struct
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'aniyomi/branding'
ANDROID = 'http://schemas.android.com/apk/res/android'
AAPT = 'http://schemas.android.com/aapt'
NAMES = {
    'daeomanga': 'Tachiyomi: Manga', 'daemedia': 'Aniyomi: TVRoom',
    'daeonaver': 'Tachiyomi: Naver', 'daeotvwiki': 'Aniyomi: TVWiki',
    'daeoani24': 'Aniyomi: Ani24', 'daeoanilife': 'Aniyomi: AniLife',
}
MIN_CODES = {'daeomanga': 1005, 'daemedia': 1010, 'daeonaver': 1004,
             'daeotvwiki': 1005, 'daeoani24': 1006, 'daeoanilife': 1006}
DENSITIES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
MODULES = ('naver', 'tvwiki', 'ani24', 'anilife')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def common_vector():
    ET.register_namespace('android', ANDROID)
    ET.register_namespace('aapt', AAPT)
    vector = ET.fromstring((ASSETS/'dtoon-foreground.xml').read_bytes())
    vector.set('{'+ANDROID+'}width', '48dp')
    vector.set('{'+ANDROID+'}height', '48dp')
    vector.insert(0, ET.Element('path', {
        '{'+ANDROID+'}fillColor': '#000000',
        '{'+ANDROID+'}pathData': 'M0,0h1024v1024H0z',
    }))
    return ET.tostring(vector, encoding='utf-8', xml_declaration=True) + b'\n'


def render_assets():
    """Maintainer-only rendering; CI checks committed bytes without a renderer."""
    import cairosvg
    vector = ET.fromstring(common_vector())
    svg = ET.Element('svg', xmlns='http://www.w3.org/2000/svg', viewBox='0 0 1024 1024')
    defs = ET.SubElement(svg, 'defs')
    attr = lambda element, name: element.get('{'+ANDROID+'}'+name)
    for i, path in enumerate(vector.findall('path')):
        attrs = {'d': attr(path, 'pathData')}
        if attr(path, 'fillColor'):
            attrs['fill'] = attr(path, 'fillColor')
        else:
            gradient = path.find('{'+AAPT+'}attr/gradient')
            if gradient is None:
                raise ValueError('unsupported_launcher_path')
            g = ET.SubElement(defs, 'linearGradient', id='g'+str(i), gradientUnits='userSpaceOnUse',
                              x1=attr(gradient, 'startX'), y1=attr(gradient, 'startY'),
                              x2=attr(gradient, 'endX'), y2=attr(gradient, 'endY'))
            for stop in gradient.findall('item'):
                ET.SubElement(g, 'stop', offset=attr(stop, 'offset'), **{'stop-color': attr(stop, 'color')})
            attrs['fill'] = 'url(#g'+str(i)+')'
        ET.SubElement(svg, 'path', attrs)
    raw = ET.tostring(svg)
    (ASSETS/'png').mkdir(exist_ok=True)
    metadata = json.loads((ASSETS/'source.json').read_text())
    metadata['renderer'] = 'CairoSVG '+cairosvg.__version__
    metadata['pngSha256'] = {}
    for density, size in DENSITIES.items():
        data = cairosvg.svg2png(bytestring=raw, output_width=size, output_height=size)
        (ASSETS/'png'/f'{density}.png').write_bytes(data)
        metadata['pngSha256'][density] = digest(data)
    (ASSETS/'ic_launcher.xml').write_bytes(common_vector())
    (ASSETS/'source.json').write_text(json.dumps(metadata, indent=2)+'\n')
    sync_assets()


def sync_assets():
    for module in MODULES:
        (ROOT/f'aniyomi/native/{module}/src/main/res/drawable/ic_launcher.xml').write_bytes(common_vector())
    icon = (ASSETS/'png/xxxhdpi.png').read_bytes()
    (ASSETS/'icon.png').write_bytes(icon)
    for folder in ('manga', 'media'):
        for entry in json.loads((ROOT/f'aniyomi/{folder}/index.min.json').read_text()):
            (ROOT/f'aniyomi/{folder}/icon/{entry["pkg"]}.png').write_bytes(icon)


def check_assets():
    metadata = json.loads((ASSETS/'source.json').read_text())
    assert digest((ASSETS/'dtoon-foreground.xml').read_bytes()) == metadata['sourceSha256']
    assert (ASSETS/'ic_launcher.xml').read_bytes() == common_vector()
    for density, size in DENSITIES.items():
        raw = (ASSETS/'png'/f'{density}.png').read_bytes()
        assert raw[:8] == b'\x89PNG\r\n\x1a\n'
        assert struct.unpack('>II', raw[16:24]) == (size, size)
        assert digest(raw) == metadata['pngSha256'][density]
    icon = (ASSETS/'png/xxxhdpi.png').read_bytes()
    assert (ASSETS/'icon.png').read_bytes() == icon
    for module in MODULES:
        assert (ROOT/f'aniyomi/native/{module}/src/main/res/drawable/ic_launcher.xml').read_bytes() == common_vector()
    for folder in ('manga', 'media'):
        for entry in json.loads((ROOT/f'aniyomi/{folder}/index.min.json').read_text()):
            suffix = entry['pkg'].rsplit('.', 1)[1]
            assert entry['name'] == NAMES[suffix]
            assert (ROOT/f'aniyomi/{folder}/icon/{entry["pkg"]}.png').read_bytes() == icon


def launcher_files(apk):
    icon = apk.get_attribute_value('application', 'icon')
    assert icon and icon.startswith('@')
    return [(config.get_qualifier(), value) for config, value
            in apk.get_android_resources().get_resolved_res_configs(int(icon[1:], 16))]


def branded_manifest(apk, suffix, code, version):
    # Reuse the existing string-pool-safe binary XML writer, retaining IDs and
    # every non-branding manifest attribute. No resource table rebuild is needed.
    from prepare_selected import patch_manifest
    ns = '{'+ANDROID+'}'
    metadata = {m.get(ns+'name'): m.get(ns+'value')
                for m in apk.get_android_manifest_xml().findall('.//meta-data')}
    factory = metadata.get('tachiyomi.extension.class') or metadata['tachiyomi.animeextension.class']
    return patch_manifest(apk.get_file('AndroidManifest.xml'), apk, {
        'pkg': apk.get_package(), 'name': NAMES[suffix].split(': ', 1)[1],
        'label': NAMES[suffix], 'code': code, 'version': version,
        'factory': 'L'+factory.replace('.', '/')+';',
    })


def prepare_binary(source, target, suffix, old_code, old_version, code, version):
    from androguard.core.apk import APK
    apk = APK(str(source))
    assert (int(apk.get_androidversion_code()), apk.get_androidversion_name()) == (old_code, old_version)
    assert code == old_code+1 and code == MIN_CODES[suffix]
    icons = dict(launcher_files(apk))
    assert set(icons) == set(DENSITIES) and len(set(icons.values())) == 5
    assert all(path.endswith('.png') for path in icons.values())
    payloads = {path: (ASSETS/'png'/f'{density}.png').read_bytes() for density, path in icons.items()}
    payloads['AndroidManifest.xml'] = branded_manifest(apk, suffix, code, version)
    Path(target).parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source) as before, zipfile.ZipFile(target, 'w') as after:
        assert len(before.namelist()) == len(set(before.namelist()))
        for info in before.infolist():
            if signature_file(info.filename):
                continue
            data = payloads.get(info.filename, before.read(info.filename))
            info.extra = b''
            after.writestr(info, data)
    verify_binary(source, target, suffix, code, version)


def signature_file(name):
    upper = name.upper()
    return upper.startswith('META-INF/') and upper.endswith(('.SF', '.RSA', '.DSA', '.EC', 'MANIFEST.MF'))


def verify_binary(source, target, suffix, code, version):
    from androguard.core.apk import APK
    old, new = APK(str(source)), APK(str(target))
    assert (new.get_package(), int(new.get_androidversion_code()), new.get_androidversion_name()) == (old.get_package(), code, version)
    assert new.get_file('AndroidManifest.xml') == branded_manifest(old, suffix, code, version)
    allowed = {'AndroidManifest.xml'} | {path for _, path in launcher_files(old)}
    with zipfile.ZipFile(source) as before, zipfile.ZipFile(target) as after:
        expected = {n for n in before.namelist() if not signature_file(n)}
        assert set(after.namelist()) == expected and len(after.namelist()) == len(expected)
        for name in expected-allowed:
            assert before.read(name) == after.read(name), 'unexpected_binary_payload_change: '+name
    verify_apk(target)


def verify_apk(path):
    from androguard.core.apk import APK, AXMLPrinter
    apk = APK(str(path)); suffix = apk.get_package().rsplit('.', 1)[1]
    assert apk.get_app_name() == NAMES[suffix]
    assert int(apk.get_androidversion_code()) >= MIN_CODES[suffix]
    ns = '{'+ANDROID+'}'
    for item in apk.get_android_manifest_xml().findall('.//meta-data'):
        if item.get(ns+'name') in ('tachiyomix.name', 'aniyomix.name'):
            assert item.get(ns+'value') == NAMES[suffix].split(': ', 1)[1]
    for density, name in launcher_files(apk):
        raw = apk.get_file(name)
        if name.endswith('.png'):
            assert raw == (ASSETS/'png'/f'{density}.png').read_bytes()
        else:
            root = AXMLPrinter(raw).get_xml_obj()
            paths = root.findall('path')
            expected = ET.fromstring(common_vector()).findall('path')
            assert [p.get(ns+'pathData') for p in paths] == [p.get(ns+'pathData') for p in expected]
            assert paths[0].get(ns+'fillColor').lower() in ('#ff000000', '#000000')
            gradients = root.findall('.//gradient')
            # aapt2 extracts aapt:attr gradients into anonymous color resources.
            if not gradients:
                for path in paths[1:]:
                    value = path.get(ns+'fillColor')
                    assert value.startswith('@')
                    configs = apk.get_android_resources().get_resolved_res_configs(int(value[1:], 16))
                    assert len(configs) == 1
                    gradient = AXMLPrinter(apk.get_file(configs[0][1])).get_xml_obj()
                    assert gradient.tag == 'gradient'
                    gradients.append(gradient)
            assert len(gradients) == 2
            for gradient in gradients:
                assert [e.get(ns+'color').lower() for e in gradient.findall('item')] == ['#ff6444f4', '#ff2389fa', '#ff00a9ef']
    print(suffix+': display name and shared Dtoon launcher artwork PASS')


def prepare_binaries(directory):
    from signed_release import BINARY
    output = []
    for suffix, (folder, filename, old_code, old_version, code, version, pinned) in BINARY.items():
        source = ROOT/f'aniyomi/{folder}/apk/{filename}'
        assert digest(source.read_bytes()) == pinned
        target = Path(directory)/(suffix+'-unsigned.apk')
        prepare_binary(source, target, suffix, old_code, old_version, code, version)
        output.append(target)
    return output


if __name__ == '__main__':
    from loguru import logger
    logger.remove()
    parser = argparse.ArgumentParser()
    parser.add_argument('--render', action='store_true')
    parser.add_argument('--check-assets', action='store_true')
    parser.add_argument('--prepare-binaries')
    parser.add_argument('--verify-native', action='store_true')
    args = parser.parse_args()
    if args.render: render_assets()
    if args.check_assets: check_assets(); print('Shared branding assets and six catalog icons PASS')
    if args.prepare_binaries: prepare_binaries(args.prepare_binaries)
    if args.verify_native:
        for module in MODULES:
            paths = list((ROOT/f'aniyomi/native/{module}/build/outputs/apk/release').glob('*-unsigned.apk'))
            assert len(paths) == 1
            verify_apk(paths[0])

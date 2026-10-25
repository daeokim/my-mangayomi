"""Exercise real APK transitions and reject changes outside the display scope."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from loguru import logger
logger.remove()
from androguard.core.apk import APK
from branding import (ROOT, ANDROID, MIN_CODES, check_assets, digest,
                      prepare_binaries, signature_file, verify_apk, verify_binary)
from signed_release import BINARY, FINGERPRINT, native_version


class DisplayBrandingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.outputs = prepare_binaries(cls.temp.name)

    def test_shared_artwork_matches_pinned_dtoon_source_and_all_six_catalogs(self):
        check_assets()

    def test_binary_manifest_retains_all_non_display_attributes(self):
        ns = '{'+ANDROID+'}'
        for target, (suffix, values) in zip(self.outputs, BINARY.items()):
            folder, filename, _, _, code, version, pinned = values
            source = ROOT/f'aniyomi/{folder}/apk/{filename}'
            self.assertEqual(digest(source.read_bytes()), pinned)
            old, new = APK(str(source)), APK(str(target))
            before = copy.deepcopy(old.get_android_manifest_xml())
            after = copy.deepcopy(new.get_android_manifest_xml())
            for tree in (before, after):
                for key in ('versionCode', 'versionName'):
                    tree.attrib.pop(ns+key)
                tree.find('application').attrib.pop(ns+'label')
                for item in tree.findall('.//meta-data'):
                    if item.get(ns+'name') == 'tachiyomix.name':
                        item.attrib.pop(ns+'value')
            def semantic(element):
                return element.tag, dict(element.attrib), [semantic(child) for child in element]
            self.assertEqual(semantic(before), semantic(after))
            verify_binary(source, target, suffix, code, version)

    def test_tampered_dex_resource_table_and_added_payload_are_rejected(self):
        suffix, values = next(iter(BINARY.items()))
        folder, filename, _, _, code, version, _ = values
        source = ROOT/f'aniyomi/{folder}/apk/{filename}'
        for changed in ('classes.dex', 'resources.arsc', 'assets/unexpected.txt'):
            with self.subTest(changed=changed):
                bad = Path(self.temp.name)/'tampered.apk'
                with zipfile.ZipFile(self.outputs[0]) as original, zipfile.ZipFile(bad, 'w') as output:
                    for info in original.infolist():
                        raw = original.read(info.filename)
                        output.writestr(info, raw+b'changed' if info.filename == changed else raw)
                    if changed not in original.namelist():
                        output.writestr(changed, b'unexpected')
                with self.assertRaises(AssertionError):
                    verify_binary(source, bad, suffix, code, version)

    def test_old_launcher_png_is_rejected_and_signatures_are_removed(self):
        suffix, values = next(iter(BINARY.items()))
        folder, filename, *_ = values
        source = ROOT/f'aniyomi/{folder}/apk/{filename}'
        bad = Path(self.temp.name)/'old-icon.apk'
        self.assertTrue(APK(str(source)).is_signed_v2())
        self.assertFalse(APK(str(self.outputs[0])).is_signed())
        with zipfile.ZipFile(source) as old, zipfile.ZipFile(self.outputs[0]) as current, zipfile.ZipFile(bad, 'w') as output:
            self.assertFalse(any(signature_file(n) for n in current.namelist()))
            for info in current.infolist():
                raw = old.read(info.filename) if info.filename == 'res/9w.png' else current.read(info.filename)
                output.writestr(info, raw)
        with self.assertRaises(AssertionError):
            verify_apk(bad)

    def test_catalog_identity_and_existing_signing_fingerprint_are_preserved(self):
        expected = {
            'daeomanga': (1, [('11toon 만화', '8796296375202334266'), ('Blacktoon 웹툰', '7080800841003944426'), ('Goodtoon 웹툰', '760550510744678728')]),
            'daemedia': (1, [('DC 영화', '2135778533207260895'), ('DC 드라마', '2494226570510620615'), ('DC 예능', '6870613666340329'), ('DC 애니', '1616219882372839663')]),
            'daeotvwiki': (1, [('티비위키 영화', '850164079243120101'), ('티비위키 드라마', '850164079243120102'), ('티비위키 예능', '850164079243120103'), ('티비위키 애니', '850164079243120104')]),
            'daeoani24': (0, [('애니24', '850164079243120201')]),
            'daeoanilife': (0, [('애니라이프', '850164079243120202')]),
            'daeonaver': (0, [('네이버 웹툰', '850164079243120301')]),
        }
        seen = set()
        for folder, namespace in (('manga', 'extension'), ('media', 'animeextension')):
            meta = json.loads((ROOT/f'aniyomi/{folder}/repo.json').read_text())['meta']
            self.assertEqual(meta['signingKeyFingerprint'], FINGERPRINT)
            for entry in json.loads((ROOT/f'aniyomi/{folder}/index.min.json').read_text()):
                suffix = entry['pkg'].rsplit('.', 1)[1]
                self.assertEqual(entry['pkg'], f'eu.kanade.tachiyomi.{namespace}.ko.{suffix}')
                self.assertEqual((entry['lang'], entry['nsfw']), ('ko', expected[suffix][0]))
                self.assertEqual([(s['name'], s['id']) for s in entry['sources']], expected[suffix][1])
                self.assertTrue(all(s['lang'] == 'ko' and s['versionId'] == 1 for s in entry['sources']))
                # Old published bytes stay available until main signs a new filename.
                self.assertEqual(digest((ROOT/f'aniyomi/{folder}/apk'/entry['apk']).read_bytes()), entry['sha256'])
                target_code = BINARY[suffix][4] if suffix in BINARY else native_version(suffix[4:])[0]
                # Binary patches are rebuilt exactly at the branding version; native modules only need to be at
                # or above it, since later fixes (TVWiki 1006, Ani24 1007) keep the branded sources.
                if suffix in BINARY: self.assertEqual(target_code, MIN_CODES[suffix])
                else: self.assertGreaterEqual(target_code, MIN_CODES[suffix])
                self.assertGreaterEqual(target_code, entry['code'])
                seen.add(suffix)
        self.assertEqual(seen, set(expected))


if __name__ == '__main__':
    unittest.main()

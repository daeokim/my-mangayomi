from pathlib import Path
import tempfile
import unittest
import zipfile
from signed_release import (ROOT, BINARY, FINGERPRINT, SECRETS, checked_certificate,
                            require_secrets, patch_version, strip_and_bump, input_digest)


class SigningSafetyTest(unittest.TestCase):
    def test_every_missing_secret_fails_with_name_only(self):
        complete = {name: 'private-fixture' for name in SECRETS}
        complete['EXT_SIGNING_KEY_ALIAS'] = 'dtoon-ext'
        for missing in SECRETS:
            env = dict(complete); del env[missing]
            with self.assertRaisesRegex(RuntimeError, '^Repository secret ' + missing + ' is not set$'):
                require_secrets(env)
        require_secrets(complete)

    def test_certificate_and_v2_are_both_required(self):
        good = 'Verified using v2 scheme (APK Signature Scheme v2): true\nSigner #1 certificate SHA-256 digest: ' + FINGERPRINT
        checked_certificate(good)
        for bad in (good.replace(FINGERPRINT, 'dd'*32), good.replace(': true', ': false'),
                    good + '\nSigner #2 certificate SHA-256 digest: ' + FINGERPRINT):
            with self.assertRaises(RuntimeError): checked_certificate(bad)

    def test_binary_transition_keeps_every_non_manifest_payload(self):
        for suffix, (kind, filename, old_code, old_version, code, version, digest) in BINARY.items():
            source = ROOT / f'aniyomi/{kind}/apk' / filename
            with tempfile.TemporaryDirectory() as tmp:
                output = Path(tmp)/'unsigned.apk'
                strip_and_bump(source, output, old_code, old_version, code, version)
                with zipfile.ZipFile(source) as before, zipfile.ZipFile(output) as after:
                    manifest = before.read('AndroidManifest.xml')
                    patched = after.read('AndroidManifest.xml')
                    from loguru import logger
                    logger.remove()
                    from androguard.core.apk import APK
                    old_apk, new_apk = APK(str(source)), APK(str(output))
                    self.assertEqual(new_apk.get_package(), old_apk.get_package())
                    self.assertEqual(int(new_apk.get_androidversion_code()), code)
                    self.assertEqual(new_apk.get_androidversion_name(), version)
                    self.assertEqual(len(manifest), len(patched))
                    # The only byte changes are version strings and the integer.
                    changes = sum(a != b for a, b in zip(manifest, patched))
                    self.assertLessEqual(changes, 8)
                    self.assertEqual(patch_version(patched, code, version, code+1, version[:-1]+str(int(version[-1])+1))[:8], manifest[:8])
                    with self.assertRaises(ValueError): patch_version(manifest, old_code+9, old_version, code, version)
                    for name in after.namelist():
                        if name != 'AndroidManifest.xml': self.assertEqual(before.read(name), after.read(name), name)
                    self.assertFalse(any(n.upper().endswith(('.RSA', '.SF')) for n in after.namelist()))

    def test_native_dependency_digests_are_stable_and_separate(self):
        self.assertEqual(input_digest('naver'), input_digest('naver'))
        self.assertNotEqual(input_digest('naver'), input_digest('tvwiki'))


if __name__ == '__main__': unittest.main()

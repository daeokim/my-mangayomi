"""Integration checks against the real unsigned binary built in PR CI."""
import hashlib
from pathlib import Path
import tempfile
import unittest
import zipfile
from patch_tvroom_recovery import SOURCE,OUTPUT,INPUT_SHA,verify_payload,verify_recovery_apk


class TvRoomBinaryTest(unittest.TestCase):
    def test_real_binary_identity_and_all_unchanged_methods(self):
        self.assertEqual(hashlib.sha256(SOURCE.read_bytes()).hexdigest(),INPUT_SHA)
        verify_recovery_apk(OUTPUT)

    def test_resource_tampering_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            wrong=Path(temp)/'wrong.apk'
            with zipfile.ZipFile(OUTPUT) as src,zipfile.ZipFile(wrong,'w') as dst:
                for info in src.infolist():
                    content=src.read(info.filename)
                    if info.filename=='resources.arsc':content+=b'changed'
                    dst.writestr(info,content)
            with self.assertRaisesRegex(ValueError,'tvroom_original_payload_changed'):
                verify_payload(SOURCE,wrong)

    def test_injected_extra_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            wrong=Path(temp)/'wrong.apk';wrong.write_bytes(OUTPUT.read_bytes())
            with zipfile.ZipFile(wrong,'a') as dst:dst.writestr('injected.txt','unexpected')
            with self.assertRaisesRegex(ValueError,'unexpected_tvroom_payload_entries'):
                verify_payload(SOURCE,wrong)


if __name__=='__main__':unittest.main()

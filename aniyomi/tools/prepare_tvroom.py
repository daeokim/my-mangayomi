"""Upgrade Daeo Media to Daeo TVRoom while preserving package/source identity.

Input is the already selected, registry-connected 14.1003 APK, not the upstream
APK. Output is unsigned; SignSelected.java must use the existing private key.
"""
import hashlib
from pathlib import Path
import struct
import sys
import zipfile
import zlib
from prepare_selected import patch_manifest
from androguard.core.apk import APK

EXPECTED_INPUT = 'ff68f8e3b3c0cae83c9fe567e5bcb1a710880c35fdb73d8044c55f37de57d45e'

def prepare(source, target):
    source, target = Path(source), Path(target)
    assert hashlib.sha256(source.read_bytes()).hexdigest() == EXPECTED_INPUT
    apk = APK(str(source))
    cfg = dict(pkg=apk.get_package(), name='Daeo TVRoom', label='Aniyomi: Daeo TVRoom',
               version='14.1004', code=1004,
               factory='Leu/kanade/tachiyomi/animeextension/ko/dctvroom/DcTvRoomFactory;')
    with zipfile.ZipFile(source) as src, zipfile.ZipFile(target, 'w') as dest:
        for info in src.infolist():
            if info.filename.upper().startswith('META-INF/') and info.filename.upper().endswith(('.SF', '.RSA', '.DSA', '.EC', 'MANIFEST.MF')):
                continue
            data = src.read(info.filename)
            if info.filename == 'AndroidManifest.xml':
                data = patch_manifest(data, apk, cfg)
            elif info.filename == 'classes.dex':
                data = bytearray(data)
                old, new = b'https://tvroom38.org', b'https://tvroom40.org'
                assert data.count(old) == 1 and len(old) == len(new)
                data = data.replace(old, new)
                data[12:32] = hashlib.sha1(data[32:]).digest()
                struct.pack_into('<I', data, 8, zlib.adler32(data[12:]) & 0xffffffff)
            info.extra = b''
            if info.compress_type == zipfile.ZIP_STORED:
                offset = dest.fp.tell() + 30 + len(info.filename.encode('utf8'))
                if offset % 4:
                    padding = (-offset - 4) % 4
                    info.extra = struct.pack('<HH', 0xd935, padding) + bytes(padding)
            dest.writestr(info, data)
    print('Prepared unsigned Daeo TVRoom 14.1004; package and four source IDs retained.')

if __name__ == '__main__':
    prepare(sys.argv[1], sys.argv[2])

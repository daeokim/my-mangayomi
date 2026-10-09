"""Prepare personal DC source subsets from pinned upstream APKs.

This changes factory registration, package metadata and documented defaults.
Source engines and source IDs remain upstream code. A new certificate is required.
"""
from pathlib import Path
import hashlib
import json
import struct
import zlib
import zipfile
from loguru import logger
logger.remove()
from androguard.core.apk import APK
from androguard.core.dex import DEX

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'output'
OUT.mkdir(exist_ok=True)
CONFIG = {
    'manga': {
        'sha256': '8caea537ba54845fc80dc72435ee04752ace6109704f0000f4ed0d9343da94cd',
        'factory': 'Leu/kanade/tachiyomi/extension/ko/dcmanga/ExtensionGenerated;',
        'keep': [12, 2, 3], 'pkg': 'eu.kanade.tachiyomi.extension.ko.daeomanga',
        'name': 'Daeo Manga', 'label': 'Tachiyomi: Daeo Manga', 'version': '1.4.1001',
        'code': 1001, 'filename': 'daeomanga-v1.4.1001.apk',
    },
    'media': {
        'sha256': 'f4ac3b0a266def23ead51dcdd39eb9e4f372fa13a1116ea3665b3ccad06c70b1',
        'factory': 'Leu/kanade/tachiyomi/animeextension/ko/dctvroom/DcTvRoomFactory;',
        'keep': [0, 1, 2, 4], 'pkg': 'eu.kanade.tachiyomi.animeextension.ko.daemedia',
        'name': 'Daeo Media', 'label': 'Aniyomi: Daeo Media', 'version': '14.1002',
        'code': 1002, 'filename': 'daeomedia-v14.1002.apk',
    },
}

def patch_factory(raw, cfg, kind):
    data = bytearray(raw)
    dex = DEX(raw)
    factory = next(c for c in dex.get_classes() if c.get_name() == cfg['factory'])
    method = next(m for m in factory.get_methods() if m.get_name() == 'createSources')
    instructions = list(method.get_instructions())
    blocks, block = [], []
    for ins in instructions:
        if ins.get_name() == 'new-instance':
            assert not block
            block = [ins]
        elif block:
            block.append(ins)
            if ins.get_name().startswith('invoke-direct'):
                blocks.append(block)
                block = []
        else:
            break
    assert len(blocks) == (15 if kind == 'manga' else 7)
    chosen = [blocks[i] for i in cfg['keep']]
    result = b''.join(bytes(i.get_raw()) for b in chosen for i in b)
    new_array = next(i for i in instructions if i.get_name() == 'new-array')
    array_type = bytes(new_array.get_raw())[2:4]
    # Use v14 as array, v13 as index; v0..v12 are existing selected objects.
    if kind == 'manga':
        array_reg, index_reg, registers = 14, 13, [12, 2, 3]
    else:
        array_reg, index_reg, registers = 6, 7, [8, 0, 1, 3]
    result += struct.pack('<BB', 0x12, (len(registers) << 4) | array_reg)
    result += struct.pack('<BB', 0x23, (array_reg << 4) | array_reg) + array_type
    for index, reg in enumerate(registers):
        result += struct.pack('<BB', 0x12, (index << 4) | index_reg)
        result += struct.pack('<BBBB', 0x4d, reg, array_reg, index_reg)
    invoke = next(i for i in instructions if i.get_name() == 'invoke-static')
    tail = bytearray(invoke.get_raw())
    assert len(tail) == 6 and tail[0] == 0x71
    tail[4] = array_reg
    tail[5] = 0
    result += bytes(tail) + bytes([0x0c, 0, 0x11, 0])
    offset = method.get_code_off()
    original_size = struct.unpack_from('<I', data, offset + 12)[0] * 2
    assert len(result) <= original_size and len(result) % 2 == 0
    data[offset + 16:offset + 16 + original_size] = result + bytes(original_size - len(result))

    if kind == 'manga':
        # Change only two Goodtoon const-string references, never the shared "2" string.
        strings = list(dex.get_strings())
        seven = strings.index('7')
        good = next(c for c in dex.get_classes() if c.get_name() ==
                    'Leu/kanade/tachiyomi/extension/ko/goodtoonwebtoontest/d;')
        replacements = 0
        for m in good.get_methods():
            if m.get_name() not in ('e', 'setupPreferenceScreen'):
                continue
            p = m.get_code_off() + 16
            for ins in m.get_instructions():
                if ins.get_name() == 'const-string' and ins.get_output().endswith('"2"'):
                    struct.pack_into('<H', data, p + 2, seven)
                    replacements += 1
                p += ins.get_length()
        assert replacements == 2
    else:
        old, new = b'https://tvroom31.org', b'https://tvroom38.org'
        assert data.count(old) == 1 and len(old) == len(new)
        data = data.replace(old, new)
        # Resource/package-manager lookups must follow the new manifest package.
        old_package = b'eu.kanade.tachiyomi.animeextension.ko.dctvroom'
        new_package = cfg['pkg'].encode('ascii')
        assert len(old_package) == len(new_package)
        string_index = list(dex.get_strings()).index(old_package.decode())
        string_table = struct.unpack_from('<I', data, 60)[0]
        string_offset = struct.unpack_from('<I', data, string_table + string_index * 4)[0]
        while data[string_offset] & 0x80:string_offset += 1
        string_offset += 1
        assert data[string_offset:string_offset + len(old_package)] == old_package
        data[string_offset:string_offset + len(old_package)] = new_package
    data[12:32] = hashlib.sha1(data[32:]).digest()
    struct.pack_into('<I', data, 8, zlib.adler32(data[12:]) & 0xffffffff)
    return bytes(data)

def length8(n):
    return bytes([n]) if n < 128 else bytes([(n >> 8) | 0x80, n & 255])

def length16(n):
    return struct.pack('<H', n) if n < 32768 else struct.pack('<HH', (n >> 16) | 0x8000, n & 65535)

def patch_manifest(raw, apk, cfg):
    """Append strings to binary XML, preserving attribute-name/resource-map indices."""
    data = bytearray(raw)
    pos = 8
    strings, chunks, pool_offset, pool_size = [], [], None, None
    while pos < len(data):
        typ, hs, size = struct.unpack_from('<HHI', data, pos)
        chunk = bytearray(data[pos:pos + size])
        chunks.append((typ, chunk))
        if typ == 1:
            assert pool_offset is None
            pool_offset, pool_size = pos, size
            count, styles, flags, start, style_start = struct.unpack_from('<5I', chunk, 8)
            assert styles == 0 and style_start == 0
            utf8 = bool(flags & 0x100)
            for i in range(count):
                p = start + struct.unpack_from('<I', chunk, hs + i * 4)[0]
                if utf8:
                    def readlen(p):
                        n = chunk[p];p += 1
                        if n & 128:n = ((n & 127) << 8) | chunk[p];p += 1
                        return n,p
                    _,p = readlen(p);n,p = readlen(p)
                    strings.append(bytes(chunk[p:p+n]).decode('utf8'))
                else:
                    n = struct.unpack_from('<H', chunk, p)[0];p += 2
                    if n & 32768:n = ((n & 32767) << 16) | struct.unpack_from('<H', chunk, p)[0];p += 2
                    strings.append(bytes(chunk[p:p+n*2]).decode('utf-16le'))
        pos += size
    assert pool_offset is not None
    old_pkg = apk.get_package()
    def intern(text):
        if text not in strings:strings.append(text)
        return strings.index(text)
    def setstring(chunk, p, value):
        idx = intern(value)
        struct.pack_into('<I', chunk, p + 8, idx)
        chunk[p + 15] = 3
        struct.pack_into('<I', chunk, p + 16, idx)
    for typ,chunk in chunks:
        if typ != 0x102:continue
        element = strings[struct.unpack_from('<I', chunk, 20)[0]]
        attrstart,attrsize,count = struct.unpack_from('<HHH', chunk, 24)
        attrs = {}
        for i in range(count):
            p = 16 + attrstart + attrsize * i
            name = strings[struct.unpack_from('<I', chunk, p + 4)[0]]
            attrs[name] = p
        for name,p in attrs.items():
            typval = chunk[p + 15]
            value = strings[struct.unpack_from('<I',chunk,p+16)[0]] if typval == 3 else None
            if name == 'package':setstring(chunk,p,cfg['pkg'])
            elif element == 'manifest' and name == 'versionName':setstring(chunk,p,cfg['version'])
            elif element == 'manifest' and name == 'versionCode':struct.pack_into('<I',chunk,p+16,cfg['code'])
            elif element == 'uses-sdk' and name == 'minSdkVersion':struct.pack_into('<I',chunk,p+16,24)
            elif element == 'application' and name == 'label':setstring(chunk,p,cfg['label'])
            elif value and value.startswith(old_pkg + '.DYNAMIC_'):
                setstring(chunk,p,value.replace(old_pkg,cfg['pkg'],1))
        if element == 'meta-data' and 'name' in attrs and 'value' in attrs:
            p = attrs['name']; key = strings[struct.unpack_from('<I',chunk,p+16)[0]]
            if key in ('tachiyomi.extension.class','tachiyomi.animeextension.class'):
                setstring(chunk,attrs['value'],cfg['factory'][1:-1].replace('/','.'))
            elif key == 'tachiyomix.name':setstring(chunk,attrs['value'],cfg['name'])
    records, offsets = bytearray(), []
    for s in strings:
        offsets.append(len(records))
        n16 = len(s.encode('utf-16le')) // 2
        if utf8:
            encoded = s.encode('utf8');records += length8(n16) + length8(len(encoded)) + encoded + b'\0'
        else:records += length16(n16) + s.encode('utf-16le') + b'\0\0'
    records += bytes((-len(records)) % 4)
    start = 28 + len(strings) * 4
    pool = struct.pack('<HHI5I',1,28,start+len(records),len(strings),0,0x100 if utf8 else 0,start,0)
    pool += struct.pack('<'+'I'*len(offsets),*offsets) + records
    body = b''.join(pool if typ == 1 else bytes(chunk) for typ,chunk in chunks)
    return struct.pack('<HHI',3,8,8+len(body)) + body

def prepare(kind):
    cfg = CONFIG[kind]
    original = ROOT / f'dc-{kind}-original.apk'
    digest = hashlib.sha256(original.read_bytes()).hexdigest()
    if cfg.get('sha256'):assert digest == cfg['sha256']
    apk = APK(str(original))
    dex = patch_factory(apk.get_dex(),cfg,kind)
    manifest = patch_manifest(apk.get_file('AndroidManifest.xml'),apk,cfg)
    unsigned = OUT / cfg['filename'].replace('.apk','-unsigned.apk')
    with zipfile.ZipFile(original) as src,zipfile.ZipFile(unsigned,'w') as dest:
        for info in src.infolist():
            if info.filename.upper().startswith('META-INF/') and info.filename.upper().endswith(('.SF','.RSA','.DSA','.EC','MANIFEST.MF')):continue
            payload = src.read(info.filename)
            if info.filename == 'classes.dex':payload = dex
            elif info.filename == 'AndroidManifest.xml':payload = manifest
            elif kind == 'media' and info.filename == 'resources.arsc':
                old_name = apk.get_package().encode('utf-16le') + b'\0\0'
                new_name = cfg['pkg'].encode('utf-16le') + b'\0\0'
                assert len(old_name) == len(new_name) and payload.count(old_name) == 1
                payload = payload.replace(old_name,new_name)
            info.extra = b''
            if info.filename == 'resources.arsc':info.compress_type = zipfile.ZIP_STORED
            if info.compress_type == zipfile.ZIP_STORED:
                offset = dest.fp.tell() + 30 + len(info.filename.encode('utf8'))
                if offset % 4:
                    padding = (-offset - 4) % 4
                    info.extra = struct.pack('<HH',0xd935,padding) + bytes(padding)
            dest.writestr(info,payload)
    print(json.dumps({'kind':kind,'input_sha256':digest,'unsigned':str(unsigned),'package':cfg['pkg']}))

if __name__ == '__main__':
    for kind in CONFIG:prepare(kind)

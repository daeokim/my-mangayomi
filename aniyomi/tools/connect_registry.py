"""Reassemble the manga DEX with explicit common-registry getters for two sources.

Usage: python connect_registry.py APKTOOL_JAR MANGA_UNSIGNED_APK
Apktool 3.0.3 is pinned to its official release digest. No resource rebuild.
"""
from pathlib import Path
import hashlib,re,shutil,subprocess,sys,tempfile,zipfile,os

ROOT=Path(__file__).resolve().parent
TOOL_HASH='dbf930b076c6b9be08d57c449cacefc3bdd6b71ebd59b3066fc0e1f5b14f9423'
jar=Path(sys.argv[1]).resolve();apk=Path(sys.argv[2]).resolve()
assert hashlib.sha256(jar.read_bytes()).hexdigest()==TOOL_HASH
with tempfile.TemporaryDirectory(prefix='daeo-registry-') as tmp:
    work=Path(tmp)/'decoded'
    subprocess.run(['java','-jar',str(jar),'decode','-r','-f','-o',str(work),str(apk)],check=True)
    smali=work/'smali'
    for relative,key in [('Lc2.smali','11toon'),('eu/kanade/tachiyomi/extension/ko/goodtoonwebtoontest/d.smali','goodtoon')]:
        # Baksmali writes top-level class Lc2; as c2.smali.
        if relative=='Lc2.smali':relative='c2.smali'
        p=smali/relative;s=p.read_text()
        pattern=r'(\.method public getBaseUrl\(\)Ljava/lang/String;\n)(.*?)(\.end method)'
        match=re.search(pattern,s,re.S);assert match
        original=re.sub(r'    \.(?:registers|locals) \d+\n','',match[2],count=1)
        assert 'Ldaeo/Registry;' not in original, 'Start with prepare_selected.py output'
        # The original getters use v0/p0 only. Preserve their exact fallback.
        assert not re.search(r'\bv[1-9]\d*\b',original)
        body='    .locals 2\n\n    const-string v0, "'+key+'"\n    invoke-static {v0}, Ldaeo/Registry;->resolve(Ljava/lang/String;)Ljava/lang/String;\n    move-result-object v0\n    if-eqz v0, :daeo_fallback\n    return-object v0\n    :daeo_fallback\n'+original
        s=s[:match.start(2)]+body+s[match.end(2):];p.write_text(s)
    (smali/'daeo').mkdir();shutil.copyfile(ROOT/'Registry.smali',smali/'daeo/Registry.smali')
    dex=Path(tmp)/'classes.dex'
    subprocess.run(['java','--class-path',str(jar),str(ROOT/'SmaliTools.java'),str(smali),str(dex)],check=True)
    rebuilt=apk.with_name(apk.name+'.rebuilt')
    with zipfile.ZipFile(apk) as src,zipfile.ZipFile(rebuilt,'w') as dst:
        for info in src.infolist():
            payload=dex.read_bytes() if info.filename=='classes.dex' else src.read(info.filename)
            info.extra=b''
            if info.compress_type==zipfile.ZIP_STORED:
                offset=dst.fp.tell()+30+len(info.filename.encode())
                if offset%4:
                    import struct
                    padding=(-offset-4)%4;info.extra=struct.pack('<HH',0xd935,padding)+bytes(padding)
            dst.writestr(info,payload)
    os.replace(rebuilt,apk)
print('11toon / Goodtoon common-registry getters assembled; original fallbacks preserved')

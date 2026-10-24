"""Add phone-side recovery to the pinned TVRoom APK without rebuilding resources.

Inputs: original signed 14.1005, tested Java helper JAR, pinned Apktool, SDK D8.
No signing key is needed; the existing main-only publisher signs the new APK.
"""
from pathlib import Path
import argparse
import hashlib
import re
import shutil
import subprocess
import tempfile
import zipfile
from signed_release import ROOT, patch_version

INPUT_SHA = '1b18360d186558c4f4c8f137fb0cd595fede5e8086a31e41f3ba2a6e9ac8bcc8'
APKTOOL_SHA = 'dbf930b076c6b9be08d57c449cacefc3bdd6b71ebd59b3066fc0e1f5b14f9423'
SOURCE = ROOT/'aniyomi/media/apk/daeotvroom-v14.1005.apk'
OUTPUT = ROOT/'aniyomi/native/tvroom-recovery/build/outputs/apk/tvroom-recovery-unsigned.apk'
HELPER = ROOT/'aniyomi/native/tvroom-recovery/build/libs/tvroom-recovery.jar'

def method(text, signature, body):
    pattern=r'(?m)^\.method '+re.escape(signature)+r'\n.*?^\.end method$'
    result,n=re.subn(pattern,'.method '+signature+'\n'+body.strip()+'\n.end method',text,flags=re.S|re.M)
    if n!=1: raise ValueError('unexpected_method_layout: '+signature)
    return result

def patch_smali(smali):
    p=smali/'qb.smali'; text=p.read_text()
    # Keep raw E() and its fb/r continuation intact. Only the four outer callers
    # use recovery; foreign playback hosts still take the original E() path.
    for signature in ['private final B(Ljava/lang/String;Lkotlin/coroutines/Continuation;)Ljava/lang/Object;',
                      'public getVideoList(Leu/kanade/tachiyomi/animesource/model/SEpisode;Lkotlin/coroutines/Continuation;)Ljava/lang/Object;']:
        pattern=r'(?m)^\.method '+re.escape(signature)+r'\n.*?^\.end method$'
        m=re.search(pattern,text,re.S|re.M)
        if not m: raise ValueError('missing_tvroom_callers')
        old=m.group(); new=old.replace('Lqb;->E(', 'Lqb;->daeoDomainFetch(')
        expected=1 if ' B(' in signature else 3
        if old.count('Lqb;->E(')!=expected: raise ValueError('unexpected_tvroom_call_count')
        text=text[:m.start()]+new+text[m.end():]
    current='''    .locals 2
    new-instance v0, Ldtoon_TvRoomHost;
    const/4 v1, 0x0
    invoke-direct {v0, p0, v1}, Ldtoon_TvRoomHost;-><init>(Lqb;Lkotlin/coroutines/Continuation;)V
    invoke-static {v0}, Ldaeo/tvroom/TvRoomDomain;->currentNative(Ldaeo/tvroom/TvRoomDomain$Host;)Ljava/lang/String;
    move-result-object v0
    return-object v0'''
    text=method(text,'private final S(Lkotlin/coroutines/Continuation;)Ljava/lang/Object;',current)
    text=method(text,'public getBaseUrl()Ljava/lang/String;',current)
    text+='''
.method private final daeoDomainFetch(Ljava/lang/String;Ljava/util/Map;Lkotlin/coroutines/Continuation;)Ljava/lang/Object;
    .locals 2
    invoke-static {p1}, Ldaeo/tvroom/TvRoomDomain;->isSiteRequest(Ljava/lang/String;)Z
    move-result v0
    if-eqz v0, :original
    new-instance v0, Ldtoon_TvRoomHost;
    invoke-direct {v0, p0, p3}, Ldtoon_TvRoomHost;-><init>(Lqb;Lkotlin/coroutines/Continuation;)V
    invoke-static {v0, p1, p2}, Ldaeo/tvroom/TvRoomDomain;->fetchNative(Ldaeo/tvroom/TvRoomDomain$Host;Ljava/lang/String;Ljava/util/Map;)Ljava/lang/Object;
    move-result-object v0
    return-object v0
    :original
    invoke-direct {p0, p1, p2, p3}, Lqb;->E(Ljava/lang/String;Ljava/util/Map;Lkotlin/coroutines/Continuation;)Ljava/lang/Object;
    move-result-object v0
    return-object v0
.end method
.method public daeoPrefs()Landroid/content/SharedPreferences;
    .locals 3
    invoke-direct {p0}, Lqb;->F()Landroid/content/Context;
    move-result-object v0
    const-string v1, "dtoon_tvroom_domains"
    const/4 v2, 0x0
    invoke-virtual {v0, v1, v2}, Landroid/content/Context;->getSharedPreferences(Ljava/lang/String;I)Landroid/content/SharedPreferences;
    move-result-object v0
    return-object v0
.end method
.method public static daeoBase(Ljava/lang/String;)V
    .locals 0
    sput-object p0, Lqb;->p:Ljava/lang/String;
    return-void
.end method
'''
    p.write_text(text)
    # Clone just the existing Cronet coroutine/callback. No new Cronet binary,
    # classloader, executor design, or client fingerprint is introduced.
    fetch=(smali/'xa.smali').read_text().replace('Lxa;', 'Ldtoon_TvRoomFetch;').replace('Lwa;', 'Ldtoon_TvRoomCallback;')
    (smali/'dtoon_TvRoomFetch.smali').write_text(fetch)
    callback=(smali/'wa.smali').read_text().replace('Lwa;', 'Ldtoon_TvRoomCallback;').replace('Lxa;', 'Ldtoon_TvRoomFetch;')
    callback=method(callback,'public d(Lxp;Lbq;Ljava/lang/String;)V','''
    .locals 2
    iget-object v0, p0, Ldtoon_TvRoomCallback;->b:Ljava/lang/String;
    invoke-static {v0, p3}, Ldaeo/tvroom/TvRoomDomain;->allowRedirect(Ljava/lang/String;Ljava/lang/String;)Z
    move-result v0
    if-eqz v0, :reject
    invoke-virtual {p1}, Lxp;->b()V
    return-void
    :reject
    const-string v1, "TVRoom foreign redirect rejected"
    invoke-direct {p0, p1, v1}, Ldtoon_TvRoomCallback;->reject(Lxp;Ljava/lang/String;)V
    return-void''')
    callback=method(callback,'public c(Lxp;Lbq;Ljava/nio/ByteBuffer;)V','''
    .locals 3
    invoke-virtual {p3}, Ljava/nio/ByteBuffer;->flip()Ljava/nio/Buffer;
    invoke-virtual {p3}, Ljava/nio/Buffer;->remaining()I
    move-result v0
    iget-object v1, p0, Ldtoon_TvRoomCallback;->a:Ljava/io/ByteArrayOutputStream;
    invoke-virtual {v1}, Ljava/io/ByteArrayOutputStream;->size()I
    move-result v2
    add-int/2addr v2, v0
    const v1, 0x100000
    if-gt v2, v1, :reject
    new-array v0, v0, [B
    invoke-virtual {p3, v0}, Ljava/nio/ByteBuffer;->get([B)Ljava/nio/ByteBuffer;
    iget-object v1, p0, Ldtoon_TvRoomCallback;->a:Ljava/io/ByteArrayOutputStream;
    invoke-virtual {v1, v0}, Ljava/io/OutputStream;->write([B)V
    invoke-virtual {p3}, Ljava/nio/ByteBuffer;->clear()Ljava/nio/Buffer;
    invoke-virtual {p1, p3}, Lxp;->c(Ljava/nio/ByteBuffer;)V
    return-void
    :reject
    const-string v0, "TVRoom body limit"
    invoke-direct {p0, p1, v0}, Ldtoon_TvRoomCallback;->reject(Lxp;Ljava/lang/String;)V
    return-void''')
    callback+='''
.method private reject(Lxp;Ljava/lang/String;)V
    .locals 4
    iget-object v0, p0, Ldtoon_TvRoomCallback;->c:Ljava/util/concurrent/atomic/AtomicBoolean;
    iget-object v1, p0, Ldtoon_TvRoomCallback;->d:Ljava/util/concurrent/ExecutorService;
    iget-object v2, p0, Ldtoon_TvRoomCallback;->e:Lkotlinx/coroutines/CancellableContinuation;
    new-instance v3, Ljava/io/IOException;
    invoke-direct {v3, p2}, Ljava/io/IOException;-><init>(Ljava/lang/String;)V
    invoke-static {v3}, Lgm;->a(Ljava/lang/Throwable;)Ljava/lang/Object;
    move-result-object v3
    invoke-static {v0, v1, v2, v3}, Ldtoon_TvRoomFetch;->a(Ljava/util/concurrent/atomic/AtomicBoolean;Ljava/util/concurrent/ExecutorService;Lkotlinx/coroutines/CancellableContinuation;Ljava/lang/Object;)V
    invoke-virtual {p1}, Lxp;->a()V
    return-void
.end method
'''
    (smali/'dtoon_TvRoomCallback.smali').write_text(callback)
    for filename in ('NativeHost.smali','NativeContinuation.smali'):
        shutil.copyfile(Path(__file__).parent/'tvroom'/filename,smali/('dtoon_TvRoomHost.smali' if filename=='NativeHost.smali' else 'dtoon_TvRoomContinuation.smali'))

def build(apktool, d8, helper=HELPER, source=SOURCE, output=OUTPUT):
    apktool,helper,source,output=map(Path,(apktool,helper,source,output))
    if hashlib.sha256(apktool.read_bytes()).hexdigest()!=APKTOOL_SHA: raise ValueError('apktool_hash_mismatch')
    if hashlib.sha256(source.read_bytes()).hexdigest()!=INPUT_SHA: raise ValueError('tvroom_input_hash_mismatch')
    def run(*args):subprocess.run(list(map(str,args)),check=True)
    with tempfile.TemporaryDirectory(prefix='tvroom-recovery-') as t:
        t=Path(t);decoded=t/'decoded';hd=t/'helper';hd.mkdir()
        # D8 is the SDK-pinned 35.0.0 tool in CI. Only helper classes enter D8.
        run(d8,'--min-api','24','--output',hd,helper)
        # Decode the helper DEX through a ZIP; no Android resources are rebuilt.
        with zipfile.ZipFile(t/'helper.apk','w') as z:z.write(hd/'classes.dex','classes.dex')
        run('java','-jar',apktool,'decode','-r','-f','-o',t/'helper-decoded',t/'helper.apk')
        run('java','-jar',apktool,'decode','-r','-f','-o',decoded,source)
        shutil.copytree(t/'helper-decoded/smali',decoded/'smali',dirs_exist_ok=True)
        patch_smali(decoded/'smali')
        run('java','-jar',apktool,'build',decoded,'-o',t/'assembled.apk')
        with zipfile.ZipFile(t/'assembled.apk') as a: dex=a.read('classes.dex')
        output.parent.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(source) as src,zipfile.ZipFile(output,'w') as dst:
            for info in src.infolist():
                if info.filename.upper().startswith('META-INF/') and info.filename.upper().endswith(('.SF','.RSA','.DSA','.EC','MANIFEST.MF')):continue
                data=src.read(info.filename)
                if info.filename=='classes.dex':data=dex
                elif info.filename=='AndroidManifest.xml':data=patch_version(data,1005,'14.1005',1006,'14.1006')
                info.extra=b'';dst.writestr(info,data)
    verify_payload(source,output)
    verify_recovery_apk(output,source)
    print('TVRoom recovery unsigned 14.1006 prepared; original APK retained')

def verify_payload(source,output):
    with zipfile.ZipFile(source) as before,zipfile.ZipFile(output) as after:
        if len(after.namelist())!=len(set(after.namelist())):raise ValueError('duplicate_zip_entries')
        keep=lambda n:not(n.upper().startswith('META-INF/') and n.upper().endswith(('.SF','.RSA','.DSA','.EC','MANIFEST.MF')))
        expected={n for n in before.namelist() if keep(n)}
        if set(after.namelist())!=expected:raise ValueError('unexpected_tvroom_payload_entries')
        for name in expected-{'classes.dex','AndroidManifest.xml'}:
            if before.read(name)!=after.read(name):raise ValueError('tvroom_original_payload_changed: '+name)
        if after.read('AndroidManifest.xml')!=patch_version(before.read('AndroidManifest.xml'),1005,'14.1005',1006,'14.1006'):
            raise ValueError('tvroom_manifest_changed')

def verify_recovery_apk(output,source=SOURCE):
    from loguru import logger
    logger.remove()
    from androguard.core.apk import APK
    from androguard.core.dex import DEX
    apk=APK(str(output));original=APK(str(source))
    assert (apk.get_package(),int(apk.get_androidversion_code()),apk.get_androidversion_name())==('eu.kanade.tachiyomi.animeextension.ko.daemedia',1006,'14.1006')
    verify_payload(source,output)
    old=DEX(original.get_dex());dex=DEX(apk.get_dex())
    before={c.get_name():c for c in old.get_classes()};after={c.get_name():c for c in dex.get_classes()}
    assert set(before)<=set(after)
    added=set(after)-set(before)
    assert added and all(n.startswith('Ldaeo/tvroom/') or n in {'Ldtoon_TvRoomHost;','Ldtoon_TvRoomContinuation;','Ldtoon_TvRoomFetch;','Ldtoon_TvRoomCallback;'} for n in added)
    def instructions(c,name):
        return [i.get_output() for m in after[c].get_methods() if m.get_name()==name for i in m.get_instructions() if i.get_name()!='nop']
    assert any('currentNative' in s for s in instructions('Lqb;','S'))
    assert any('currentNative' in s for s in instructions('Lqb;','getBaseUrl'))
    assert sum('daeoDomainFetch' in s for s in instructions('Lqb;','B'))==1
    assert sum('daeoDomainFetch' in s for s in instructions('Lqb;','getVideoList'))==3
    assert any('isSiteRequest' in s for s in instructions('Lqb;','daeoDomainFetch'))
    assert any('Lqb;->E(' in s for s in instructions('Lqb;','daeoDomainFetch'))
    assert any('TimeoutKt;->withTimeout' in s for s in instructions('Ldtoon_TvRoomHost;','raw'))
    assert any('allowRedirect' in s for s in instructions('Ldtoon_TvRoomCallback;','d'))
    assert any('ByteArrayOutputStream;->size' in s for s in instructions('Ldtoon_TvRoomCallback;','c'))
    # Registration, name/ID inputs, existing client, session and HLS code must be
    # instruction-identical after assembly. Ignore assembler alignment nops.
    changed={'S','getBaseUrl','B','getVideoList'}
    for descriptor,clazz in before.items():
        actual={(m.get_name(),m.get_descriptor()):m for m in after[descriptor].get_methods()}
        for m in clazz.get_methods():
            if descriptor=='Lqb;' and m.get_name() in changed:continue
            n=actual[(m.get_name(),m.get_descriptor())]
            ops=lambda method:[(i.get_name(),i.get_output()) for i in method.get_instructions() if i.get_name()!='nop']
            assert ops(m)==ops(n),(descriptor,m.get_name(),'unapproved_original_method_change')
    assert 'dtoon_tvroom_domains' in dex.get_strings() and 'auto_domain' in dex.get_strings()
    print('TVRoom DEX: hooks, bounded original Cronet, factory and every unchanged original method PASS')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--apktool',required=True);parser.add_argument('--d8',required=True)
    args=parser.parse_args();build(args.apktool,args.d8)

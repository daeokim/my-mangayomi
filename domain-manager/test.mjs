import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import worker,{PROFILES,normalize,assess,probe,seedState,scanState,mergeScan,commitState,runCheck,ADMIN_PAGE} from './worker.mjs';
if (!globalThis.crypto) globalThis.crypto=webcrypto;
const clone=v=>JSON.parse(JSON.stringify(v));
const fixtures={
 '11toon':'<title>11toon 만화</title><a href="/bbs/board.php?bo_table=toons&is=123">작품</a>',
 blacktoon:'<title>블랙툰 Blacktoon</title><script>inc_url2 + "/webtoon_0.js"</script>',
 goodtoon:'<title>Goodtoon 굿툰</title><a class="card" href="/manga/a/">작품</a>',
 tvwiki:'<title>TVWiki 티비위키</title><a href="/drama/123">작품</a>',
 tvroom:'<title>TVRoom 티비룸</title><div class="v-item"><a class="v-item-hitarea" href="/video/abc" aria-label="작품"></a><div><img data-src="/cover.jpg"></div></div>',
 ani24:'<title>애니24 ohli24</title><div class="show-item"><a href="/123/test.html">작품</a></div>',
 anilife:JSON.stringify({items:[{id:'42',title:'작품',image:'/anime_uploads/42.jpg'}],pagination:{pages:1}})
};
const now='2026-10-13T12:00:00.000Z';
function originReply(url){const u=new URL(url);if(u.hostname==='wankyo83.github.io')return new Response(JSON.stringify({domains:{}}));const key=Object.keys(PROFILES).find(k=>PROFILES[k].pattern.test(u.hostname));if(!key)return new Response('unavailable',{status:404});return new Response(u.pathname==='/data/config.js'?"var inc_url = 'https://data.example/'; var img_domain = 'https://img.example/';":fixtures[key]);}
for(const [key,p] of Object.entries(PROFILES)) {
 test(key+' accepts its HTTPS host and rejects other hosts/credentials/paths',()=>{assert.equal(normalize(key,p.seed),p.seed);for(const bad of ['http://'+new URL(p.seed).host,'https://evil.invalid','https://user@'+new URL(p.seed).host,p.seed+'/other',p.seed+'?q=1',p.seed+'#x',p.seed+':8443'])assert.equal(normalize(key,bad),'');});
 test(key+' validates site identity AND content structure',()=>{assert.equal(assess(key,fixtures[key],200),'');assert.ok(assess(key,'<title>'+key+'</title>',200));assert.ok(assess(key,fixtures[key]+'<div class="cf-chl-container">',200));assert.ok(assess(key,fixtures[key],403));});
}
test('rejects stale automatic domains but allows explicit older overrides',()=>{assert.equal(normalize('blacktoon','https://blacktoon423.com'),'');assert.equal(normalize('tvwiki','https://tvwiki52.net'),'');assert.equal(normalize('goodtoon','https://goodtoon006.com'),'');assert.equal(normalize('tvwiki','https://tvwiki52.net',0),'https://tvwiki52.net');});
test('all failures preserve last known addresses and confirmation times',async()=>{const initial=seedState();initial.domains.tvwiki.lastConfirmedAt='2026-10-12T00:00:00Z';const next=await scanState(initial,async()=>new Response('challenge-platform',{status:200}),now);for(const key of Object.keys(PROFILES)){assert.equal(next.domains[key].baseUrl,initial.domains[key].baseUrl);assert.equal(next.domains[key].status,'protected');assert.equal(next.domains[key].scanOffset,2);}assert.equal(next.domains.tvwiki.lastConfirmedAt,initial.domains.tvwiki.lastConfirmedAt);});
test('higher upstream domain requires validation and old upstream never regresses',async()=>{const initial=seedState(),seen=[];const io=async url=>{seen.push(url);if(new URL(url).hostname==='wankyo83.github.io')return new Response(JSON.stringify({domains:{blacktoon:{baseUrl:'https://blacktoon423.com'},tvwiki:{baseUrl:'https://tvwiki54.net'}}}));return originReply(url)};const next=await scanState(initial,io,now);assert.equal(next.domains.blacktoon.baseUrl,'https://blacktoon424.com');assert.equal(next.domains.tvwiki.baseUrl,'https://tvwiki54.net');assert.ok(!seen.some(u=>u.includes('blacktoon423')));});
test('future domain with challenge is skipped and working old domain remains',async()=>{const next=await scanState(seedState(),async url=>new URL(url).hostname==='wankyo83.github.io'?new Response(JSON.stringify({domains:{tvwiki:{baseUrl:'https://tvwiki54.net'}}})):url.includes('tvwiki54')?new Response('Just a moment'):originReply(url),now);assert.equal(next.domains.tvwiki.baseUrl,'https://tvwiki53.net');assert.equal(next.domains.tvwiki.status,'healthy');});
test('rotates next +1 to +10 candidates across failed checks with padding',async()=>{let state=seedState();const seen=[];for(let i=0;i<11;i++)state=await scanState(state,async url=>{seen.push(url);return new Response('down',{status:503})},now);const hosts=seen.filter(u=>u.includes('goodtoon')).map(u=>new URL(u).host);assert.ok(hosts.includes('goodtoon008.com'));assert.ok(hosts.includes('goodtoon017.com'));assert.ok(!hosts.includes('goodtoon018.com'));});
test('manual pin stops scanning/upstream replacement',async()=>{const state=seedState();state.control.overrides.tvwiki='https://tvwiki52.net';const seen=[];const next=await scanState(state,async url=>{seen.push(url);return originReply(url)},now);assert.equal(next.domains.tvwiki.baseUrl,'https://tvwiki52.net');assert.ok(!seen.some(u=>u.includes('tvwiki53')||u.includes('tvwiki54')));});
test('redirect to another site or embedded credentials is rejected without contacting it',async()=>{for(const target of ['https://evil.invalid/','https://secret@tvwiki54.net/']){let calls=0;const result=await probe('tvwiki','https://tvwiki53.net',async()=>{calls++;return new Response('',{status:302,headers:{Location:target}})});assert.equal(result.ok,false);assert.equal(calls,1);}});
test('same-site next-domain redirect is accepted only after content validation',async()=>{let calls=0;const result=await probe('tvwiki','https://tvwiki53.net',async url=>{calls++;return url.includes('tvwiki53')?new Response('',{status:302,headers:{Location:'https://tvwiki54.net/drama'}}):originReply(url)});assert.equal(result.baseUrl,'https://tvwiki54.net');assert.equal(calls,2);});
test('blacktoon data configuration is required as well as home page',async()=>{const result=await probe('blacktoon','https://blacktoon424.com',async url=>url.endsWith('/data/config.js')?new Response('<html>blacktoon</html>'):originReply(url));assert.equal(result.ok,false);assert.match(result.reason,/데이터/);});
test('oversized responses and request budgets stop without adoption',async()=>{assert.equal((await probe('tvwiki','https://tvwiki53.net',async()=>new Response('x'.repeat(270000)))).ok,false);let requests=0;const result=await probe('tvwiki','https://tvwiki53.net',async()=>{requests++;return originReply('https://tvwiki53.net/drama')},{used:36});assert.equal(result.ok,false);assert.equal(requests,0);});
test('operator changes and newer scans cannot be overwritten by an old scan',()=>{const initial=seedState(),scanned=clone(initial);scanned.lastRunAt=now;const latest=clone(initial);latest.control.revision=1;latest.control.overrides.tvwiki='https://tvwiki55.net';assert.equal(mergeScan(latest,initial,scanned),latest);const newer=clone(initial);newer.lastRunAt='2026-10-14T00:00:00Z';for(const d of Object.values(newer.domains))d.lastCheckedAt=newer.lastRunAt;assert.equal(mergeScan(newer,initial,scanned),newer);});
function repoIO(initial,conflict=false){let state=clone(initial),sha='sha1',writes=0;const io=async(url,options)=>{if(url.startsWith('https://api.github.com/')){if(options.method==='PUT'){const input=JSON.parse(options.body);writes++;assert.equal(input.sha,sha);if(conflict&&writes===1){state.control.revision++;state.control.overrides.tvwiki='https://tvwiki55.net';sha='sha2';return new Response('{}',{status:409});}state=JSON.parse(Buffer.from(input.content,'base64').toString('utf8'));sha='sha'+(writes+1);return new Response('{}',{status:200});}return new Response(JSON.stringify({sha,content:Buffer.from(JSON.stringify(state)).toString('base64')}));}return originReply(url)};return {io,state:()=>state,writes:()=>writes};}
const env={GITHUB_TOKEN:'test-only-repo-token',ADMIN_TOKEN:'test-only-admin-key-long-enough'};
test('inherited object keys are not accepted as sites',()=>{for(const key of ['__proto__','constructor','toString'])assert.equal(normalize(key,'https://tvwiki53.net'),'');});
test('full check stores validated JSON as UTF-8 through GitHub with optimistic SHA',async()=>{const repo=repoIO(seedState());const result=await runCheck(env,repo.io);assert.equal(repo.writes(),1);for(const d of Object.values(result.state.domains))assert.equal(d.status,'healthy');assert.match(repo.state().domains.tvwiki.reason,/목록/);});
test('GitHub conflict re-reads state and preserves a concurrent operator pin',async()=>{const repo=repoIO(seedState(),true);const result=await runCheck(env,repo.io);assert.equal(result.skipped,true);assert.equal(repo.state().control.overrides.tvwiki,'https://tvwiki55.net');assert.equal(repo.writes(),1);});
test('repeated check within a minute performs no writes or site probes',async()=>{const state=seedState();state.lastRunAt=new Date().toISOString();for(const d of Object.values(state.domains))d.lastCheckedAt=state.lastRunAt;const repo=repoIO(state);const result=await runCheck(env,repo.io);assert.equal(result.skipped,true);assert.equal(repo.writes(),0);});
test('write permission failure is an error, never a successful publication',async()=>{await assert.rejects(commitState(env,{sha:'sha1'},seedState(),async()=>new Response('{}',{status:403})),/github_write_403/);});
test('missing/wrong keys cannot run checks or change addresses',async()=>{for(const path of ['/api/check','/api/override']){assert.equal((await worker.fetch(new Request('https://manager.example'+path,{method:'POST'}),env)).status,401);assert.equal((await worker.fetch(new Request('https://manager.example'+path,{method:'POST',headers:{Authorization:'Bearer wrong'}}),env)).status,401);}assert.equal((await worker.fetch(new Request('https://manager.example/api/check',{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_TOKEN,Origin:'https://evil.invalid'}}),env)).status,403);});
test('mobile admin never embeds secrets and renders registry data as text',async()=>{const res=await worker.fetch(new Request('https://manager.example/admin'),env);assert.equal(res.status,200);assert.ok(res.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));assert.ok(!ADMIN_PAGE.includes(env.ADMIN_TOKEN));assert.ok(!ADMIN_PAGE.includes('localStorage'));assert.ok(!ADMIN_PAGE.includes('innerHTML'));assert.ok(ADMIN_PAGE.includes('viewport'));});

test("partial scan does not overwrite another source updated during checks",async()=>{const initial=seedState(),scanned=await scanState(initial,originReply,now,["tvwiki"]),latest=clone(initial);latest.domains.blacktoon.baseUrl="https://blacktoon425.com";latest.domains.blacktoon.lastCheckedAt="2026-10-13T11:59:00Z";const merged=mergeScan(latest,initial,scanned);assert.equal(merged.domains.blacktoon.baseUrl,"https://blacktoon425.com");assert.equal(merged.domains.tvwiki.status,"healthy");});
test("one-source check does not probe other sites",async()=>{const seen=[];const next=await scanState(seedState(),async url=>{seen.push(url);return originReply(url)},now,["tvwiki"]);assert.equal(next.domains.tvwiki.status,"healthy");assert.equal(next.domains.blacktoon.status,"unverified");assert.ok(!seen.some(u=>u.includes("blacktoon")));});

test('TVRoom requires a titled work link and image in the same real card',()=>{
  const valid=fixtures.tvroom;
  for(const invalid of [
    '<title>티비룸</title><nav><a href="/video/영화">영화</a></nav>',
    valid.replace('/video/abc','/video/%EC%98%81%ED%99%94'),
    valid.replace(' aria-label="작품"',''),
    valid.replace('<img data-src="/cover.jpg">',''),
    valid.replace('/video/abc','https://evil.invalid/video/abc'),
    '<title>티비룸</title><!--'+valid+'-->',
    '<title>티비룸</title><script>'+valid+'</script>',
    valid.replace('<div><img','</div><div><img'),
  ]) assert.equal(assess('tvroom',invalid,200),'목록 구조 미확인');
  assert.equal(assess('tvroom',valid.replace('class="v-item"',"class='tile v-item'").replace('/video/abc','https://tvroom40.org/video/abc'),200),'');
});
test('current address failure is preserved separately from later candidate failures',async()=>{
  const initial=seedState();
  const next=await scanState(initial,async url=>url.includes('tvroom38.org')?new Response('blocked',{status:403}):new Response('<title>티비룸</title>'),now,['tvroom'],2);
  const d=next.domains.tvroom;
  assert.equal(d.reason,'HTTP 403');
  assert.equal(d.currentCheck.reason,'HTTP 403');
  assert.equal(d.currentCheck.checked,true);
  assert.equal(d.attempts.length,3);
  assert.equal(d.attempts[1].reason,'목록 구조 미확인');
  assert.equal(d.attempts[2].baseUrl,'https://tvroom40.org');
  assert.equal(d.consecutiveFailures,1);
});
test('consecutive failures count scans, preserve confirmation and reset on recovery',async()=>{
  let state=seedState();state.domains.tvroom.lastConfirmedAt='2026-10-12T00:00:00Z';
  for(let count=1;count<=2;count++){
    state=await scanState(state,async()=>new Response('down',{status:503}),now,['tvroom'],10);
    assert.equal(state.domains.tvroom.consecutiveFailures,count);
    assert.equal(state.domains.tvroom.lastConfirmedAt,'2026-10-12T00:00:00Z');
    assert.equal(state.domains.tvwiki.consecutiveFailures,undefined);
  }
  state=await scanState(state,originReply,now,['tvroom'],10);
  assert.equal(state.domains.tvroom.consecutiveFailures,0);
  assert.equal(state.domains.tvroom.lastConfirmedAt,now);
  assert.equal(state.domains.tvroom.attempts.length,1);
});
test('a successful upstream candidate does not fabricate an old-address check',async()=>{
  const next=await scanState(seedState(),async url=>url.includes('github.io')?new Response(JSON.stringify({domains:{tvroom:{baseUrl:'https://tvroom40.org'}}})):originReply(url),now,['tvroom']);
  assert.equal(next.domains.tvroom.baseUrl,'https://tvroom40.org');
  assert.equal(next.domains.tvroom.currentCheck.checked,false);
  assert.equal(next.domains.tvroom.currentCheck.baseUrl,'https://tvroom38.org');
  assert.equal(next.domains.tvroom.attempts.length,1);
});

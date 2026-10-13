import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seedState,scanState,PROFILES,runCheck} from './worker.mjs';
import {selectedKeys,renderSummary,runActions} from './actions.mjs';

const now='2026-10-13T15:00:00.000Z';
const fixture='<title>TVWiki 티비위키</title><a href="/drama/123">작품</a>';
test('daily check discovers a jump of ten numbers in one run',async()=>{
  const seen=[]; const next=await scanState(seedState(),async url=>{seen.push(url);return new Response(url.includes('tvwiki63.net')?fixture:'unavailable',{status:url.includes('tvwiki63.net')?200:503});},now,['tvwiki'],10);
  assert.equal(next.domains.tvwiki.baseUrl,'https://tvwiki63.net');
  assert.equal(next.domains.tvwiki.status,'healthy');
  assert.ok(seen.some(url=>url.includes('tvwiki54.net')));
  assert.ok(!seen.some(url=>url.includes('tvwiki64.net')));
});
test('daily check preserves known address and confirmation time on all failures',async()=>{
  const state=seedState();state.domains.tvwiki.lastConfirmedAt='2026-10-12T00:00:00Z';
  const next=await scanState(state,async()=>new Response('Just a moment'),now,['tvwiki'],10);
  assert.equal(next.domains.tvwiki.baseUrl,state.domains.tvwiki.baseUrl);
  assert.equal(next.domains.tvwiki.lastConfirmedAt,state.domains.tvwiki.lastConfirmedAt);
  assert.equal(next.domains.tvwiki.status,'protected');
});
test('daily scan never overrides a manual pin even with a broad candidate window',async()=>{
  const state=seedState();state.control.overrides.tvwiki='https://tvwiki52.net';const seen=[];
  const next=await scanState(state,async url=>{seen.push(url);return new Response(fixture);},now,['tvwiki'],10);
  assert.equal(next.domains.tvwiki.baseUrl,'https://tvwiki52.net');
  assert.equal(seen.filter(url=>new URL(url).hostname.startsWith('tvwiki')).length,1);
});
test('daily runner gives each source an independent request budget',async()=>{
  let state=seedState(), writes=0; const seen=[];
  const io=async(url,options)=>{seen.push(url);if(url.startsWith('https://api.github.com/')){
    if(options.method==='PUT'){state=JSON.parse(Buffer.from(JSON.parse(options.body).content,'base64'));writes++;return new Response('{}');}
    return new Response(JSON.stringify({sha:'original',content:Buffer.from(JSON.stringify(state)).toString('base64')}));
  }return new Response('unavailable',{status:503});};
  const result=await runCheck({GITHUB_TOKEN:'test-only'},io,Object.keys(PROFILES),10);
  assert.equal(writes,1);
  for(const [key,p] of Object.entries(PROFILES)){
    assert.equal(result.state.domains[key].status,'protected');
    assert.ok(seen.filter(url=>p.pattern.test(new URL(url).hostname)).length>=11,key);
  }
});
test('invalid sites and unbounded scans are rejected before network access',async()=>{
  for(const key of ['__proto__','constructor','invalid'])assert.throws(()=>selectedKeys(key),/unknown_site/);
  for(const size of [0,11,1.5])await assert.rejects(scanState(seedState(),async()=>{throw new Error('should not fetch');},now,['tvwiki'],size),/scan_options/);
});
test('summary distinguishes publication from site availability and escapes injected markup',()=>{
  const state=seedState();state.domains.tvwiki.reason='<script>|\nfailure';
  const text=renderSummary({state,skipped:false},['tvwiki']);
  assert.ok(text.includes('확인 실패 · 기존 주소 유지'));
  assert.ok(text.includes('&lt;script&gt;  failure'));
  assert.ok(!text.includes('<script>'));
  assert.ok(text.includes('재생 성공을 뜻하지 않습니다'));
});
test('runner requires a GitHub token and propagates publication failure',async()=>{
  await assert.rejects(runActions({},async()=>{throw new Error('no fetch');}),/github_secret_missing/);
  await assert.rejects(runActions({GITHUB_TOKEN:'test-only'},async()=>new Response('{}',{status:403})),/github_read_403/);
});

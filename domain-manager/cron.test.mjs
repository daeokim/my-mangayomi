import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker, {PROFILES, seedState, scheduledKey, runScheduled, freeFetch, FREE_FETCH_LIMIT, scanCandidate, domainNumber} from './worker.mjs';
import {runActions, checkBackend} from './actions.mjs';

test('ten-minute cron covers every site in seventy minutes', async()=>{
  const config=JSON.parse(await readFile(new URL('./wrangler.jsonc',import.meta.url),'utf8'));
  assert.deepEqual(config.triggers.crons,['*/10 * * * *']);
  const keys=Array.from({length:7},(_,i)=>scheduledKey(i*600000));
  assert.deepEqual(keys,Object.keys(PROFILES));
  assert.equal(scheduledKey(7*600000),keys[0]);
  for(const time of [-1,NaN,Infinity]) assert.throws(()=>scheduledKey(time),/scheduled_time/);
});

test('Free invocation refuses a hidden redirect and stops before the 51st fetch',async()=>{
  let calls=0;const io=freeFetch(async()=>{calls++;return new Response('ok');});
  // workerd rejects redirect:'error' with a TypeError, so it must never reach a Worker fetch.
  for(const redirect of ['follow','error',undefined])await assert.rejects(io('https://test.invalid',{redirect}),/automatic_redirects_forbidden/);
  for(let i=0;i<FREE_FETCH_LIMIT;i++)await io('https://test.invalid',{redirect:'manual'});
  await assert.rejects(io('https://test.invalid',{redirect:'manual'}),/free_subrequest_limit/);
  assert.equal(calls,50);
});

test('every cron slot counts redirect hops and GitHub conflict retries within Free limit',async()=>{
  for(const [slot,key] of Object.keys(PROFILES).entries()) {
    const initial=seedState();let total=0,writes=0;const attempts=[];
    const io=async(url,options)=>{
      total++;assert.equal(options.redirect,'manual');
      if(url.startsWith('https://api.github.com/')) {
        if(options.method==='PUT') {
          writes++;attempts.push(JSON.parse(Buffer.from(JSON.parse(options.body).content,'base64')).domains[key].attempts);
          return new Response('{}',{status:writes<3?409:200});
        }
        return new Response(JSON.stringify({sha:'snapshot',content:Buffer.from(JSON.stringify(initial)).toString('base64')}));
      }
      if(url.includes('tokki-traffic-light'))return new Response(JSON.stringify({domains:{[key]:{baseUrl:initial.domains[key].baseUrl}}}));
      // Exhaust all three allowed hops for every candidate without adopting it.
      return new Response('',{status:302,headers:{Location:url}});
    };
    await runScheduled({scheduledTime:slot*600000},{GITHUB_TOKEN:'test-only'},io);
    assert.equal(writes,3);assert.ok(total<=FREE_FETCH_LIMIT,`${key}: ${total}`);
    assert.ok(attempts.every(a=>a.length<=3));
  }
});
test('Cloudflare ownership prevents Actions site probes and registry writes',async()=>{
  let calls=0;
  const result=await runActions({DOMAIN_CHECK_BACKEND:'cloudflare'},async()=>{calls++;throw Error('no IO permitted');});
  assert.equal(calls,0);assert.deepEqual(result,{skipped:true,backend:'cloudflare'});
  assert.equal(checkBackend(),'actions');
  await assert.rejects(runActions({DOMAIN_CHECK_BACKEND:'typo'},async()=>{throw Error('no IO');}),/unknown_domain_check_backend/);
});
test('scheduled worker checks one site and keeps 403 protected without advancing confirmation',async()=>{
  const initial=seedState();const key='goodtoon';const last='2026-10-01T00:00:00Z';
  initial.domains[key].lastConfirmedAt=last;let saved,siteCalls=[];
  const io=async(url,options)=>{
    if(url.startsWith('https://api.github.com/')){
      if(options.method==='PUT'){
        saved=JSON.parse(Buffer.from(JSON.parse(options.body).content,'base64'));return new Response('{}');
      }
      return new Response(JSON.stringify({sha:'snapshot',content:Buffer.from(JSON.stringify(initial)).toString('base64')}));
    }
    siteCalls.push(url);return new Response('unavailable',{status:403});
  };
  const slot=Object.keys(PROFILES).indexOf(key);
  await runScheduled({scheduledTime:slot*600000},{GITHUB_TOKEN:'test-only'},io);
  assert.equal(saved.domains.goodtoon.status,'protected');
  assert.equal(saved.domains.goodtoon.lastConfirmedAt,last);
  for(const other of Object.keys(PROFILES).filter(k=>k!==key))assert.deepEqual(saved.domains[other],initial.domains[other]);
  assert.ok(siteCalls.every(url=>url.includes('goodtoon')||url.includes('tokki-traffic-light')));
});

const catalog=JSON.stringify({items:[{id:'42',title:'작품',image:'/cover.jpg'}],pagination:{pages:1}});
const clone=value=>JSON.parse(JSON.stringify(value));
const workerEnv={GITHUB_TOKEN:'test-only-worker-secret',GITHUB_REPOSITORY:'daeokim/my-mangayomi',GITHUB_BRANCH:'main'};
const lifeEvent={scheduledTime:Object.keys(PROFILES).indexOf('anilife')*600000};
const snapshot=(state,sha)=>new Response(JSON.stringify({sha,content:Buffer.from(JSON.stringify(state)).toString('base64')}));

test('numbered discovery preserves padding and handles digit-width changes',()=>{
  for(const [key,base,expected] of [
    ['11toon','https://11toon.com','https://11toon1.com'],
    ['goodtoon','https://goodtoon009.com','https://goodtoon010.com'],
    ['anilife','https://anilife09.tv','https://anilife10.tv'],
    ['tvroom','https://tvroom99.org','https://tvroom100.org'],
    ['ani24','https://www.ohli24.net','https://ohli25.net'],
  ]) {
    assert.equal(scanCandidate(key,base,1),expected);
    assert.equal(domainNumber(key,expected),domainNumber(key,base)+1);
  }
});

test('cron stores only a validated candidate and sends the GitHub secret only to GitHub',async()=>{
  const initial=seedState();let saved;
  const seen=[];
  const io=async(url,options)=>{
    seen.push(url);
    const auth=new Headers(options.headers).get('Authorization');
    if(url.startsWith('https://api.github.com/')) {
      assert.equal(auth,'Bearer '+workerEnv.GITHUB_TOKEN);
      if(options.method==='PUT') {
        const input=JSON.parse(options.body);
        assert.equal(input.sha,'initial-sha');assert.equal(input.branch,'main');
        saved=JSON.parse(Buffer.from(input.content,'base64').toString('utf8'));
        return new Response('{}',{status:201});
      }
      assert.ok(url.endsWith('?ref=main'));
      return snapshot(initial,'initial-sha');
    }
    assert.equal(auth,null);
    assert.ok(!JSON.stringify(options).includes(workerEnv.GITHUB_TOKEN));
    if(url.includes('tokki-traffic-light'))return new Response(JSON.stringify({domains:{anilife:{baseUrl:'https://anilife03.tv'}}}));
    // A branded landing page alone must not be adopted as the source.
    if(url.includes('anilife03.tv'))return new Response('<title>애니라이프</title>');
    if(url.includes('anilife01.tv'))return new Response('blocked',{status:403});
    assert.ok(url.startsWith('https://anilife02.tv/api/anime?'));
    return new Response(catalog);
  };
  const result=await runScheduled(lifeEvent,workerEnv,io);
  assert.equal(result.skipped,false);assert.equal(saved.schemaVersion,1);
  assert.deepEqual(saved.control,initial.control);
  assert.equal(saved.domains.anilife.baseUrl,'https://anilife02.tv');
  assert.equal(saved.domains.anilife.status,'healthy');
  assert.equal(saved.domains.anilife.lastCheckedAt,saved.domains.anilife.lastConfirmedAt);
  assert.match(saved.domains.anilife.reason,/목록 구조 확인/);
  for(const key of Object.keys(PROFILES).filter(k=>k!=='anilife'))assert.deepEqual(saved.domains[key],initial.domains[key]);
  assert.ok(seen.length<=FREE_FETCH_LIMIT);
});

test('cron retries Actions SHA conflicts without rescanning or overwriting unrelated domains',async()=>{
  for(const status of [409,422]) {
    const initial=seedState(),latest=clone(initial);let reads=0,writes=0,probes=0,saved;
    latest.domains.goodtoon.baseUrl='https://goodtoon008.com';
    latest.domains.goodtoon.lastCheckedAt='2026-10-23T00:00:00.000Z';
    const io=async(url,options)=>{
      if(url.startsWith('https://api.github.com/')) {
        if(options.method==='PUT') {
          const input=JSON.parse(options.body);writes++;
          assert.equal(input.sha,writes===1?'old-sha':'actions-sha');
          if(writes===1)return new Response('{}',{status});
          saved=JSON.parse(Buffer.from(input.content,'base64').toString('utf8'));
          return new Response('{}',{status:201});
        }
        return ++reads===1?snapshot(initial,'old-sha'):snapshot(latest,'actions-sha');
      }
      if(url.includes('tokki-traffic-light'))return new Response('{"domains":{}}');
      probes++;return new Response(catalog);
    };
    await runScheduled(lifeEvent,workerEnv,io);
    assert.equal(reads,2);assert.equal(writes,2);assert.equal(probes,1);
    assert.deepEqual(saved.domains.goodtoon,latest.domains.goodtoon);
    assert.equal(saved.domains.anilife.status,'healthy');
  }
});

test('cron abandons its scan when an operator revision or newer same-site check wins',async()=>{
  for(const winner of ['operator','newer-scan']) {
    const initial=seedState(),latest=clone(initial);let reads=0,writes=0;
    if(winner==='operator') {
      latest.control.revision++;latest.control.overrides.anilife='https://anilife05.tv';
    } else {
      latest.domains.anilife.baseUrl='https://anilife06.tv';
      latest.domains.anilife.lastCheckedAt='9999-01-01T00:00:00.000Z';
      latest.lastRunAt=latest.domains.anilife.lastCheckedAt;
    }
    const io=async(url,options)=>{
      if(url.startsWith('https://api.github.com/')) {
        if(options.method==='PUT') {writes++;return new Response('{}',{status:409});}
        return ++reads===1?snapshot(initial,'old-sha'):snapshot(latest,'new-sha');
      }
      return new Response(url.includes('tokki-traffic-light')?'{"domains":{}}':catalog);
    };
    const result=await runScheduled(lifeEvent,workerEnv,io);
    assert.equal(result.skipped,true);assert.equal(writes,1);assert.deepEqual(result.state,latest);
  }
});

test('cron reports missing credentials, denied writes and exhausted conflicts as errors',async()=>{
  let calls=0;
  await assert.rejects(runScheduled(lifeEvent,{},async()=>{calls++;throw Error('unexpected IO');}),/github_secret_missing/);
  assert.equal(calls,0);
  for(const status of [403,409]) {
    let writes=0;
    const io=async(url,options)=>{
      if(url.startsWith('https://api.github.com/')) {
        if(options.method==='PUT') {writes++;return new Response('{}',{status});}
        return snapshot(seedState(),'unchanged-sha');
      }
      return new Response(url.includes('tokki-traffic-light')?'{"domains":{}}':catalog);
    };
    await assert.rejects(runScheduled(lifeEvent,workerEnv,io),status===403?/github_write_403/:/concurrent_update_retry/);
    assert.equal(writes,status===403?1:3);
  }
});

test('GitHub redirects are never followed and fail the run explicitly',async()=>{
  for(const method of ['GET','PUT']) {
    let calls=0;
    const io=async(url,options)=>{
      calls++;assert.equal(options.redirect,'manual');
      if(url.startsWith('https://api.github.com/')) {
        if((options.method||'GET')===method)return new Response('',{status:301,headers:{Location:'https://api.github.com/repositories/1/contents/domains.json'}});
        return snapshot(seedState(),'initial-sha');
      }
      return new Response(url.includes('tokki-traffic-light')?'{"domains":{}}':catalog);
    };
    await assert.rejects(runScheduled(lifeEvent,workerEnv,io),method==='GET'?/github_read_301/:/github_write_301/);
    assert.ok(calls<=FREE_FETCH_LIMIT);
  }
});

test('default scheduled handler awaits publication and propagates failure',async t=>{
  let writes=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(url.startsWith('https://api.github.com/')) {
      if(options.method==='PUT') {writes++;return new Response('{}',{status:403});}
      return snapshot(seedState(),'initial-sha');
    }
    return new Response(url.includes('tokki-traffic-light')?'{"domains":{}}':catalog);
  });
  await assert.rejects(worker.scheduled(lifeEvent,workerEnv),/github_write_403/);
  assert.equal(writes,1);
});

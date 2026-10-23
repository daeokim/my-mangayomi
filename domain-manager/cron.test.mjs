import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PROFILES, seedState, scheduledKey, runScheduled} from './worker.mjs';
import {runActions, checkBackend} from './actions.mjs';

test('ten-minute cron covers every site in seventy minutes', async()=>{
  const config=JSON.parse(await readFile(new URL('./wrangler.jsonc',import.meta.url),'utf8'));
  assert.deepEqual(config.triggers.crons,['*/10 * * * *']);
  const keys=Array.from({length:7},(_,i)=>scheduledKey(i*600000));
  assert.deepEqual(keys,Object.keys(PROFILES));
  assert.equal(scheduledKey(7*600000),keys[0]);
  for(const time of [-1,NaN,Infinity]) assert.throws(()=>scheduledKey(time),/scheduled_time/);
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

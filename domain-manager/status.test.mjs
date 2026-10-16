import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {checkNotice,siteDetails,elapsed,failureCount} from './status.mjs';
import {seedState} from './worker.mjs';

const now=Date.parse('2026-10-15T06:00:00Z');
test('status handles old registries, elapsed time and the 12-hour missed-check boundary',()=>{
  assert.equal(failureCount({}),'집계 전');
  assert.equal(failureCount({consecutiveFailures:0}),'0회');
  assert.equal(failureCount({consecutiveFailures:3}),'3회');
  assert.equal(failureCount({consecutiveFailures:-1}),'집계 전');
  assert.equal(elapsed(null,now),'기록 없음');
  assert.equal(elapsed('invalid',now),'기록 없음');
  assert.equal(elapsed('2026-10-15T07:00:00Z',now),'시각 확인 필요');
  assert.equal(elapsed('2026-10-14T04:30:00Z',now),'1일 1시간');
  assert.equal(checkNotice({lastRunAt:'2026-10-14T18:00:01Z'},now).stale,false);
  assert.equal(checkNotice({lastRunAt:'2026-10-14T18:00:00Z'},now).stale,true);
  assert.equal(checkNotice({lastRunAt:null},now).stale,true);
  assert.equal(checkNotice({lastRunAt:'2026-10-15T07:00:00Z'},now).stale,true);
  assert.match(siteDetails({lastConfirmedAt:'2026-10-15T05:00:00Z',consecutiveFailures:2},now),/정상 확인 후 경과: 1시간 0분/);
});

class Element {
  constructor(tag){this.tag=tag;this.children=[];this.textContent='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  addEventListener(){}
  get text(){return this.textContent+this.children.map(child=>child.text).join('\n');}
  set innerHTML(value){throw new Error('Unsafe HTML rendering: '+value);}
}
test('mobile status renders legacy records and separate candidate diagnostics as text',async()=>{
  const state=seedState();state.lastRunAt=new Date(now).toISOString();
  state.domains.tvroom={...state.domains.tvroom,status:'protected',consecutiveFailures:2,lastConfirmedAt:'2026-10-15T05:00:00Z',reason:'HTTP 403',
    currentCheck:{baseUrl:'https://tvroom38.org',checked:true,reason:'HTTP 403'},
    attempts:[{baseUrl:'https://tvroom38.org',ok:false,reason:'HTTP 403'},
      {baseUrl:'https://tvroom39.org',ok:false,reason:'<script>alert(1)</script>'}]};
  const elements=Object.fromEntries(['refresh','last','cards'].map(id=>[id,new Element(id)]));
  const document={getElementById:id=>elements[id],createElement:tag=>new Element(tag)};
  const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
  let code=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  code=code.replace(/^import[^\n]+\n/m,'').replace('refresh();','');
  const context=vm.createContext({document,URL,AbortSignal,checkNotice,siteDetails,
    Date:class extends Date{static now(){return now;}},fetch:async()=>({ok:true,json:async()=>state})});
  await vm.runInContext(code+'\nrefresh();',context);
  assert.equal(elements.cards.children.length,Object.keys(state.domains).length);
  assert.match(elements.cards.children[0].text,/집계 전/);
  const room=elements.cards.children[4];
  assert.match(room.text,/연속 실패: 2회/);
  assert.match(room.text,/정상 확인 후 경과: 1시간 0분/);
  assert.match(room.text,/HTTP 403/);
  assert.match(room.text,/<script>alert\(1\)<\/script>/);
  assert.equal(room.children.filter(child=>child.tag==='details').length,1);
  assert.equal(elements.refresh.disabled,false);
  assert.equal(elements.last.className,'');
});

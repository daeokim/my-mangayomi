// Read-only experiment: no credentials, registry writes, or challenge solving.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PROFILES, normalize, assess} from './worker.mjs';

const state=JSON.parse(await readFile(new URL('../domains.json',import.meta.url),'utf8'));
const desktop='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
for(const key of ['goodtoon','tvroom','anilife']) {
  const base=state.domains[key].baseUrl;
  const existing=key==='anilife' ? {'User-Agent':desktop,'Accept':'application/json, text/plain, */*','Accept-Language':'ko-KR,ko;q=0.9,en;q=0.8','Referer':base+'/tags','Origin':base} :
    {'User-Agent':'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/143.0.0.0 Mobile Safari/537.36','Accept':'text/html,application/xhtml+xml','Referer':base+'/'};
  const browser={...existing,'User-Agent':desktop,'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.8',
    ...(key==='anilife' ? {'Sec-Fetch-Dest':'empty','Sec-Fetch-Mode':'cors','Sec-Fetch-Site':'same-origin'} :
      {'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8','Sec-Fetch-Dest':'document','Sec-Fetch-Mode':'navigate','Sec-Fetch-Site':'same-origin','Upgrade-Insecure-Requests':'1'})};
  for(const [profile,headers] of [['existing',existing],['desktop',browser]]) {
    let url=base+PROFILES[key].path;
    const record={site:key,profile,origin:process.env.GITHUB_ACTIONS==='true'?'github-actions':'task-host',checkedAt:new Date().toISOString(),headers,hops:[]};
    try {
      for(let hop=0;hop<3;hop++) {
        const res=await fetch(url,{headers,redirect:'manual',signal:AbortSignal.timeout(8000)});
        const reader=res.body.getReader();let size=0;const chunks=[];
        try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256*1024){await reader.cancel();throw Error('body_limit');}chunks.push(Buffer.from(value));}} finally {reader.releaseLock();}
        const body=Buffer.concat(chunks).toString('utf8');
        record.hops.push({url,status:res.status,server:res.headers.get('server'),cfMitigated:res.headers.get('cf-mitigated'),bodySha256:createHash('sha256').update(body).digest('hex')});
        if([301,302,303,307,308].includes(res.status)) {
          const target=new URL(res.headers.get('location')||'',url);
          if(hop===2||!normalize(key,target.origin,0))throw Error('redirect_rejected');
          url=target.href;continue;
        }
        record.result=assess(key,body,res.status)||'validated_catalog';break;
      }
    } catch(e) {record.error=e.cause?.code||e.name;record.result=e.message==='body_limit'?'body_limit':'connection_failed';}
    console.log(JSON.stringify(record));
  }
}

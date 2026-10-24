// Standalone module: deploy this file from the Cloudflare dashboard or Wrangler.
// GitHub's existing domains.json is the persistent state and the stable app URL.
export const SIGNAL = "https://wankyo83.github.io/tokki-traffic-light/domains.json";
export const PROFILES = {
  "11toon": { label: "11툰", pattern: /^(?:www\.)?11toon(\d*)\.com$/, floor: 0, seed: "https://11toon.com", path: "/bbs/board.php?bo_table=toon_c", identity: /11toon|11툰/i, cards: /(?:bo_table=(?:toons|toon_c)[^"'<>]*\b(?:is|wr_id)=\d+)/i },
  blacktoon: { label: "블랙툰", pattern: /^(?:www\.)?blacktoon(\d+)\.com$/, floor: 424, seed: "https://blacktoon424.com", path: "/", identity: /blacktoon|블랙툰/i, cards: /webtoon_[01](?:_\d+)?\.js/i },
  goodtoon: { label: "굿툰", pattern: /^(?:www\.)?goodtoon(\d+)\.com$/, floor: 7, seed: "https://goodtoon007.com", path: "/ongoing/", identity: /goodtoon|굿툰/i, cards: /href\s*=\s*["'][^"']*\/manga\/[^/"']+\/?["']/i },
  tvwiki: { label: "티비위키", pattern: /^(?:www\.)?tvwiki(\d+)\.net$/, floor: 53, seed: "https://tvwiki53.net", path: "/drama", identity: /tvwiki|티비위키/i, cards: /href\s*=\s*["'][^"']*\/(?:drama|movie|ent|ani|animation|entertainment)\/\d+\/?["']/i },
  tvroom: { label: "티비룸", pattern: /^(?:www\.)?tvroom(\d+)\.org$/, floor: 38, seed: "https://tvroom38.org", path: "/", identity: /tvroom|티비룸/i },
  ani24: { label: "애니24", pattern: /^(?:www\.|ani\.)?ohli(\d+)\.(?:net|com)$/, floor: 24, seed: "https://ani.ohli24.com", path: "/ing", identity: /ohli24|애니24/i, cards: /class\s*=\s*["'][^"']*\bshow-item\b/i },
  anilife: { label: "애니라이프", pattern: /^(?:www\.)?anilife(\d+)\.tv$/, floor: 1, seed: "https://anilife01.tv", path: "/api/anime?page=1&limit=1&sort=latest&v=catalog-media-2" },
};
const BLOCKED = /cf-chl-|challenge-platform|just a moment|verify (?:that )?you are human|checking your browser|captcha|access denied|domain (?:is )?for sale|parkingcrew|sedoparking/i;
const MAX_BYTES = 256 * 1024;
const TIMEOUT = 6000;
const MAX_REQUESTS = 36;
export const FREE_FETCH_LIMIT = 50;
// One invocation includes GitHub reads/writes and all explicit redirect hops.
// Never permit automatic redirects: Fetch otherwise hides chargeable subrequests.
// Only "manual": workerd throws a TypeError for redirect "error" (Node accepts it).
export function freeFetch(io = fetch) {
  let used = 0;
  return async (url,options = {}) => {
    if (options.redirect !== 'manual') throw new Error('automatic_redirects_forbidden');
    if (used >= FREE_FETCH_LIMIT) throw new Error('free_subrequest_limit');
    used++;
    return io(url,options);
  };
}
const copy = v => JSON.parse(JSON.stringify(v));
const isProfile = key => Object.prototype.hasOwnProperty.call(PROFILES,key);
export function normalize(key, value, minimum = PROFILES[key]?.floor) {
  if (!isProfile(key) || typeof value !== "string") return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/") return "";
    const match = url.hostname.match(PROFILES[key].pattern);
    const number = Number(match?.[1] || 0);
    return match && Number.isSafeInteger(number) && number >= minimum && number <= 999999 ? url.origin : "";
  } catch { return ""; }
}
export function domainNumber(key, url) { return Number(new URL(url).hostname.match(PROFILES[key].pattern)?.[1] || 0); }
export function seedState() {
  return { schemaVersion: 1, updatedAt: null, lastRunAt: null, domains: Object.fromEntries(Object.entries(PROFILES).map(([key,p]) => [key, { baseUrl: p.seed, status: "unverified", lastConfirmedAt: null, lastCheckedAt: null, reason: "초기 설정 주소 · 서버 점검 전", scanOffset: 1 }])), control: { revision: 0, overrides: {} } };
}
function checkedState(value) {
  if (!value || value.schemaVersion !== 1 || !value.domains || !Number.isSafeInteger(value.control?.revision)) throw new Error("registry_format");
  for (const key of Object.keys(PROFILES)) {
    if (!normalize(key, value.domains[key]?.baseUrl,0)) throw new Error("registry_domain");
    const pin = value.control.overrides?.[key];
    if (pin && !normalize(key, pin, 0)) throw new Error("registry_override");
  }
  return value;
}
function repository(env) {
  const repo = env.GITHUB_REPOSITORY || "daeokim/my-mangayomi";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("repository_format");
  return "https://api.github.com/repos/" + repo + "/contents/domains.json";
}
function githubHeaders(env) {
  if (!env.GITHUB_TOKEN) throw new Error("github_secret_missing");
  return { Authorization: "Bearer " + env.GITHUB_TOKEN, Accept: "application/vnd.github+json", "User-Agent": "Daeo-Domain-Manager", "X-GitHub-Api-Version": "2022-11-28" };
}
function decode64(text) { return new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s/g,"")), c => c.charCodeAt(0))); }
function encode64(text) { const bytes = new TextEncoder().encode(text); let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
async function boundedText(response, limit = MAX_BYTES) {
  const reader = response.body.getReader(); let size = 0, parts = []; const decoder = new TextDecoder();
  try {
    while (true) { const {done,value} = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new Error("body_limit"); } parts.push(decoder.decode(value,{stream:true})); }
    parts.push(decoder.decode()); return parts.join("");
  } finally { reader.releaseLock(); }
}
async function timedFetch(url, options, io, budget) {
  if (budget && ++budget.used > MAX_REQUESTS) throw new Error("request_budget");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT);
  try { const response = await io(url,{...options,signal:controller.signal}); const body = await boundedText(response); return { response, body }; }
  finally { clearTimeout(timer); }
}
export async function readState(env, io = fetch) {
  const {response,body} = await timedFetch(repository(env) + "?ref=" + encodeURIComponent(env.GITHUB_BRANCH || "main"), {headers:githubHeaders(env),redirect:"manual"},io);
  if (response.status === 404) throw new Error("registry_missing_upload_seed_first");
  if (!response.ok) throw new Error("github_read_" + response.status);
  const file = JSON.parse(body); return { state: checkedState(JSON.parse(decode64(file.content))), sha: file.sha };
}
export async function commitState(env, loaded, next, io = fetch) {
  checkedState(next);
  const {response} = await timedFetch(repository(env), {method:"PUT",redirect:"manual",headers:{...githubHeaders(env),"Content-Type":"application/json"},body:JSON.stringify({message:"Update validated domain registry",branch:env.GITHUB_BRANCH || "main",sha:loaded.sha,content:encode64(JSON.stringify(next,null,2)+"\n")})},io);
  if (response.status === 409 || response.status === 422) return false;
  if (!response.ok) throw new Error("github_write_" + response.status);
  return true;
}
// Match the extension's actual v-item cards, not /video/category navigation.
export function hasTvroomCards(html) {
  const clean = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const attr = (tag, name) => {
    const match = tag.match(new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i'));
    return (match?.[1] ?? match?.[2] ?? '').trim();
  };
  const hasClass = (tag, name) => attr(tag, 'class').split(/\s+/).includes(name);
  const categories = new Set(['영화','드라마','TV예능','음악프로','애니','시사다큐']);
  let depth = 0, card = null;
  for (const [tag] of clean.matchAll(/<\/?div\b[^>]*>|<a\b[^>]*>|<img\b[^>]*>/gi)) {
    if (/^<\/div\b/i.test(tag)) {
      if (card && depth === card.depth) {
        if (card.link && card.image) return true;
        card = null;
      }
      depth = Math.max(0, depth - 1);
    } else if (/^<div\b/i.test(tag)) {
      depth++;
      if (hasClass(tag, 'v-item')) card = {depth, link:false, image:false};
    } else if (card && /^<a\b/i.test(tag) && hasClass(tag, 'v-item-hitarea') && attr(tag, 'aria-label')) {
      try {
        const url = new URL(attr(tag, 'href'), 'https://tvroom38.org');
        const slug = url.pathname.match(/^\/video\/([^/]+)\/?$/)?.[1];
        if (!url.username && !url.password && normalize('tvroom', url.origin, 0) && slug && !categories.has(decodeURIComponent(slug))) card.link = true;
      } catch { /* Malformed or foreign links are not work cards. */ }
    } else if (card && /^<img\b/i.test(tag)) {
      if (['data-src','data-original','src'].some(name => /^(?:https?:\/\/|\/)/i.test(attr(tag, name)))) card.image = true;
    }
  }
  return false;
}
export function assess(key, html, status) {
  if (status < 200 || status >= 300) return "HTTP " + status;
  if (BLOCKED.test(html)) return "보호 화면 또는 차단 응답";
  if (key === 'anilife') {
    try {
      const data = JSON.parse(html);
      if (!Array.isArray(data.items) || !data.items.length || !data.items.every(item =>
        item && /^[A-Za-z0-9_-]+$/.test(String(item.id || '')) && typeof item.title === 'string' && item.title.trim() &&
        typeof item.image === 'string' && /^(?:https:\/\/|\/)/.test(item.image)) || !Number.isInteger(data.pagination?.pages)) return "목록 구조 미확인";
      return "";
    } catch { return "목록 구조 미확인"; }
  }
  if (!PROFILES[key].identity.test(html)) return "사이트 이름 미확인";
  if (!(key === 'tvroom' ? hasTvroomCards(html) : PROFILES[key].cards.test(html))) return "목록 구조 미확인";
  return "";
}
export async function probe(key, base, io = fetch, budget = {used:0}) {
  if (!normalize(key,base,0)) return {ok:false,reason:"허용되지 않은 주소"};
  let url = base + PROFILES[key].path;
  try {
    for (let redirects = 0; redirects <= 2; redirects++) {
      const headers = key === 'anilife' ? {
        "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept":"application/json, text/plain, */*", "Accept-Language":"ko-KR,ko;q=0.9,en;q=0.8", "Referer":base+"/tags", "Origin":base
      } : {"User-Agent":"Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/143.0.0.0 Mobile Safari/537.36","Accept":"text/html,application/xhtml+xml","Referer":base+"/"};
      const {response,body} = await timedFetch(url,{redirect:"manual",headers},io,budget);
      if ([301,302,303,307,308].includes(response.status)) {
        const target = new URL(response.headers.get("Location") || "",url);
        if (target.username || target.password || !normalize(key,target.origin,0) || redirects === 2) return {ok:false,reason:"다른 사이트 이동 또는 과도한 이동"};
        url = target.href; continue;
      }
      const finalBase = new URL(url).origin;
      let reason = assess(key,body,response.status);
      if (!reason && key === "blacktoon") {
        const config = await timedFetch(finalBase+"/data/config.js",{redirect:"manual",headers:{Referer:finalBase+"/"}},io,budget);
        if (!config.response.ok || BLOCKED.test(config.body) || !/\binc_url\s*=\s*["'][^"']+["']/.test(config.body) || !/\bimg_domain\s*=\s*["'][^"']+["']/.test(config.body)) reason = "데이터 서버 설정 미확인";
      }
      return reason ? {ok:false,reason} : {ok:true,baseUrl:finalBase};
    }
  } catch (error) { return {ok:false,reason:error.message === "body_limit" ? "응답 크기 제한 초과" : error.message === "request_budget" ? "이번 점검 요청 한도" : "연결 실패 또는 시간 초과"}; }
  return {ok:false,reason:"주소 점검 실패"};
}
export function scanCandidate(key, base, offset) {
  const p = PROFILES[key], n = domainNumber(key,base) + offset;
  const host = key === "11toon" ? "11toon"+n+".com" : key === "goodtoon" ? "goodtoon"+String(n).padStart(3,"0")+".com" : key === "ani24" ? (/^ani\.ohli\d+\.com$/.test(new URL(base).hostname) ? "ani.ohli"+n+".com" : "ohli"+n+".net") : key === "anilife" ? "anilife"+String(n).padStart(2,"0")+".tv" : key+n+(key === "tvwiki" ? ".net" : key === "tvroom" ? ".org" : ".com");
  return "https://"+host;
}
export async function scanState(initial, io = fetch, now = new Date().toISOString(), keys = Object.keys(PROFILES), lookahead = 1) {
  if (!Number.isInteger(lookahead) || lookahead < 1 || lookahead > 10 || !keys.every(isProfile)) throw new Error("scan_options");
  const next = copy(initial), budget = {used:0}; let signal = {};
  try { const {response,body} = await timedFetch(SIGNAL,{redirect:"manual",headers:{Accept:"application/json"}},io,budget); if (response.ok) signal = JSON.parse(body).domains || {}; } catch { /* A failed upstream never replaces our registry. */ }
  for (const key of keys) {
    const previous = initial.domains[key], pin = initial.control.overrides[key];
    const minimum = Math.max(PROFILES[key].floor,domainNumber(key,previous.baseUrl));
    // The external signal may only move a site forward. At the same number it can still name an old host
    // (Ani24 www.ohli24.net after the move to ani.ohli24.com), so a tie never replaces our address.
    const hinted = normalize(key,signal[key]?.baseUrl,minimum);
    const upstream = hinted && (hinted === previous.baseUrl || domainNumber(key,hinted) > domainNumber(key,previous.baseUrl)) ? hinted : "";
    const offset = Number.isInteger(previous.scanOffset) && previous.scanOffset >= 1 && previous.scanOffset <= 10 ? previous.scanOffset : 1;
    const future = Array.from({length:lookahead},(_,i) => scanCandidate(key,previous.baseUrl,(offset+i-1)%10+1));
    const candidates = pin ? [pin] : [...new Set([upstream,previous.baseUrl,...future].filter(Boolean))];
    let found = null;
    const attempts = [];
    for (const candidate of candidates) {
      const result = await probe(key,candidate,io,budget);
      const accepted = result.ok && !!normalize(key,result.baseUrl,pin ? 0 : minimum);
      attempts.push({baseUrl:candidate,ok:accepted,reason:accepted ? '목록 구조 확인' : result.reason || '이전 번호로 이동하여 제외',...(result.baseUrl ? {finalBaseUrl:result.baseUrl} : {})});
      if (accepted) { found = result; break; }
    }
    const current = attempts.find(attempt => attempt.baseUrl === previous.baseUrl);
    const currentCheck = current ? {...current,checked:true} : {baseUrl:previous.baseUrl,checked:false,reason:'다른 후보 확인으로 기존 주소는 미점검'};
    const reason = current?.reason || attempts[0]?.reason || '점검 실패';
    const failures = Number.isSafeInteger(previous.consecutiveFailures) && previous.consecutiveFailures >= 0 ? previous.consecutiveFailures : 0;
    const diagnostics = {attempts,currentCheck,consecutiveFailures:found ? 0 : failures + 1};
    next.domains[key] = found ? {...previous,...diagnostics,baseUrl:found.baseUrl,status:"healthy",lastConfirmedAt:now,lastCheckedAt:now,reason:"목록 구조 확인 · 재생/이미지 검증은 별도",scanOffset:1} : {...previous,...diagnostics,status:"protected",lastCheckedAt:now,reason,scanOffset:offset % 10 + 1};
  }
  next.updatedAt = now; next.lastRunAt = now; return next;
}
// Merge only if the operator has not changed a pin during the network checks.
export function mergeScan(latest, initial, scanned) {
  if (latest.control.revision !== initial.control.revision) return latest;
  const domains = {...latest.domains}; let changed = false;
  for (const key of Object.keys(PROFILES)) {
    const candidate = scanned.domains[key], old = initial.domains[key];
    if (candidate.lastCheckedAt !== old.lastCheckedAt && (!latest.domains[key].lastCheckedAt || latest.domains[key].lastCheckedAt <= candidate.lastCheckedAt)) { domains[key] = candidate; changed = true; }
  }
  if (!changed) return latest;
  return {...latest,domains,updatedAt:scanned.updatedAt,lastRunAt:latest.lastRunAt && latest.lastRunAt > scanned.lastRunAt ? latest.lastRunAt : scanned.lastRunAt};
}
export async function runCheck(env, io = fetch, keys = Object.keys(PROFILES), lookahead = 1) {
  if (!keys.length || !keys.every(isProfile)) throw new Error("scan_options");
  const initial = await readState(env,io);
  const fresh = keys.every(key => { const age = Date.now() - Date.parse(initial.state.domains[key].lastCheckedAt || 0); return age >= 0 && age < 60000; });
  if (fresh) return {state:initial.state,skipped:true};
  const now = new Date().toISOString();
  let scanned = initial.state;
  // Daily Actions jobs can inspect the full +1..+10 window, with an independent
  // request budget for each source. Workers retain their one-candidate default.
  if (lookahead === 1) scanned = await scanState(initial.state,io,now,keys);
  else for (const key of keys) scanned = await scanState(scanned,io,now,[key],lookahead);
  let loaded = initial;
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = mergeScan(loaded.state,initial.state,scanned);
    if (next === loaded.state) return {state:loaded.state,skipped:true};
    if (await commitState(env,loaded,next,io)) return {state:next,skipped:false};
    loaded = await readState(env,io);
  }
  throw new Error("concurrent_update_retry");
}
async function authorized(request,env) {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 24) return false;
  const actual = request.headers.get("Authorization") || "";
  const digest = v => crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));
  const [a,b] = await Promise.all([digest(actual),digest("Bearer "+env.ADMIN_TOKEN)]); let difference = 0;
  const av = new Uint8Array(a), bv = new Uint8Array(b); for (let i=0;i<av.length;i++) difference |= av[i]^bv[i]; return difference === 0;
}
const headers = {"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
function json(value,status=200) { return new Response(JSON.stringify(value),{status,headers:{...headers,"Content-Type":"application/json; charset=utf-8"}}); }
export function scheduledKey(scheduledTime) {
  if (!Number.isFinite(scheduledTime) || scheduledTime < 0) throw new Error("scheduled_time");
  const keys = Object.keys(PROFILES);
  return keys[Math.floor(scheduledTime / (10 * 60 * 1000)) % keys.length];
}
export async function runScheduled(event, env, io = fetch) {
  const key = scheduledKey(event.scheduledTime);
  const result = await runCheck(env, freeFetch(io), [key]);
  const domain = result.state.domains[key];
  // Public diagnostics only; never log environment, headers, or tokens.
  console.log(JSON.stringify({checker:"cloudflare",site:key,skipped:result.skipped,
    baseUrl:domain.baseUrl,status:domain.status,lastCheckedAt:domain.lastCheckedAt,
    lastConfirmedAt:domain.lastConfirmedAt,reason:domain.reason}));
  return result;
}
export default {
  async scheduled(event,env) {
    await runScheduled(event,env);
  },
  async fetch(request,env) {
    const io = freeFetch();
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/admin") return new Response(ADMIN_PAGE,{headers:{...headers,"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}});
    if (url.pathname === "/domains.json" && request.method === "GET") {
      try { const {state} = await readState(env,io); return json({schemaVersion:state.schemaVersion,updatedAt:state.updatedAt,lastRunAt:state.lastRunAt,domains:state.domains}); } catch { return json({error:"주소 목록을 읽지 못했습니다. Cloudflare 설정을 확인하세요."},503); }
    }
    if (!url.pathname.startsWith("/api/")) return json({error:"not_found"},404);
    if (!await authorized(request,env)) return json({error:"관리 키가 없거나 일치하지 않습니다."},401);
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return json({error:"origin"},403);
    try {
      if (url.pathname === "/api/state" && request.method === "GET") return json((await readState(env,io)).state);
      if (url.pathname === "/api/check" && request.method === "POST") {
        const input = JSON.parse(await boundedText(request,4096));
        if (!isProfile(input.key)) return json({error:"점검할 사이트를 선택하세요."},400);
        return json(await runCheck(env,io,[input.key]));
      }
      if (url.pathname === "/api/override" && request.method === "POST") {
        if (Number(request.headers.get("Content-Length")) > 4096) return json({error:"body_limit"},413);
        const body = await boundedText(request,4096), change = JSON.parse(body);
        if (!isProfile(change.key) || typeof change.baseUrl !== "string" || !Number.isSafeInteger(change.revision)) return json({error:"변경 형식 오류"},400);
        const pin = change.baseUrl === "" ? "" : normalize(change.key,change.baseUrl);
        if (change.baseUrl && !pin) return json({error:"이 사이트의 HTTPS 주소와 현재 기본 번호 이상만 입력하세요."},400);
        const loaded = await readState(env,io);
        if (loaded.state.control.revision !== change.revision) return json({error:"다른 변경이 적용됐습니다. 다시 불러오세요."},409);
        const next = copy(loaded.state); next.control.revision++;
        if (pin) next.control.overrides[change.key] = pin; else delete next.control.overrides[change.key];
        if (pin) {
          const result = await probe(change.key,pin,io);
          if (!result.ok) return json({error:"저장하지 않았습니다: "+result.reason},422);
          const now = new Date().toISOString(); next.domains[change.key] = {...next.domains[change.key],baseUrl:result.baseUrl,status:"healthy",lastConfirmedAt:now,lastCheckedAt:now,reason:"관리자가 지정한 주소의 목록 구조 확인",scanOffset:1};
        }
        next.updatedAt = new Date().toISOString();
        if (!await commitState(env,loaded,next,io)) return json({error:"동시 변경 감지. 다시 불러오세요."},409);
        return json(next);
      }
      return json({error:"not_found"},404);
    } catch { return json({error:"요청을 완료하지 못했습니다. GitHub 토큰·파일·Worker 로그를 확인하세요."},503); }
  }
};
export const ADMIN_PAGE = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Daeo 주소 관리</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f5f8;color:#1c2735;font-family:system-ui,sans-serif}main{max-width:620px;margin:auto;padding:24px 18px}h1{font-size:26px;margin-bottom:8px}p{line-height:1.55;color:#556274}.panel,article{background:white;border:1px solid #dce2e9;border-radius:16px;padding:18px;margin:16px 0}label{display:block;margin:12px 0 6px}input{font-size:16px;padding:12px;border:1px solid #b6c2d1;border-radius:9px;width:100%}button{font-size:16px;min-height:46px;padding:10px 15px;margin:8px 6px 0 0;border:0;border-radius:9px;background:#2357d2;color:white;cursor:pointer}button.secondary{background:#e6edf9;color:#20426c}button:disabled{opacity:.45}h2{font-size:19px;margin:0 0 9px}.status{font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.55}.success{color:#14743b}.warning{color:#9a4900}#notice{white-space:pre-wrap;line-height:1.5}small{display:block;color:#556274;line-height:1.5;margin-top:9px}a{color:#2357d2}</style><main><h1>주소 관리</h1><p>망가요미 · 애니요미 공통 주소 목록<br>매시간 자동 점검 / 실패하면 이전 주소 유지</p><section class="panel"><label for="token">관리 키</label><input id="token" type="password" autocomplete="off" placeholder="Cloudflare에 저장한 관리 키"><small>키는 이 페이지의 메모리에서만 사용합니다. 새로 열면 다시 입력하세요.</small><button id="load">불러오기</button><button id="check" class="secondary">지금 점검</button><div id="notice" role="status" aria-live="polite"></div></section><div id="cards"></div><p><a href="/domains.json">공개 주소 목록</a> · 앱에서는 주소 직접 지정란을 비워 자동 갱신을 사용하세요.</p></main><script>
let state=null;const el=id=>document.getElementById(id),labels={'11toon':'11툰',blacktoon:'블랙툰',goodtoon:'굿툰',tvwiki:'티비위키',tvroom:'티비룸',ani24:'애니24',anilife:'애니라이프'};
function busy(value){document.querySelectorAll('button').forEach(b=>b.disabled=value)}
async function api(path,body){const res=await fetch(path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+el('token').value,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await res.json();if(!res.ok)throw Error(data.error||'요청 실패');return data}
function stamp(v){return v?new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'아직 없음'}
function render(){el('cards').replaceChildren();Object.entries(state.domains).forEach(([key,d])=>{const article=document.createElement('article'),title=document.createElement('h2'),info=document.createElement('div'),label=document.createElement('label'),input=document.createElement('input'),save=document.createElement('button'),auto=document.createElement('button');title.textContent=labels[key];info.className='status '+(d.status==='healthy'?'success':'warning');info.textContent=d.baseUrl+'\\n상태: '+(d.status==='healthy'?'목록 구조 확인':d.status==='unverified'?'초기 설정 · 점검 전':'자동 확인 실패 · 이전 주소 유지')+'\\n최근 점검: '+stamp(d.lastCheckedAt)+'\\n정상 확인: '+stamp(d.lastConfirmedAt)+'\\n'+d.reason;label.textContent='주소 직접 지정 (선택)';input.type='url';input.value=state.control.overrides[key]||'';input.placeholder=d.baseUrl;input.setAttribute('aria-label',labels[key]+' 직접 지정 주소');save.textContent='검증 후 저장';auto.textContent='자동으로 복원';auto.className='secondary';save.onclick=()=>change(key,input.value.trim());auto.onclick=()=>change(key,'');article.append(title,info,label,input,save,auto);el('cards').append(article)});const age=Date.now()-Date.parse(state.lastRunAt||0);el('notice').textContent='자동 점검: '+stamp(state.lastRunAt)+(age>3*3600000?'\\n자동 점검이 오래 멈춰 있습니다. Cloudflare Cron/로그를 확인하세요.':'')}
async function act(fn){busy(true);el('notice').textContent='처리 중… 사이트 응답에 따라 시간이 걸립니다.';try{await fn();render()}catch(e){el('notice').textContent=e.message}finally{busy(false)}}
async function change(key,baseUrl){if(!state)return;await act(async()=>{state=await api('/api/override',{key,baseUrl,revision:state.control.revision})})}
el('load').onclick=()=>act(async()=>{state=await api('/api/state')});el('check').onclick=()=>act(async()=>{for(const key of Object.keys(labels)){el('notice').textContent=labels[key]+' 점검 중…';const result=await api('/api/check',{key});state=result.state}});
</script></html>`;

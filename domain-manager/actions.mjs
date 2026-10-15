import {appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {PROFILES,runCheck} from './worker.mjs';
import {failureCount,elapsed} from './status.mjs';

export function selectedKeys(value = 'all') {
  if (value === 'all') return Object.keys(PROFILES);
  if (!Object.hasOwn(PROFILES,value)) throw new Error('unknown_site');
  return [value];
}
const safe = value => String(value ?? '').replace(/[|\r\n]/g,' ').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export function renderSummary(result,keys) {
  const lines = ['# 주소 자동 점검','',result.skipped ? '최근 점검 또는 동시 설정 변경으로 저장을 생략했습니다.' : '주소 목록을 GitHub에 저장했습니다. 다음 단계에서 Pages에 배포합니다.','',
    '| 사이트 | 주소 | 상태 | 연속 실패 | 정상 확인 후 경과 | 마지막 점검 (UTC) | 결과 |','|---|---|---|---|---|---|---|'];
  for (const key of keys) {
    const d=result.state.domains[key];
    lines.push(`| ${PROFILES[key].label} | ${safe(d.baseUrl)} | ${d.status === 'healthy' ? '목록 확인' : '확인 실패 · 기존 주소 유지'} | ${failureCount(d)} | ${elapsed(d.lastConfirmedAt)} | ${safe(d.lastCheckedAt || '없음')} | ${safe(d.reason)} |`);
  }
  for (const key of keys) {
    const d=result.state.domains[key];
    if (!d.attempts?.length) continue;
    lines.push('',`## ${PROFILES[key].label} 주소별 점검`,'');
    if (d.currentCheck) lines.push(`점검 시작 당시 주소: ${safe(d.currentCheck.baseUrl)} · ${d.currentCheck.checked ? safe(d.currentCheck.reason) : '미점검'}`,'');
    for (const a of d.attempts) lines.push(`- ${safe(a.baseUrl)}: ${safe(a.reason)}${a.finalBaseUrl && a.finalBaseUrl !== a.baseUrl ? ' → '+safe(a.finalBaseUrl) : ''}`);
  }
  lines.push('','서버에서 목록을 확인한 결과입니다. 이미지·영상 재생 성공을 뜻하지 않습니다.','',
    '[휴대폰 상태 화면](https://daeokim.github.io/my-mangayomi/domain-manager/)','');
  return lines.join('\n');
}
export async function runActions(env = process.env,io = fetch) {
  if (!env.GITHUB_TOKEN) throw new Error('github_secret_missing');
  const keys=selectedKeys(env.CHECK_SITE || 'all');
  const result=await runCheck({...env,GITHUB_REPOSITORY:env.GITHUB_REPOSITORY || 'daeokim/my-mangayomi',GITHUB_BRANCH:'main'},io,keys,10);
  const summary=renderSummary(result,keys);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY,summary,'utf8');
  console.log(summary);
  for (const key of keys) if (result.state.domains[key].status !== 'healthy') console.log(`::warning title=주소 확인 실패::${PROFILES[key].label}: 기존 주소를 유지했습니다. 상태 요약을 확인하세요.`);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {await runActions();} catch(error) {
    console.error('주소 점검 또는 GitHub 저장에 실패했습니다:',error.message);
    process.exitCode=1;
  }
}

import fs from 'node:fs';
import {ADMIN_PAGE,seedState} from './worker.mjs';
const html=ADMIN_PAGE
  .replace('<h1>주소 관리</h1>','<h1>주소 관리 미리보기</h1><p><strong>서버 미활성 · 화면 검토용</strong><br>아래 주소는 초기 설정이며 실제 자동 점검 결과가 아닙니다.</p>')
  .replace('id="token" type="password"','id="token" type="password" disabled')
  .replace('placeholder="Cloudflare에 저장한 관리 키"','placeholder="미리보기에서는 키를 입력하지 않습니다"')
  .replace('href="/domains.json"','href="../domains.json"')
  .replace('</script>',`state=${JSON.stringify(seedState())};render();busy(true);el('notice').textContent='화면 미리보기입니다. Cloudflare 계정 연결과 Secret 등록 후 실제 서버를 활성화합니다.';</script>`);
fs.writeFileSync(new URL('./preview.html',import.meta.url),html);

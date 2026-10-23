# 외부 주소 점검 전환

## 선택과 관측 근거

(a) 기존 Cloudflare Worker cron을 재사용한다. 별도 서버/항상 켜진 PC가 필요 없고,
기존 검사·GitHub SHA 충돌 처리 코드를 그대로 유지할 수 있다. 10분마다 사이트 하나를
선택하므로 7개가 70분마다 순환하며 하루 cron 호출은 144회다. 각 실행은 기존 36회
사이트 요청 예산, 6초 제한, 256KiB 응답 제한을 유지한다. 요금 0원을 보장하지 않으며
계정 사용량/현재 플랜의 한도는 배포 전 Cloudflare에서 확인한다. self-hosted PC는
상시 가동·절전 해제·보안 업데이트와 장애 대응이 필요해 이 작업의 기본안으로 택하지 않았다.

`probe-2026-10-23.json`은 2026-10-23 UTC 작업 서버의 실제 HTTP 결과다.
minimal UA와 확장의 브라우저 UA/Accept/Referer 조합 모두 goodtoon008, tvroom40→42,
anilife01에서 200이었다. Node의 기존 `assess`로 실제 응답의 목록 구조도 확인했다.
Actions run 39947231640 / job 120392743914의 주소 점검은 Goodtoon/AnimeLife HTTP 403,
TVRoom 현재 주소 연결 실패 및 tvroom42 HTTP 403을 기록했다. 이는 실행 환경 차이의
근거지만 같은 시각에 동일 TLS/네트워크 조건을 통제한 실험은 아니므로 IP만의 차단이라고
단정하지 않는다. UA 변경만으로 해결됐다는 근거도 없다. Cloudflare origin의 성공은 아직
측정하지 않았으며, 전환 후 scheduled 로그로 확인해야 한다. 403/보호 화면을 healthy로
바꾸거나 CAPTCHA를 우회하지 않는다.

이 PR의 domains.json은 실제 외부 응답을 기존 scanState 승인 규칙에 넣어 생성한 스냅샷이다.
세 사이트만 갱신하며 다른 사이트·운영자 pin/control revision은 보존한다. TVRoom은 42로
이동했고 확인 시각/attempts/currentCheck/연속 실패 초기화를 기록한다. 외부 관측 시각의
상태이며 이후 사이트 변경이나 재생/이미지 정상 동작을 보장하지 않는다.

## 최초 설정: 사용자가 직접 하는 클릭/명령

1. Cloudflare 대시보드에서 본인 계정을 선택한다. 계정이 없으면 직접 가입/약관 확인을 한다.
   Workers & Pages에서 계정의 플랜·사용량을 확인한다. 터미널에서 저장소의 이 PR 브랜치를
   checkout하고 `cd domain-manager`, `npx wrangler login`으로 본인 Cloudflare 계정을 인증한다.
   작업창에 토큰 값을 붙여 넣지 않는다.
2. GitHub 프로필 → Settings → Developer settings → Personal access tokens → Fine-grained
   tokens → Generate new token. Resource owner는 daeokim, Repository access는 Only select
   repositories → my-mangayomi만 선택한다. Repository permissions → Contents: Read and write,
   Metadata: Read를 선택하고 짧은 만료일을 설정한다. 앱 저장소/Administration/Secrets 권한은 불필요하다.
   이 토큰은 domains.json 쓰기에 사용하며 만료 전 사용자 갱신이 필요하다.
3. `npx wrangler secret put GITHUB_TOKEN`의 숨김 입력에 위 GitHub 토큰을 직접 넣는다.
   Worker가 아직 없다면 생성 안내를 확인한 후 `npx wrangler deploy`로 배포한다.
   Worker Settings → Variables and Secrets에서 Type Secret, 이름 GITHUB_TOKEN이 있는지 확인한다.
   GITHUB_REPOSITORY=daeokim/my-mangayomi, GITHUB_BRANCH=main은 wrangler.jsonc에 있다.
   ADMIN_TOKEN은 기존 웹 관리자 기능을 쓸 때만 별도로 24자 이상 난수를 Secret으로 등록한다.
   cron에는 ADMIN_TOKEN이 필요 없으며 관리자 endpoint는 없으면 계속 차단된다.
4. `npx wrangler deploy` 후 Workers & Pages → daeo-domain-manager → Settings → Triggers에서
   `*/10 * * * *`를 확인한다. Wrangler로 관리하므로 이후 cron도 wrangler.jsonc로만 변경한다.
   Logs/Observability의 scheduled 실행에서 checker=cloudflare, site, status, lastConfirmedAt을
   확인한다. 세 대상의 실제 목록 확인과 domains.json 커밋을 확인한 뒤 다음 단계로 간다.
   Worker에서도 실패하면 보호 상태를 유지하고 전환을 보류한다.
5. GitHub my-mangayomi → Settings → Secrets and variables → Actions → Variables → New repository
   variable → Name DOMAIN_CHECK_BACKEND, Value cloudflare. 이때부터 Actions는 주소 네트워크
   검사/저장만 생략하고 metadata 동기화·테스트·Pages 배포는 계속한다. Worker의 PAT 커밋은
   main push를 발생시켜 기존 Pages workflow를 실행한다. 미설정/값 actions이면 기존 Actions
   검사를 유지하며 오타는 명확한 오류다. 두 주체가 서로의 healthy를 protected로 덮어쓰지 않게
   실제 Worker 확인 후 전환한다. 이 PR의 머지와 이 설정은 사용자가 수행한다.

Cloudflare cron 전파에는 시간이 걸릴 수 있다. 첫 전체 순환(70분) 동안 로그와 GitHub
커밋을 확인한다. Pages URL은 기존 https://daeokim.github.io/my-mangayomi/domains.json 이다.
중단 시 먼저 Worker Triggers를 비활성화하고 GitHub DOMAIN_CHECK_BACKEND를 actions로 바꾼다.
이때 GitHub 환경에서 다시 보호 응답을 받을 수 있다. 보호 상태를 수동으로 정상 처리하지 않는다.
my-mangayomi에는 PR 강제/필수 검사 보호 규칙을 설정하지 않는다.

### Cloudflare API 토큰을 사용하는 선택적 배포

로컬 Wrangler OAuth 대신 API 배포를 택하는 경우 Cloudflare 프로필 → My Profile → API Tokens
→ Create Token → Edit Cloudflare Workers 템플릿에서 대상 계정을 제한한다.
`CLOUDFLARE_API_TOKEN`과 `CLOUDFLARE_ACCOUNT_ID`라는 환경 변수로 본인 터미널에 주입한다.
GitHub Actions로 Worker 배포를 별도로 구성한다면 같은 이름을 Actions Secrets에 저장한다.
이번 PR은 이 추가 배포 워크플로를 만들지 않으므로 GitHub에 Cloudflare 토큰을 줄 필요가 없다.
Worker 안의 GITHUB_TOKEN(주소 저장 권한)과 배포용 Cloudflare 토큰을 혼동하지 않는다.

공식 설정 근거:
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens

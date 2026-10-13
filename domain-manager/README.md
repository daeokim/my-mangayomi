# 휴대폰으로 관리하는 공통 자동 주소 목록

Cloudflare Workers가 다섯 사이트를 매시간 한 번씩 나누어 점검하고,
기존 GitHub 저장소의 `domains.json`을 갱신합니다. 주소 목록과 상태는
GitHub에 영구 저장하며 별도 KV/D1 데이터베이스는 사용하지 않습니다.
휴대폰에서는 Worker의 `/admin` 화면 하나를 즐겨찾기하면 됩니다.

[휴대폰 관리 화면 미리보기](preview.html) — 서버를 활성화하지 않은 화면 검토용이며 입력·점검·저장 버튼은 비활성화되어 있습니다.

## 앱에 적용

| 앱/확장 | 적용할 설정 |
|---|---|
| Mangayomi | 저장소의 확장 업데이트 후 다섯 소스의 `주소 직접 지정` 입력란을 비웁니다. |
| Aniyomi 만화 | Daeo Manga **1.4.1003**으로 업데이트합니다. 블랙툰의 `주소 갱신 방식`은 **중앙신호등**을 선택합니다. 11툰·굿툰에는 공통 주소 조회를 추가했으며 별도 모드 선택 없이 자동으로 적용됩니다. |
| Aniyomi 영상 | Daeo Media **14.1003**으로 업데이트합니다. 영화·드라마·예능·애니가 공통 목록에서 티비룸 주소를 읽습니다. 별도 주소 메뉴는 없습니다. |

앱이 읽는 고정 주소:

`https://daeokim.github.io/my-mangayomi/domains.json`

Mangayomi 저장소 주소와 Aniyomi 저장소 주소는 기존 값을 유지합니다.
설정·보관함을 먼저 백업하고, 업데이트 후 목록 새로고침과 앱 재시작을 진행하세요.
Aniyomi 만화에는 기존 중앙 주소 캐시가 잠시 남을 수 있습니다.
티비위키는 Mangayomi에만 포함됩니다. Aniyomi 영상은 티비룸 기반입니다.

## Cloudflare 최초 설정 — 휴대폰에서도 가능

이 저장소의 코드는 준비된 상태입니다. 계정 연결·Secret 두 개·Cron 설정을
마쳐야 자동 점검이 실제로 시작됩니다. 초기 목록의 `unverified`는
**초기 설정 주소이며 서버에서 확인하지 않았음**을 뜻합니다.

1. [Cloudflare 대시보드](https://dash.cloudflare.com/)에 로그인합니다.
2. Workers & Pages에서 새 Worker `daeo-domain-manager`를 만듭니다.
3. 코드 편집 화면에서 [worker.mjs](worker.mjs)의 전체 내용을 붙여 넣고 배포합니다.
   이 파일은 외부 패키지·빌드 없이 동작하는 ES module입니다.
4. Worker의 Settings → Variables and Secrets에서 아래 두 값을 **Secret**으로 추가합니다.

| Secret 이름 | 입력할 값 |
|---|---|
| `ADMIN_TOKEN` | 휴대폰 관리 화면에서 사용할 24자 이상의 무작위 관리 키. 공개 GitHub 파일에 넣지 마세요. |
| `GITHUB_TOKEN` | 아래 절차로 만든 개인용 GitHub 토큰. Cloudflare Secret에만 입력합니다. |

5. Worker Settings → Triggers → Cron Triggers에 **`7,17,27,37,47 * * * *`**를 추가합니다.
   11툰 7분 · 블랙툰 17분 · 굿툰 27분 · 티비위키 37분 · 티비룸 47분입니다.
   각 사이트는 매시간 한 번 점검합니다. UTC와 한국 시간의 분은 같습니다.
   무료 요금제의 CPU 작업량을 줄이기 위해 실행을 나누었습니다.
   Cron 변경 전파에는 시간이 걸릴 수 있습니다.
6. 생성된 `https://daeo-domain-manager.<계정 하위도메인>.workers.dev/admin`을 엽니다.
   실제 하위도메인은 Cloudflare가 표시하는 값을 사용하세요.
7. 관리 키 입력 → `불러오기` → `지금 점검` 순서로 실행합니다.
8. 상태와 마지막 점검 시간을 확인하고 이 화면을 휴대폰 즐겨찾기/홈 화면에 추가합니다.

관리 키는 서버 코드·공개 목록에 포함하지 않습니다. 관리 화면은 입력한 키를
현재 페이지의 메모리에서만 사용합니다. 새로 열면 다시 입력합니다.
GitHub 토큰은 휴대폰 관리 화면에 입력하지 않습니다.

### GitHub 토큰의 범위

[GitHub Fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)을 만듭니다.
Resource owner는 `daeokim`, Repository access는 **Only select repositories → my-mangayomi**,
Repository permissions는 **Contents: Read and write**로 설정합니다.
다른 저장소·Issues·Actions 관리 권한은 이 서버에 필요하지 않습니다.
토큰의 만료일을 확인하고 만료 전에 Cloudflare의 `GITHUB_TOKEN` Secret을 교체하세요.
이 작업은 GitHub의 `domains.json`을 주기적으로 커밋하므로 주소가 바뀌면 Pages 배포도 갱신됩니다.

### GitHub 연결로 코드 업데이트까지 자동화할 때

Cloudflare Workers Builds에서 이 저장소의 `main`을 연결하고 Root directory를
`domain-manager`, Deploy command를 `npx wrangler deploy`로 지정합니다.
이때는 Cron을 [wrangler.jsonc](wrangler.jsonc)에서 관리하세요.
토큰과 관리 키는 **런타임 Secret**이며 Build variable에만 넣으면 동작하지 않습니다.
직접 붙여 넣기 방식과 Git 연결 방식 중 하나를 선택합니다.

## 실제 동작

- 중앙 신호등의 최신 후보 → 이전 주소 → 다음 숫자 후보 순서로 확인합니다.
  정상 주소가 있으면 불필요하게 다음 번호를 탐색하지 않습니다.
- 다음 번호 탐색은 실패 때 한 번호씩 진행하며, +1부터 +10까지 시간별로 순환합니다.
  따라서 중앙 목록에도 없는 +10 주소는 최악의 경우 여러 시간이 걸립니다.
- HTTPS·사이트별 도메인 형태·현재 번호 이상·사이트 이름·목록 구조를 확인합니다.
  블랙툰은 데이터 서버 설정도 확인합니다. HTTP 200만으로 정상 판정하지 않습니다.
- 보호 화면, 다른 사이트 이동, 과도한 응답, 연결 실패면 이전 주소와 정상 확인 시간을 보존합니다.
  상태는 `protected`로 표시합니다. 이는 서버에서 검증하지 못했다는 뜻이며
  휴대폰에서도 반드시 접속 불가능하다는 뜻은 아닙니다.
- `검증 후 저장`으로 지정하면 자동 탐색이 그 사이트의 주소를 바꾸지 않습니다.
  `자동으로 복원`하면 다음 점검부터 자동 선택합니다.
- 동시에 수정하면 GitHub SHA와 설정 revision으로 충돌을 감지합니다.
  점검 중 변경된 직접 지정 값을 덮어쓰지 않습니다.
- 공개 조회로 주소를 바꿀 수 없습니다. 수정·즉시 점검 API에는 관리 키가 필요합니다.

## 유지 관리와 한계

보통은 앱의 확장 업데이트를 한 번 마치고 휴대폰 관리 화면만 사용하면 됩니다.
마지막 자동 점검이 3시간 이상 오래되면 화면에서 알려 줍니다.
GitHub 토큰 만료·권한 오류와 Cloudflare Cron/실행 로그를 확인하세요.
Pages 반영에는 배포 시간, 앱 반영에는 주소 캐시 시간이 추가됩니다.
무료 Workers는 CPU 및 요청 제한이 있으므로 실제 배포 후 실행 로그를 확인해야 합니다.
CPU 제한 오류가 반복되면 점검을 나누거나 요금제를 검토합니다.

서버 IP가 차단되거나 사이트 목록 구조가 바뀌면 자동 발견이 실패할 수 있습니다.
번호가 +10을 넘게 바뀌거나 도메인 접미사가 바뀌는 경우에는 후보/검증 규칙 수정이 필요합니다.
주소 갱신은 이미지·회차·영상 재생 엔진 오류를 고치지 않습니다.
이번 APK는 Android 실기기 설치·이미지·영상 재생을 검증하지 않았습니다.

## 로컬 검사

```sh
cd domain-manager
npm test
```

Wrangler를 사용할 때:

```sh
npm install
npx wrangler login
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put GITHUB_TOKEN
npm run deploy
```

계정 로그인과 비밀 값 입력은 본인 계정에서 진행합니다. 비밀 값은 공개 파일에 저장하지 않습니다.

공식 문서:

- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers Builds 설정](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [KV의 일관성 특성](https://developers.cloudflare.com/kv/concepts/how-kv-works/) — 이 구성은 GitHub SHA 충돌 검사로 상태를 관리합니다.

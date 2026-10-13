# 공통 주소 자동화 — GitHub Actions

주 2~3회 확인하는 개인 사용에 맞춰 GitHub Actions를 기본 방식으로 선택했습니다.
Cloudflare 계정 연결·관리 키·개인 GitHub 토큰을 추가로 설정하지 않아도 됩니다.
기존 공개 저장소의 표준 Ubuntu 실행 환경을 사용합니다.

- 자동 점검: **매일 오전 9:17 한국 시간** (`17 0 * * *`, UTC).
- 즉시 점검: [Actions 실행 화면](https://github.com/daeokim/my-mangayomi/actions/workflows/domains.yml).
- 휴대폰 상태 화면: [자동 주소 상태](https://daeokim.github.io/my-mangayomi/domain-manager/).
- 앱 공통 주소: `https://daeokim.github.io/my-mangayomi/domains.json`.

예약 실행은 정시를 보장하지 않으며 지연·누락될 수 있습니다. 사이트 차단이나 구조 변경은
자동화 도구를 바꾸는 것만으로 해결되지 않습니다. 목록 확인은 이미지·영상 재생 확인과 다릅니다.

## 앱에 적용

| 앱/확장 | 설정 |
|---|---|
| Mangayomi | 저장소 확장을 업데이트한 뒤 다섯 소스의 `주소 직접 지정` 입력란을 비웁니다. |
| Aniyomi 만화 | Daeo Manga **1.4.1003**으로 업데이트합니다. 블랙툰의 `주소 갱신 방식`은 **중앙신호등**을 선택합니다. 11툰·굿툰은 별도 모드 선택 없이 자동 조회합니다. |
| Aniyomi 영상 | Daeo Media **14.1003**으로 업데이트합니다. DC 영화·드라마·예능·애니가 공통 목록에서 티비룸 주소를 읽습니다. 별도 주소 메뉴는 없습니다. |

기존 저장소 주소·보관함·소스 ID는 유지합니다. 주소 번호만 바뀌는 경우 APK를 다시 만들지 않습니다.
설정과 보관함을 백업한 뒤 업데이트하세요. 앱에 남은 주소 캐시 때문에 반영이 늦어질 수 있습니다.
Aniyomi 영상은 티비룸 기반이며 티비위키는 Mangayomi에만 포함됩니다.

## 휴대폰에서 수동 점검

1. [실행 화면](https://github.com/daeokim/my-mangayomi/actions/workflows/domains.yml)에 GitHub 계정으로 로그인합니다.
2. **Run workflow**를 누릅니다.
3. `site`는 전체 점검이면 `all`, 한 사이트만 점검하려면 해당 이름을 선택합니다.
4. **Run workflow**를 눌러 실행하고, 새 실행의 완료 여부와 Summary를 확인합니다.
5. [상태 화면](https://daeokim.github.io/my-mangayomi/domain-manager/)에서 **상태 새로고침**을 누릅니다.

GitHub 실행이 성공했어도 개별 사이트는 확인 실패일 수 있습니다.
Summary와 상태 화면에 사이트별 결과·이유·마지막 정상 확인 시간이 표시됩니다.
상태 화면은 조회용이며 로그인 비밀 값이나 개인 토큰을 요구하지 않습니다.

## 점검과 저장 방식

- 중앙 신호등의 후보 → 기존 주소 → 다음 번호 후보 순서로 확인합니다.
- 하루 1회 실행에서는 다음 번호 **+1~+10**을 한 번에 확인합니다.
  기존 주소가 정상이라면 불필요하게 번호 후보를 요청하지 않습니다.
- HTTPS·사이트별 도메인 형태·현재 번호 이상·사이트 이름·작품 목록 구조를 확인합니다.
  블랙툰은 데이터 서버 설정도 확인합니다. HTTP 200만으로 정상 판정하지 않습니다.
- 보호 화면·접속 실패·다른 사이트 이동·과도한 응답이면 기존 주소와 마지막 정상 확인 시간을 보존합니다.
  `protected`는 GitHub 실행 환경에서 확인하지 못했다는 뜻이며 휴대폰 접속 불가를 단정하지 않습니다.
- 사이트마다 요청 예산과 요청 시간 제한을 적용합니다. TLS 검증과 사이트 보호를 우회하지 않습니다.
- GitHub SHA와 설정 revision으로 동시 수정 충돌을 확인합니다.
  직접 지정 설정이 점검 중 바뀌면 이를 덮어쓰지 않습니다.
- 예약·수동 점검은 결과 시각을 `domains.json`에 저장합니다. 모든 파일 변경은 커밋으로 남습니다.

## Pages 배포까지 연결

기본 인증은 작업 실행마다 GitHub가 발급하는 `GITHUB_TOKEN`입니다.
토큰으로 주소 파일을 커밋하는 것만으로는 별도 Pages 작업이 자동으로 시작되지 않으므로,
[domains.yml](../.github/workflows/domains.yml)에서 **점검 → 저장 → 최신 파일 조회 → Pages 배포**를 함께 실행합니다.
일반적인 `main` 변경도 같은 작업으로 배포합니다.

Pages의 Source는 **GitHub Actions**로 설정합니다. 표준 실행 환경과 공식 Pages 액션을 사용하며,
Pages 업로드 산출물은 1일 보관합니다. 별도 서버·유료 실행 환경·외부 데이터베이스는 사용하지 않습니다.

## 상태 확인과 유지관리

- 주 2~3회 상태 화면에서 마지막 점검 시각과 사이트별 결과를 확인하면 됩니다.
- 마지막 점검이 48시간 이상 지나면 상태 화면에서 실행 기록 확인을 안내합니다.
- GitHub 예약 실행은 지연·누락될 수 있습니다. 필요하면 수동 실행합니다.
- 공개 저장소에 60일 동안 활동이 없으면 예약 작업이 비활성화될 수 있습니다.
  정상 동작 중에는 점검 결과 커밋이 남지만, 화면 확인만으로 예약 작업의 유지가 보장되지는 않습니다.
  장기 미사용 후에는 Actions에서 활성화 상태와 마지막 실행을 확인하세요.
- 구조가 바뀌거나 번호가 +10을 넘어 이동하면 후보/검증 규칙을 수정해야 할 수 있습니다.
- 주소 자동화는 티비룸 영상 로딩·재생 엔진·이미지 서버 오류를 고치지 않습니다.
  Android 실기기에서 이미지·영상 재생을 별도로 확인해야 합니다.

## Cloudflare 파일

`worker.mjs`에는 공통 점검 엔진과 이전 Cloudflare 관리 API가 남아 있습니다.
기본 자동화는 GitHub Actions이며 `wrangler.jsonc`의 Cron 목록은 비워 두었습니다.
Cloudflare를 별도로 활성화해 두 점검 서버를 동시에 운영할 필요는 없습니다.
`preview.html`은 이전 Cloudflare 화면의 비활성 미리보기입니다. 현재 상태는 `index.html`에서 확인합니다.

## 로컬 검사

```sh
cd domain-manager
npm test
```

공식 문서:

- [공개 저장소의 Actions 요금](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [예약 실행과 비활성화](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [수동 실행](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [자동 인증 토큰](https://docs.github.com/en/actions/concepts/security/github_token)
- [Pages 배포](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

# 무료 주소 변경 대응

## 실제 헤더 비교 (2026-10-23 UTC)

`header-comparison-2026-10-23.json`에 요청 헤더·주소·시각·상태·응답 해시를 보관한다.
Actions run [39969015564](https://github.com/daeokim/my-mangayomi/actions/runs/39969015564),
job `120466411046`, `Compare production and browser headers from the same runner (read only)`에서
같은 Node Fetch·러너·주소로 기존 운영 헤더와 데스크톱 Chrome 형태 헤더를 비교했다.

| 사이트 | Actions 기존 / 데스크톱 | 작업 서버 기존 / 데스크톱 | 관측 |
|---|---|---|---|
| goodtoon008 | 403 / 403 | 200 / 200, 목록 검증 | Actions 응답 `cf-mitigated: challenge` |
| tvroom42 | 403 / 403 | 200 / 200, 목록 검증 | Actions 응답 `cf-mitigated: challenge` |
| anilife01 | 403 / 403 | 200 / 200, 목록 검증 | 두 Actions 응답의 본문 SHA-256도 같음 |

헤더 변경만으로 해결되지 않는다. 실행 환경에 따른 차단의 근거이며 **IP만의 차단이라고
단정할 수는 없다**. TLS 지문·경유망·요청 시각도 달라 통제되지 않았다. Cloudflare Worker
origin은 미측정이다. 보호 응답을 healthy로 처리하거나 CAPTCHA를 풀지 않는다.
진단 스크립트는 registry를 쓰지 않고 토큰도 사용하지 않는다.

## A. AniLife 휴대폰 자동 탐색

`AniLifeDomain.kt`와 `AniLifeDomainTest.kt`에 구현한다. AniLife만 14.1004/code1004로 올리고
패키지·소스 ID·lang·nsfw는 유지한다. 기존 main 서명 파이프라인은 변경하지 않는다.

- 403 또는 IOException(연결/DNS 실패) 때만 복구한다. 작품 하나의 404·401은 탐색하지 않는다.
- 동일 HTTPS 호스트 패턴의 다음 번호 +1..+5를 순서대로 검사한다. 09→10, 99→100과
  999999 상한을 처리하며 자격증명·외부 호스트·포트·경로를 origin으로 받아들이지 않는다.
- `domains.json`의 healthy 주소 번호가 더 높으면 우선한다. 실패 시 재조회한 registry 후보도
  **총 5개 후보 한도에 포함**한다. 낮은 번호와 protected registry는 휴대폰 저장값을 되돌리지 않는다.
- 실제 AniLife 목록 JSON(items의 id/title/image와 pagination)을 확인한 후보만 채택한다.
  후보당 요청 시간 제한과 최대 2회 동일 패턴 HTTPS redirect를 적용하고 최종 주소를 저장한다.
- 앱의 해당 소스 SharedPreferences `source_850164079243120202`의 `auto_domain`에 보관하므로
  앱 재시작 후에도 유지된다. 탐색이 모두 실패하면 기존 저장값을 유지하며 같은 주소의 실패
  탐색은 1분 동안 반복하지 않는다. 서버 domains.json에는 휴대폰 결과를 쓰지 않는다.
- 원래 GET은 새 주소에서 1회 재시도하되 Authorization/Cookie를 제거하고 Origin/Referer를
  갱신한다. 재생 주소가 바뀌면 기존 세션 토큰을 새 도메인으로 보내지 않고 세션부터 다시 시작한다.
- 이 변경은 휴대폰 네트워크가 사이트의 실제 목록에 접근 가능한 경우에만 도움이 된다.

### 바이너리 패치 확장 조사

| 대상 | 파일 근거 | 수정 가능 여부 / 이번 범위 |
|---|---|---|
| DaeoManga Goodtoon | `connect_registry.py`가 `goodtoonwebtoontest/d.smali`의 `getBaseUrl`을 재조립하며 `Registry.smali`를 삽입함. 1.4.1004 DEX에도 동일 클래스의 getBaseUrl/getClient가 있음 | 기술적으로 가능. 다만 getter 주입은 실패 응답을 관찰하지 않으므로 403 후 복구에는 요청 interceptor와 설정 저장 흐름을 새로 패치하고 실행 검증해야 한다. 이번 PR에서 APK를 임의 재조립하지 않음 |
| Daeo TVRoom | `prepare_tvroom.py`는 DEX 기본 주소 문자열과 manifest만 바꿈. 14.1005 DEX의 `Lqb;`는 getBaseUrl에서 d 필드를 반환하고, coroutine `S` 메서드에 registry URL이 있음 | 기술적으로 가능하나 문자열 교체만으로 접속 실패 후 탐색은 구현되지 않는다. 난독화된 요청/네트워크 흐름의 별도 패치·동작 검증이 필요. 이번 PR은 조사 결과만 제공 |

원본 소스가 없다고 수정 불가능하다고 단정하지 않는다. 두 바이너리는 현재 방식대로 검증된
registry 주소를 받으며 자동 탐색을 추가했다고 주장하지 않는다. 구 APK를 삭제/덮어쓰지 않는다.

## C. Workers Free 전용 cron

기존 Worker를 재사용한다. self-hosted PC, 유료 서비스, 카드 등록, Workers Paid 전환은 사용하지
않는다. 무료 플랜을 확인할 수 없으면 배포하지 않는다. 계정의 기본 `standard` 실행 모델만으로는
Free/Paid 여부를 판정할 수 없다.

`wrangler.jsonc`의 cron은 `*/10 * * * *`, 10분마다 사이트 하나, 7개 사이트를 70분에 한 번씩
순환한다. 후보는 현재 주소·가능한 업스트림 주소·회전하는 다음 번호 하나이며, 같은 번호의
모든 미래 주소를 한 실행에서 검사하지 않는다. cron은 하루 144회다.

- 무료 한도: 하루 Worker 요청 100,000회, 실행당 CPU 10ms, 외부 subrequest 50회.
- `freeFetch`가 **GitHub 읽기/쓰기·신호 조회·후보·redirect hop을 모두 세어** 51번째 호출 전에
  중단한다. 자동 redirect는 금지한다. config의 `limits.subrequests`도 50이다.
- 기존 scan 요청 예산36은 유지한다. GitHub 최초 읽기1 + PUT 최대3 + 충돌 시 재읽기 최대3을
  더해 최대43회이며, 실제 단일 사이트 cron은 후보 최대3 × hop 최대3(+Blacktoon 설정1)라
  이보다 적다. 7개 cron slot에서 redirect·충돌을 함께 발생시키는 테스트로 검증한다.
- CPU는 Free의 플랫폼 10ms 제한을 그대로 사용한다. I/O 대기는 CPU 시간에 포함되지 않으며,
  실제 계정에서 `exceededCpu`가 발생하면 실패로 보존한다. 유료 플랜이나 CPU 증액으로 해결하지
  않는다. 실제 CPU 시간과 Cloudflare origin 성공은 배포 후 로그로 확인할 미완료 검증이다.
- 별도 KV/D1/R2/Browser Rendering/Queues 및 결제 수단은 필요 없다. 영구 상태는 기존
  GitHub `domains.json`이다. 무료 한도에 도달하면 실패 처리하고 마지막 정상 주소를 유지한다.
- schema(baseUrl/status/lastConfirmedAt/attempts 등), 운영자 control.revision,
  최신 확인 시각 우선, GitHub SHA 충돌 재읽기/병합 규칙은 그대로 유지한다.

## 외부 설정: 클릭 순서 (토큰 값은 작업창에 보내지 않음)

1. Cloudflare 계정 인증 메일의 **Verify email address**를 눌러 본인 이메일 인증을 완료한다.
   대시보드 → Workers & Pages → 플랜/사용량에서 **Workers Free**인지 확인한다.
   유료 전환·카드 입력 화면이 나오면 중단한다. 이 작업에 카드 등록은 필요 없다.
2. ChatGPT Cloudflare 연결을 다시 인증할 때 대상 계정의 Workers Editor(또는
   Workers Scripts Write) 권한을 허용한다. 조회만 되는 권한으로는 업로드가 안 된다.
   직접 API 토큰으로 배포할 경우 Cloudflare 프로필 → My Profile → API Tokens → Create Token
   → Edit Cloudflare Workers에서 대상 계정만 제한한다. 토큰 값은 공유하지 않는다.
   로컬 배포용 이름은 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`이며 이번 PR은
   GitHub Actions에 Cloudflare 배포 토큰을 요구하지 않는다.
3. GitHub 프로필 → Settings → Developer settings → Personal access tokens → Fine-grained tokens
   → Generate new token. Resource owner `daeokim` → Only select repositories → `my-mangayomi`만
   선택 → Repository permissions → Contents: Read and write, Metadata: Read → 만료일 설정.
   토큰은 직접 보관하고 만료 전에 갱신한다. 앱 저장소·Administration·Secrets 권한은 불필요하다.
4. Cloudflare Workers & Pages에서 `daeo-domain-manager`를 만들고 **머지된** `worker.mjs`를
   배포한다(또는 본인 터미널에서 domain-manager로 이동 → `npx wrangler login` →
   `npx wrangler deploy`). 초기 빈 Worker에는 cron을 활성화하지 않는다.
   Worker → Settings → Variables and Secrets → Add → Type **Secret**, Name **GITHUB_TOKEN**,
   Value는 위 GitHub 토큰을 본인이 직접 입력 → Deploy. 평문 변수로 넣지 않는다.
   `GITHUB_REPOSITORY=daeokim/my-mangayomi`, `GITHUB_BRANCH=main`은 일반 변수다.
   `ADMIN_TOKEN`은 웹 관리자 사용 시에만 24자 이상 난수를 Secret으로 등록한다.
5. Worker → Settings → Triggers → Cron Triggers에 `*/10 * * * *`를 설정한다(Wrangler 배포 시
   config와 일치 확인). Logs에서 checker=cloudflare/site/status/lastConfirmedAt과 GitHub 저장,
   CPU 제한 초과 없음, 세 사이트 실제 목록 검증을 확인한다. 이 확인이 끝난 뒤에만 GitHub
   my-mangayomi → Settings → Secrets and variables → Actions → Variables → New repository variable
   → Name `DOMAIN_CHECK_BACKEND`, Value `cloudflare`로 저장한다. 그전에는 미설정/actions 유지.

Worker의 PAT 커밋은 main push를 발생시켜 기존 Pages를 배포한다. Actions는 전환 후 네트워크
검사/저장만 생략하고 metadata·테스트·Pages를 유지한다. my-mangayomi에는 PR 강제 보호를
걸지 않는다. 중단 시 Worker cron을 끄고 DOMAIN_CHECK_BACKEND를 actions로 되돌린다.

## 검증 명령

```sh
node --test domain-manager/*.test.mjs
node --test domain-manager/*.test.mjs domain-manager/test.mjs
python -m unittest discover -s domain-manager -p 'test_sync_metadata.py'
bash aniyomi/native/gradlew -p aniyomi/native :anilife:testReleaseUnitTest :anilife:assembleRelease
```

공식 무료 한도/설정 근거:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens

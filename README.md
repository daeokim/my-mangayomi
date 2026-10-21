# my-mangayomi

개인용 Mangayomi JS · Aniyomi APK 확장 저장소입니다.

## 저장소 등록

| 앱 | 등록할 칸 | 주소 |
|---|---|---|
| Mangayomi | Manga repo | https://daeokim.github.io/my-mangayomi/index.json |
| Mangayomi | Anime repo | https://daeokim.github.io/my-mangayomi/anime_index.json |
| Aniyomi | 만화 확장 앱 저장소 | https://daeokim.github.io/my-mangayomi/aniyomi/manga/index.min.json |
| Aniyomi | 애니메이션 확장 앱 저장소 | https://daeokim.github.io/my-mangayomi/aniyomi/media/index.min.json |

Aniyomi는 **Daeo Manga 1.4.1003**, **Daeo TVRoom 14.1004**, **Daeo TVWiki 14.1002**을 설치합니다.
만화는 11툰·블랙툰·굿툰, 영상은 티비룸 기반 DC 영화·드라마·예능·애니입니다.
티비위키는 별도 APK로 영화·드라마·예능·애니 소스를 제공합니다. 앱의 성인 콘텐츠 소스 설정을 켜야 확장이 표시될 수 있습니다.
Daeo TVRoom은 기존 Daeo Media와 패키지·서명·소스 ID가 같으므로 **기존 앱 위에 업데이트**합니다.
Daeo TVWiki는 다른 패키지와 고유 소스 ID를 사용하므로 티비룸과 동시에 설치할 수 있습니다.

- [티비룸 APK 14.1004](https://daeokim.github.io/my-mangayomi/aniyomi/media/apk/daeotvroom-v14.1004.apk)
- [티비위키 APK 14.1002](https://daeokim.github.io/my-mangayomi/aniyomi/media/apk/daeotvwiki-v14.1002.apk)

추가 소스는 아래의 별도 APK를 설치합니다. 기존 Daeo Manga·TVRoom·TVWiki와 함께 사용할 수 있습니다.

| 소스 | 설치할 저장소 | 버전 | APK |
|---|---|---|---|
| 애니24 | 애니메이션 확장 앱 저장소 | 14.1002 | [다운로드](https://daeokim.github.io/my-mangayomi/aniyomi/media/apk/daeoani24-v14.1002.apk) |
| 애니라이프 | 애니메이션 확장 앱 저장소 | 14.1002 | [다운로드](https://daeokim.github.io/my-mangayomi/aniyomi/media/apk/daeoanilife-v14.1002.apk) |
| 네이버 웹툰 | 만화 확장 앱 저장소 | 1.4.1001 | [다운로드](https://daeokim.github.io/my-mangayomi/aniyomi/manga/apk/daeonaver-v1.4.1001.apk) |

티비위키·애니24·애니라이프 **14.1002**는 티비룸 14.1004와 같은 Chromium Cronet 143 엔진을 포함합니다.
목록·상세·회차·세션 API와 확장이 직접 읽는 HLS 목록을 Cronet으로 요청합니다. HTTP/2·QUIC·Brotli를 켜고 TLS 인증서 검증을 유지합니다.
기존 패키지·서명·소스 ID를 유지하므로 삭제 없이 업데이트할 수 있습니다. 엔진 포함으로 APK 용량이 늘어납니다.
Aniyomi 자체 이미지 로더와 외부 플레이어의 연결 방식은 별개이며, 앱의 OkHttp용 DNS/DoH·프록시 설정은 이 Cronet 연결에 자동 적용되지 않습니다.
통신사·IP 차단까지 해결되는 것은 아니므로 WG를 끈 휴대폰에서 목록·회차·재생을 확인해야 합니다. 실기기 WG 해제 검증은 아직 수행하지 않았습니다.

확장 목록을 새로고침한 뒤 설치합니다. 네이버는 정식 웹툰·베스트도전·도전만화와 검색·요일·장르 필터를 지원합니다.
로그인·연령 확인·구매가 필요한 네이버 회차는 제한 안내를 표시합니다. 새 세 소스의 고유 ID는 기존 다른 확장과 별개이므로 다른 확장의 보관함을 자동으로 이전하지 않습니다.

원본 DC APK와 패키지·서명이 다르므로 동시에 설치하면 소스 ID가 중복될 수 있습니다.
보관함·설정을 백업하고 사용할 패키지 하나를 선택하세요.

## Mangayomi 확장

| 이름 | 버전 | 예비 주소 | 앱 최소 버전 |
|---|---|---|---|
| 11toon 만화 | 0.1.16 | https://11toon.com | 0.9.2 |
| 굿툰 | 0.1.15 | https://goodtoon008.com | 0.9.2 |
| 블랙툰 | 0.1.19 | https://blacktoon425.com | 0.9.2 |
| 티비룸 | 0.1.31 | https://tvroom40.org | 0.9.9 |
| 티비위키 | 0.1.18 | https://tvwiki55.net | 0.9.9 |
| 티비룸 · 예능 | 0.1.31 | https://tvroom40.org | 0.9.9 |
| 티비룸 · 영화 | 0.1.31 | https://tvroom40.org | 0.9.9 |
| 티비룸 · 드라마 | 0.1.31 | https://tvroom40.org | 0.9.9 |
| 티비룸 · 애니 | 0.1.31 | https://tvroom40.org | 0.9.9 |
| 티비위키 · 예능 | 0.1.18 | https://tvwiki55.net | 0.9.9 |
| 티비위키 · 영화 | 0.1.18 | https://tvwiki55.net | 0.9.9 |
| 티비위키 · 드라마 | 0.1.18 | https://tvwiki55.net | 0.9.9 |
| 티비위키 · 애니 | 0.1.18 | https://tvwiki55.net | 0.9.9 |
| 애니24 | 0.1.0 | https://ohli24.net | 0.9.9 |
| 애니라이프 | 0.1.0 | https://anilife01.tv | 0.9.9 |

이 표는 자동 갱신됩니다. 실제 자동 조회 주소와 상태는 [공통 주소 목록](https://daeokim.github.io/my-mangayomi/domains.json)을 확인하세요.

Mangayomi Anime repo에는 기존 티비룸·티비위키 통합 소스와 별개로 각 사이트의 **예능·영화·드라마·애니** 전용 소스가 표시됩니다. 전용 소스의 인기·최신·검색은 선택한 분류로 고정됩니다.
티비위키 영화는 영화·한국영화, 드라마는 국내·해외·숏폼·추억의 드라마, 예능은 일반·해외·추억의 예능, 애니는 일반·극장판을 포함합니다. 여러 게시판의 같은 페이지를 순서대로 합치며 사이트 전체 순위를 재정렬하지 않습니다.
기존 통합 소스의 ID와 작품·회차 경로는 유지합니다. 새 전용 소스는 별도 ID이므로 통합 소스의 보관함·시청 기록이 자동 이동하지 않습니다. 기존 보관함은 통합 소스로 계속 이용할 수 있습니다.
애니24·애니라이프는 별도 Mangayomi JS 소스이며 APK 설치가 필요 없습니다. 목록 새로고침 후 원하는 소스를 설치하세요. 애니24는 방영중·완결·극장판·요일·장르·정렬, 애니라이프는 장르·연도·상태·요일·정렬을 지원합니다.
애니라이프는 사이트 재생 세션을 발급받고 회차 API에만 세션 헤더·쿠키를 보냅니다. 영상 CDN에는 세션 자격정보를 전달하지 않습니다. 재생 요청의 리다이렉트는 따르지 않으며 세션 오류 시 한 번 갱신합니다.
새 JS의 분류·API·회차·HLS·세션 처리는 합성 응답으로 검사합니다. 이 작업 환경에서는 외부 사이트가 403으로 차단되어 실제 목록·전체 재생과 Android Mangayomi 실기기는 검증하지 못했습니다.
카테고리 JS와 신규 애니 JS는 `python domain-manager/build_sources.py`로 생성하며, 템플릿과 통합 엔진을 수정합니다. 주소 자동 동기화는 전용 소스·신규 애니 소스의 목록·버전·README도 함께 갱신합니다.

## 주소 자동 갱신

- **Mangayomi:** 확장을 업데이트하고 각 소스의 **주소 직접 지정**을 비웁니다. 직접 입력한 값이 있으면 자동 주소보다 우선합니다.
- **Aniyomi 만화:** 블랙툰의 **주소 갱신 방식 → 중앙신호등**을 선택합니다. 11툰·굿툰은 별도 모드 설정 없이 공통 목록을 조회합니다.
- **Aniyomi 영상:** Daeo TVRoom과 Daeo TVWiki가 공통 목록의 각 사이트 주소를 읽습니다. 주소 번호 변경마다 APK를 재설치할 필요는 없습니다.
- **애니24·애니라이프:** 공통 목록에서 주소를 읽고 10분간 캐시합니다. 주소 조회 실패 시 마지막 유효 주소를 유지하며, 이전 번호·다른 사이트 주소는 거부합니다. 네이버는 공식 고정 주소 `comic.naver.com`을 사용합니다.

GitHub Actions는 **6시간마다 (한국 시간 03:17·09:17·15:17·21:17)**에 실행되도록 설정되어 있습니다. 예약 실행은 지연·누락될 수 있으며 실시간 감지가 아닙니다.
중앙 후보 → 기존 주소 → 다음 번호 +1~+10 순으로 확인하며, 기존 주소가 정상인 경우 번호 탐색을 끝냅니다.
사이트 이름·목록 구조 등을 확인한 주소만 저장합니다. 티비룸은 메뉴 링크를 제외하고 작품 카드의 링크·제목·이미지를 확인합니다. 실패하면 기존 주소를 유지하고 `protected`로 표시합니다.
상태 화면과 Actions 요약에서 현재 주소와 후보별 점검 결과, 연속 실패 횟수, 마지막 정상 확인 후 경과 시간을 확인합니다.
실패 횟수는 새 집계 시작 이후부터 누적하고 정상 확인 시 0으로 초기화합니다. 12시간 이상 점검이 없으면 상태 화면에서 안내합니다.
티비룸 0.1.31은 자동 주소·캐시가 현재 예비 주소보다 이전 번호이면 사용하지 않습니다. 직접 지정한 주소는 유지합니다.
확인된 주소는 Mangayomi JS 예비 주소·버전·목록·위 표에 동기화한 뒤 Pages에 배포합니다.

앱 캐시로 반영이 늦어질 수 있습니다. Mangayomi 블랙툰은 1분, 티비위키는 5분,
Aniyomi 11툰·굿툰은 5분, 영상은 10분 캐시를 사용합니다.
자동 주소 조회와 확장 업데이트는 별개입니다. 앱의 표시용 예비 주소까지 갱신하려면 확장 목록을 새로고침하고 업데이트하세요.
Aniyomi 영상 APK의 예비 주소는 티비룸 40·티비위키 54입니다. 실제 조회 주소는 공통 목록을 따릅니다.
티비위키는 HTTPS 호스트·최소 주소 번호·번호 역행을 검사하며 주소 목록 조회가 실패하면 마지막 유효 주소를 유지합니다.

- [주소 상태 화면](https://daeokim.github.io/my-mangayomi/domain-manager/)
- [즉시 점검·실행 기록](https://github.com/daeokim/my-mangayomi/actions/workflows/domains.yml): **Run workflow → all 또는 사이트 선택 → Run workflow**
- 사이트 차단·구조 변경·+10을 넘는 주소 이동은 자동으로 복구하지 못할 수 있습니다.
- 주소 확인은 이미지·영상 재생 확인과 다릅니다. Android 실기기 설치·재생은 별도 검증이 필요합니다.

## 제공된 DC Mangayomi 저장소와 비교

[비교 원본](https://dc-manhwa-29bc3f.espr.page/mangayomi/index.json)을 2026-10-16에 확인했습니다.
애니24 1.1.0·애니라이프 1.0.0·네이버 웹툰 1.0.2의 요청 방식과 응답 구조를 확인해 Aniyomi용으로 구현했습니다.
Mangayomi의 JavaScript를 APK로 그대로 설치하는 방식이 아니며, 기존 Mangayomi 확장 목록은 유지합니다.

| 기존 소스 | 주소 비교 | 동일한 실제 목록 응답을 두 Mangayomi 파서로 비교한 결과 |
|---|---|---|
| 11툰 | 원본 `www.11toon.com` / 개인 `11toon.com` | 101개 작품의 경로·제목·순서·표지 주소 일치 |
| 굿툰 | 양쪽 `goodtoon007.com` (이전 공통 목록은 `www` 표기) | 63개 작품의 경로·제목·순서·표지 주소 일치 |
| 블랙툰 | 양쪽 `blacktoon424.com` | 검사 환경에서 홈·설정 파일이 `Site Unavailable`을 반환해 목록 일치 여부 미확정 |

위 결과는 수집한 목록 응답 기준이며, 전체 작품·모든 회차·이미지 본문 또는 Android의 실제 실행을 비교한 결과는 아닙니다.
개인 저장소에는 자동 주소 조회·캐시 보호·탭 규칙·안내 카드 등 별도 기능이 있어 기본 화면과 정렬이 다를 수 있습니다.
소스 ID와 버전 체계도 서로 다르므로 버전 숫자만으로 최신 여부를 판단하지 않습니다.
원본 파일 URL·SHA-256·검사 범위는 [비교 기록](aniyomi/upstream-comparison.json)에 있습니다.

## 검사와 유지관리

```sh
node --test domain-manager/test.mjs domain-manager/actions.test.mjs domain-manager/status.test.mjs tests/extensions.test.cjs
python -m unittest discover -s domain-manager -p 'test_sync_metadata.py'
python aniyomi/tools/verify_selected.py
```

APK 검사는 `androguard==4.1.4`가 필요합니다. 빌드 입력·출력 해시는 [빌드 기록](aniyomi/build-report.json)에 있습니다.
재빌드는 `aniyomi/tools/prepare_selected.py`와 `connect_registry.py`, 서명은 `SignSelected.java`를 사용합니다.
원본 APK·도구는 코드의 고정 SHA-256과 일치해야 하며, 기존 업데이트에는 동일한 개인 서명 키가 필요합니다.
티비룸 14.1004는 `prepare_tvroom.py`로 기존 14.1003을 갱신합니다. 기존 보관함 연결을 위해 DC 소스 이름과 ID를 유지합니다.
티비위키 소스는 `aniyomi/native`에 있으며 JDK 17·Android SDK 35 환경에서 아래 명령으로 빌드·검사합니다.

```sh
bash aniyomi/native/gradlew -p aniyomi/native :tvwiki:assembleRelease :tvwiki:testReleaseUnitTest
```

빌드 워크플로는 서명 전 APK와 테스트 보고서를 보관합니다. 배포 APK에는 기존 개인 서명을 사용합니다.
애니24·애니라이프·네이버 모듈은 각각 `:ani24:assembleRelease`, `:anilife:assembleRelease`, `:naver:assembleRelease`로 빌드합니다.
검사는 각 모듈의 `:testReleaseUnitTest` 작업과 `:common:testReleaseUnitTest`로 실행합니다. CI는 네 소스 모듈과 공통 모듈을 함께 빌드·검사합니다.
실제 애니24·애니라이프 목록·상세·회차·플레이어 API·HLS 재생목록과 네이버 무료 회차의 이미지 목록을 확인했습니다.
애니24 제목에 `?`가 포함된 작품도 누락하지 않으며, 애니라이프는 재생 세션·쿠키·전용 헤더를 처리합니다. 네이버 회차 목록은 전체 페이지를 최대 4개 요청씩 수집합니다.
실제 응답 파일은 저장소에 포함하지 않습니다. 선택 검사 `DAEO_OCT16_FIXTURES`가 없는 CI에서는 합성 테스트를 실행하고 캡처 응답 검사는 건너뜁니다.
세 신규 APK의 Android 실기기 설치·전체 재생·전체 회차 열람은 아직 검증하지 않았습니다.
티비룸 배포 델타는 서명 완료 파일을 복원하며, 입력·델타·출력 SHA-256을 검사한 뒤 GitHub에 커밋합니다.
동일한 주소 점검 워크플로에서 최신 커밋을 다시 체크아웃하고 Pages에 배포합니다. 개인 서명 키는 GitHub에 업로드하지 않습니다.
티비위키는 사이트 직접 세션과 휴대폰 내부 HLS 중계를 사용합니다. 외부 복구 중계 서버는 사용하지 않습니다.
합성 HLS·키·Range 검사와 실제 사이트의 목록·회차·세션·재생목록을 확인했습니다. 티비위키 버전 7 키 형식은 독립 참조 결과와 비교하고 짧은 실제 영상 구간의 해독도 검증했습니다. Android 실기기의 설치·전체 영상 재생은 아직 검증하지 않았습니다.
원본 제작자의 새 APK는 자동 재빌드되지 않습니다. 서명 키는 저장소에 포함하지 않습니다.

## 원본 출처

- [DC Mangayomi 만화](https://dc-toki-mangayomi-manga.pages.dev)
- [DC Mangayomi 영상](https://dc-toki-mangayomi-media.pages.dev)
- [DC Aniyomi 만화](https://dc-toki-aniyomi-manga.pages.dev)
- [DC Aniyomi 영상](https://dc-toki-aniyomi-media.pages.dev)

기존 코드·리소스의 저작권은 원저작자에게 있습니다. 일부 영상 재생과 보조 정보는 원본 외부 서버에 의존합니다.

# my-mangayomi

개인용 Mangayomi JS · Aniyomi APK 확장 저장소입니다.

## 저장소 등록

| 앱 | 등록할 칸 | 주소 |
|---|---|---|
| Mangayomi | Manga repo | https://daeokim.github.io/my-mangayomi/index.json |
| Mangayomi | Anime repo | https://daeokim.github.io/my-mangayomi/anime_index.json |
| Aniyomi | 만화 확장 앱 저장소 | https://daeokim.github.io/my-mangayomi/aniyomi/manga/index.min.json |
| Aniyomi | 애니메이션 확장 앱 저장소 | https://daeokim.github.io/my-mangayomi/aniyomi/media/index.min.json |

Aniyomi는 **Daeo Manga 1.4.1003**, **Daeo Media 14.1003**을 설치합니다.
만화는 11툰·블랙툰·굿툰, 영상은 티비룸 기반 DC 영화·드라마·예능·애니입니다.
티비위키는 Mangayomi에만 포함됩니다. 앱의 성인 콘텐츠 소스 설정을 켜야 확장이 표시될 수 있습니다.
원본 DC APK와 패키지·서명이 다르므로 동시에 설치하면 소스 ID가 중복될 수 있습니다.
보관함·설정을 백업하고 사용할 패키지 하나를 선택하세요.

## Mangayomi 확장

| 이름 | 버전 | 예비 주소 | 앱 최소 버전 |
|---|---|---|---|
| 11toon 만화 | 0.1.16 | https://11toon.com | 0.9.2 |
| 굿툰 | 0.1.14 | https://goodtoon007.com | 0.9.2 |
| 블랙툰 | 0.1.18 | https://blacktoon424.com | 0.9.2 |
| 티비룸 | 0.1.30 | https://tvroom40.org | 0.9.9 |
| 티비위키 | 0.1.17 | https://tvwiki54.net | 0.9.9 |

이 표는 자동 갱신됩니다. 실제 자동 조회 주소와 상태는 [공통 주소 목록](https://daeokim.github.io/my-mangayomi/domains.json)을 확인하세요.

## 주소 자동 갱신

- **Mangayomi:** 확장을 업데이트하고 각 소스의 **주소 직접 지정**을 비웁니다. 직접 입력한 값이 있으면 자동 주소보다 우선합니다.
- **Aniyomi 만화:** 블랙툰의 **주소 갱신 방식 → 중앙신호등**을 선택합니다. 11툰·굿툰은 별도 모드 설정 없이 공통 목록을 조회합니다.
- **Aniyomi 영상:** Daeo Media가 공통 목록의 티비룸 주소를 읽습니다. 주소 번호 변경마다 APK를 재설치할 필요는 없습니다.

GitHub Actions는 **매일 오전 9:17 한국 시간**에 실행되도록 설정되어 있습니다. 예약 실행은 지연·누락될 수 있으며 실시간 감지가 아닙니다.
중앙 후보 → 기존 주소 → 다음 번호 +1~+10 순으로 확인하며, 기존 주소가 정상인 경우 번호 탐색을 끝냅니다.
사이트 이름·목록 구조 등을 확인한 주소만 저장합니다. 실패하면 기존 주소를 유지하고 `protected`로 표시합니다.
확인된 주소는 Mangayomi JS 예비 주소·버전·목록·위 표에 동기화한 뒤 Pages에 배포합니다.

앱 캐시로 반영이 늦어질 수 있습니다. Mangayomi 블랙툰은 1분, 티비위키는 5분,
Aniyomi 11툰·굿툰은 5분, 영상은 10분 캐시를 사용합니다.
자동 주소 조회와 확장 업데이트는 별개입니다. 앱의 표시용 예비 주소까지 갱신하려면 확장 목록을 새로고침하고 업데이트하세요.
Aniyomi 영상 APK에 표시되는 예비 주소 38은 실제 공통 목록 조회 결과와 다를 수 있습니다.

- [주소 상태 화면](https://daeokim.github.io/my-mangayomi/domain-manager/)
- [즉시 점검·실행 기록](https://github.com/daeokim/my-mangayomi/actions/workflows/domains.yml): **Run workflow → all 또는 사이트 선택 → Run workflow**
- 사이트 차단·구조 변경·+10을 넘는 주소 이동은 자동으로 복구하지 못할 수 있습니다.
- 주소 확인은 이미지·영상 재생 확인과 다릅니다. Android 실기기 설치·재생은 별도 검증이 필요합니다.

## 검사와 유지관리

```sh
node --test domain-manager/test.mjs domain-manager/actions.test.mjs tests/extensions.test.cjs
python -m unittest discover -s domain-manager -p 'test_sync_metadata.py'
python aniyomi/tools/verify_selected.py
```

APK 검사는 `androguard==4.1.4`가 필요합니다. 빌드 입력·출력 해시는 [빌드 기록](aniyomi/build-report.json)에 있습니다.
재빌드는 `aniyomi/tools/prepare_selected.py`와 `connect_registry.py`, 서명은 `SignSelected.java`를 사용합니다.
원본 APK·도구는 코드의 고정 SHA-256과 일치해야 하며, 기존 업데이트에는 동일한 개인 서명 키가 필요합니다.
원본 제작자의 새 APK는 자동 재빌드되지 않습니다. 서명 키는 저장소에 포함하지 않습니다.

## 원본 출처

- [DC Mangayomi 만화](https://dc-toki-mangayomi-manga.pages.dev)
- [DC Mangayomi 영상](https://dc-toki-mangayomi-media.pages.dev)
- [DC Aniyomi 만화](https://dc-toki-aniyomi-manga.pages.dev)
- [DC Aniyomi 영상](https://dc-toki-aniyomi-media.pages.dev)

기존 코드·리소스의 저작권은 원저작자에게 있습니다. 일부 영상 재생과 보조 정보는 원본 외부 서버에 의존합니다.

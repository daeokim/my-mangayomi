# Aniyomi 개인용 선택 확장

DC 제작자의 기존 배포 APK에서 소스 생성 부분을 수정한 개인용 구성입니다.
사이트 목록·뷰어·재생 엔진은 원본 코드를 사용합니다. 새 Kotlin 확장 엔진을
개발한 프로젝트가 아니며 원본 제작자의 공식 배포판도 아닙니다.

| 구분 | 확장 APK | 포함된 소스 |
|---|---|---|
| 만화 | Daeo Manga 1.4.1001 | 11toon 만화, Blacktoon 웹툰, Goodtoon 웹툰 |
| 영상 | Daeo Media 14.1001 | DC 영화, DC 드라마, DC 예능, DC 애니 |

APK 내부의 생성기가 위 소스만 반환하도록 변경했습니다. 목록 JSON만 숨긴
구성이 아닙니다. 사용하지 않는 원본 코드와 리소스는 APK에 남아 있습니다.
DC 애니라이프·음악프로·시사 및 다른 영상 확장은 등록하지 않습니다.

## 설치

Aniyomi 공식 정식 APK에서 `더 보기 → 설정 → 찾아보기`를 엽니다.

| 등록할 칸 | 주소 |
|---|---|
| 만화 확장 앱 저장소 | https://daeokim.github.io/my-mangayomi/aniyomi/manga/index.min.json |
| 애니메이션 확장 앱 저장소 | https://daeokim.github.io/my-mangayomi/aniyomi/media/index.min.json |

1. 기존 앱의 보관함·설정을 먼저 백업합니다.
2. `성인 콘텐츠 소스 활성화`를 켭니다. 원본 확장의 NSFW 메타데이터를 유지했습니다.
3. 저장소 두 개를 각 칸에 등록하고 확장 목록을 새로고침합니다.
4. `Daeo Manga`와 `Daeo Media`를 설치합니다.
5. 신뢰되지 않음 표시가 있으면 새 서명 인증서를 확인하고 신뢰 처리합니다.
6. 찾아보기의 만화/애니메이션 소스에서 작품을 엽니다.

직접 설치 파일:

- [만화 APK](manga/apk/daeomanga-v1.4.1001.apk)
- [영상 APK](media/apk/daeomedia-v14.1001.apk)

원본 `DC Manga`/`DC Media`와 패키지 이름·서명이 다릅니다. 원본 APK를
덮어쓰지 않습니다. 원본과 동시에 설치하면 같은 소스 ID가 중복되므로
보관함 백업 후 사용할 패키지 하나를 선택하세요. 같은 소스 ID를 보존했지만
Mangayomi의 JS 소스 ID와는 다르므로 앱 간 보관함 자동 이전을 보장하지 않습니다.

## 주소와 실제 재생

굿툰의 기본 도메인 번호를 2에서 7로 바꿨습니다. URL은
`https://www.goodtoon007.com`으로 조합됩니다. 중앙 주소 조회와 기존 설정은
원본 방식으로 동작합니다. 중앙 조회가 이전 주소를 안내하면 굿툰의
`주소 갱신 방식`을 `기존 주소 탐색(+10)`으로 선택하고 `도메인 번호`에
`7`을 입력해 새로고침합니다.

영상의 예비 주소는 `https://tvroom38.org`입니다. DC 영화·드라마·예능·애니
모두 티비룸 기반이며 다른 영상 사이트로 바뀌는 것은 아닙니다.
기존 티비룸 로딩 문제를 이번 작업으로 해결한 것은 아닙니다.

빌드·서명·DEX 구조·등록 소스 검사만 완료했습니다. Android 기기에서
설치·목록·회차·이미지·영상 재생은 아직 검증하지 않았습니다.
사이트 주소, 중앙 신호등, 원본 외부 서비스가 중단되면 이 APK도 영향을 받습니다.

## 빌드와 업데이트

`tools/prepare_selected.py`는 SHA-256을 고정한 원본 APK 두 개만 처리합니다.
DEX의 소스 생성 부분, 굿툰 기본값, 티비룸 예비 주소와 Android 메타데이터를
수정하고 DEX 체크섬을 다시 계산합니다. 원본이 바뀌면 검사가 중단됩니다.

재현 시 `tools` 폴더에 아래 원본을 각각 `dc-manga-original.apk`,
`dc-media-original.apk`로 다운로드하고 `androguard==4.1.4`를 설치합니다.
`python prepare_selected.py` 실행 후 `output` 폴더에 서명 전 APK가 생성됩니다.

- [원본 만화 APK](https://dc-toki-aniyomi-manga.pages.dev/apk/tachiyomi-ko.dcmanga-v1.4.6-release.apk)
- [원본 영상 APK](https://dc-toki-aniyomi-media.pages.dev/apk/aniyomi-ko.dctvroom-v14.10-release.apk)
- [Android 공식 apksig 8.9.0](https://dl.google.com/dl/android/maven2/com/android/tools/build/apksig/8.9.0/apksig-8.9.0.jar)

`SignSelected.java`는 공식 apksig 라이브러리를 이용합니다. 동일한 개인용
서명 키를 이용하고 APK·목록의 버전 코드를 함께 증가시켜야 업데이트됩니다.
개인 서명 키는 이 공개 저장소에 포함하지 않습니다. 원본 제작자의 새 APK가
배포되어도 이 선택 구성은 자동 재빌드되지 않습니다.

## 검증

```sh
python tools/verify_selected.py
java --class-path apksig-8.9.0.jar tools/SignSelected.java verify manga/apk/daeomanga-v1.4.1001.apk
java --class-path apksig-8.9.0.jar tools/SignSelected.java verify media/apk/daeomedia-v14.1001.apk
```

`build-report.json`에 입력·출력 APK 해시와 검증 범위를 기록했습니다.

## 출처

- [DC 제작자의 앱 안내](https://github.com/wankyo83/rabbit-auth-server-releases/blob/main/Extension-App-Guide-KO.md)
- [원본 영상 목록](https://dc-toki-aniyomi-media.pages.dev/index.min.json)
- [원본 만화 목록](https://dc-toki-aniyomi-manga.pages.dev/index.min.json)
- [Aniyomi 공식 설치 안내](https://aniyomi.org/docs/guides/getting-started)

기존 엔진·리소스의 저작권과 원본 출처는 원저작자에게 있습니다.

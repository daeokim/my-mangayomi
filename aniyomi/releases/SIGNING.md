# 확장 키 전환과 배포

기존 확장은 서명 불일치로 업데이트되지 않음. 한 번 삭제 후 재설치 필요, 서재·기록은 유지.
앱 키는 사용하지 않는다. 모든 현재 확장의 기대 인증서 SHA-256은
`71d5e7b6fc35c90e4dae3c98e2e0001a545376eb52565fa743b49e8017eeb8c3`이다.

## 현재 구조와 전환

이전 `aniyomi-native.yml`은 native 4개의 테스트/미서명 artifact만 제공했다.
`domains.yml`은 `materialize_release.py --publish`로 옛 서명 델타 4개를 복원했다.
전환 후 주소 작업은 APK를 복원/게시하지 않는다. 옛 APK와 `release.json`/bsdiff는
그대로 보존하며, 새 배포의 입력 복원에만 해시 검증 후 사용한다.

main의 native/tools 변경은 Build and test → publish 순서로 실행된다.
PR에는 Secrets와 쓰기 권한을 주지 않는다. main의 publish만 다음 Secrets를 사용한다:
`EXT_SIGNING_KEYSTORE_BASE64`, `EXT_SIGNING_STORE_PASSWORD`, `EXT_SIGNING_KEY_ALIAS`,
`EXT_SIGNING_KEY_PASSWORD`. 별칭은 `dtoon-ext`이다.
누락된 이름은 명확한 오류로 중단하고 값은 출력하지 않는다. 임시 키는 Python의
TemporaryDirectory로 성공/실패 시 제거한다. keytool로 키 인증서부터 검증한다.

첫 실행은 native Naver 1002/1.4.1002, TVWiki·Ani24·AniLife 1003/14.1003을 빌드한다.
DaeoManga는 1004/1.4.1004, TVRoom은 1005/14.1005로 manifest 버전만 바꾸며
DEX/resources의 모든 바이트를 보존한다. ZIP 재작성으로 기존 APK Signing Block과
META-INF 서명을 제거한 뒤 zipalign(16KiB native alignment), apksigner v2/v3 서명을 한다.
새 패키지/버전·debuggable·서명 지문을 검증하고 기존 `verify_selected.py`로
소스 ID·factory·DEX 무결성을 여섯 개 모두 검사한 후에만 게시한다.

새 APK·두 index/repo.json·누적 SHA256SUMS·signed-state.json을 한 Git 커밋으로 게시한다.
새 APK SHA-256은 각 index의 `sha256`에도 기록한다. 기존 파일명/체크섬은 덮어쓰지 않는다.
동시에 저장된 주소는 최신 catalog의 source 주소를 유지하여 합치고, 소스 ID/lang/nsfw 변경,
진행 중 native/tools 변경, 이미 사용 중인 파일명은 게시를 중단한다.
main의 업데이트는 force=false이며 주소와 충돌하면 최신 상태에서 최대 3회 재시도한다.
GITHUB_TOKEN 커밋은 push 이벤트를 재발생시키지 않으므로 동일 작업에서 깨끗한 새 checkout의
커밋된 파일만 Pages에 배포한다. Pages/주소 작업과 같은 concurrency 그룹을 사용한다.

새 APK는 최대 약 25MB이며 GitHub의 일반 파일 저장 범위 안이다. 새 서명 결과를 완전한
불변 APK로 추가하므로 새 델타는 필요 없다. 중복 저장 공간은 늘지만 델타 연쇄·옛 서명 의존을
새 배포에서 제거하고 결과를 직접 검사할 수 있다. 과거 델타/파일은 삭제하지 않는다.

## 이후 수정

변경한 native 모듈의 build.gradle versionCode와 versionName을 올린 PR을 연다.
공용 common/api/루트 Gradle 변경은 관련 모듈 모두, cronet 변경은 media 3개 모두 올린다.
동일 버전의 입력 digest가 달라지면 게시가 실패한다. 기존 버전은 다시 서명하거나 덮어쓰지 않는다.
main 머지는 사용자가 수행한다. publish 실패 시 해당 로그의 오류 원인을 고치고 최신 main에서 재실행한다.
완료 판정은 Actions 성공만으로 하지 않고 Pages의 index/repo.json과 APK를 받아
SHA-256, apksigner 인증서·버전·패키지를 다시 대조한다.

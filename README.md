# my-mangayomi# my-mangayomi

개인용 Mangayomi 확장 저장소입니다.

## 저장소 주소

앱에서 More → Settings → Browse 로 이동한 뒤, 아래 주소를 각 칸에 입력합니다.

| 구분 | 입력할 칸 | 주소 |
|---|---|---|
| 만화 | Manga repo | `https://daeokim.github.io/my-mangayomi/index.json` |
| 영상 | Anime repo | `https://daeokim.github.io/my-mangayomi/anime_index.json` |

## 포함된 소스

### 만화 — `index.json`

| 이름 | 버전 | 주소 | 앱 최소 버전 |
|---|---|---|---|
| 11toon 만화 | 0.1.12 | https://11toon.com | 0.9.2 |
| 굿툰 | 0.1.9 | https://goodtoon003.com | 0.9.2 |

### 영상 — `anime_index.json`

| 이름 | 버전 | 주소 | 앱 최소 버전 |
|---|---|---|---|
| 티비룸 | 0.1.22 | https://tvroom36.org | 0.9.2 |
| 티비위키 | 0.1.8 | https://tvwiki51.net | 0.9.3 |

## 폴더 구조

```
my-mangayomi/
├── index.json                  만화 소스 목록
├── anime_index.json            영상 소스 목록
└── javascript/
    ├── 11toon.js
    ├── goodtoon.js
    └── anime/
        ├── tvroom.js
        └── tvwiki.js
```

## 주소가 바뀌었을 때

사이트 도메인은 수시로 변경됩니다. 목록이 비어 있거나 접속이 되지 않으면
대부분 주소가 바뀐 경우이며, 아래 순서로 직접 수정합니다.

1. 브라우저에서 기존 주소를 열어 이동된 새 주소를 확인합니다.
2. 해당 소스가 들어있는 index 파일을 엽니다.
   - 만화 → `index.json`
   - 영상 → `anime_index.json`
3. 그 소스의 `baseUrl` 값을 새 주소로 바꾸고 커밋합니다.
   끝의 쉼표(`,`)를 지우지 않도록 주의합니다.
4. 1~2분 뒤 앱에서 저장소를 새로고침하고 소스를 재설치합니다.

> 같은 사이트의 번호만 바뀌는 경우(`tvroom32` → `tvroom36`)는 이 방법으로
> 해결됩니다. 다른 사이트로 바꾸려면 주소만으로는 되지 않으며,
> 해당 사이트 전용 확장이 따로 필요합니다.

## 참고 사항

- 만화 소스 두 개는 `isNsfw: true` 입니다. 앱에서 NSFW 소스 표시를
  꺼두면 목록에 나타나지 않습니다.
- `appMinVerReq` 보다 앱 버전이 낮으면 확장이 로드되지 않습니다.
  현재 기준 최소 **0.9.3** 이상을 권장합니다.
- index 파일은 반드시 대괄호 `[ ]` 로 감싼 배열이어야 합니다.

## 출처

- 만화: https://dc-toki-mangayomi-manga.pages.dev
- 영상: https://dc-toki-mangayomi-media.pages.dev

개인 사용 목적으로 복사했으며, 각 확장의 저작권은 원저작자에게 있습니다.

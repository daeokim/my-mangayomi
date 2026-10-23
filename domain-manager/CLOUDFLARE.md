# Worker 배포

배포 설정은 PR 머지 후 사용자가 Cloudflare Workers Builds의 GitHub 연동에서 직접 관리한다.

- Root directory: `domain-manager`
- Deploy command: `npx wrangler deploy`

이 PR의 Worker는 `wrangler.jsonc`의 cron으로 사이트를 순환 점검하고,
기존 `domains.json` 형식과 GitHub SHA 충돌 재시도 규칙을 유지한다.
요청 수 상한과 검증 결과는 PR 설명 및 저장소 테스트에서 확인한다.

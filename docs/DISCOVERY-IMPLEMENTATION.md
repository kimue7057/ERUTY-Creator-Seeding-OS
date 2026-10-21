# STEP 3 구현 및 실증 상태

기준: PRD v1.2, STEP-3-DATA-MCP-DESIGN, STEP-3-PR-PLAN. 기존 STEP 1–2와 STEP 4–5 기획을 변경하지 않는다.

실증 근거 확인: 저장소 PHASE-0-RESULTS는 Instagram/TikTok/YouTube 각각 not_tested, hosted Work MCP 쓰기는 unverified다. 비공개 로컬 checkpoint도 실제 OAuth 로그인·Work 도구 응답·독립 read-back이 미검증이며 실제 proof receipt 파일은 없다. 현재 Codex 도구 목록에 ERUTY 플러그인의 세 도구가 없다. 따라서 SNS 직접 발굴/Work 연결의 성공 근거는 확보하지 못했다. 로컬 Tunnel/metadata/SDK 테스트를 실제 Work 결과로 대체하지 않는다.

사용자가 STEP 3 실기능 구현을 요청하여 실증 의존성 미충족 상태의 **로컬 구현 Draft**를 준비한다. STEP-3-PR-PLAN의 플랫폼 pass / Work write_verified 조건은 완료·배포 판정의 미충족 항목으로 유지한다. 원본 후보·private trace·receipt·OAuth 정보를 Public GitHub에 넣지 않는다.

| 범위 | 구현 상태 | 실제 Work 수용 기준 |
| --- | --- | --- |
| Phase A / discovery-schema-01 | additive 0004: runs/accounts/evidence/campaign links/logs, aliases/reviews/requests/capability receipts. DB 조직·플랫폼·캠페인 scoped FK, 불변 이력/context, 안정 ID/활성 별칭 unique | 미충족. migration은 기존 캠페인/브리프/파일을 바꾸거나 실제 발견/실증 성공 행을 만들지 않는다 |
| Phase B / discovery-core-01 | 후속 PR | 실제 관찰 형태/플랫폼별 제약 추가 검증 필요 |
| Phase C / discovery-mcp-01 | 후속 PR | hosted Work 원본 SNS 검색 1명→인증 MCP→독립 PostgreSQL 검증 미완료 |
| Phase D / discovery-ui-01 | 후속 PR | 실제 Work 데이터 표시 검증 미완료 |

0004는 Drizzle 모델에 더해 scoped self-FK 및 이력/상태 변경 trigger를 명시 SQL로 관리한다. 과거 evidence/log/review/request/capability는 UPDATE/DELETE를 거절한다. run은 context 수정/삭제/종료 후 재쓰기를 거절하고 lock_version 증가와 상태 전이를 검사한다. 별칭은 폐쇄(valid_to 최초 설정)만 허용한다. 별도 보존/삭제 정책은 이번 범위가 아니다.

마이그레이션 검증은 빈 독립 DB 및 기존 0000–0003 데이터에서 수행한다. 기존 파일 ID/version/브리프 JSON과 campaign asset reference를 보존하고, 조직·플랫폼·캠페인 간 FK 위반과 이력 덮어쓰기를 PostgreSQL에서 차단하는지 검사한다. 모든 테스트 후보는 합성 fixture이며 SNS 접속 증거가 아니다.

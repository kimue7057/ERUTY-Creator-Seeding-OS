# STEP 3 시작 계획 — 작은 PR과 실제 실험 gate

작성: 2026-10-21. STEP 1–2 **로컬 MVP 검증 완료**를 유지한다. STEP 3 실행/DB/MCP는 설계 상태다. PRD v1.2의 STEP 1–4 및 STEP 5 고정 디자인+AI 내용 생성 방향을 바꾸지 않는다. 아래는 후속 작업 계획이며 기능을 구현했다고 표시하지 않는다.

## 순서와 수용 기준

| 작업 / 예상 branch | 한 PR의 범위 | 시작 의존성 | 완료 근거 / 제외 범위 |
| --- | --- | --- | --- |
| discovery-00-prep / docs/discovery-00-prep | 이번 문서: 실증 runbook, DB/MCP 계약, 병합·운영 점검, 작업 계획 | #4 위 문서 전용 stack | 문서 링크·계약 검토와 inherited CI. 스키마·UI·Work 실행 없음 |
| work-spike-01 / 실제 Work 실험, 코드 PR 아님 | IG/TT/YT 별도 실제 채팅에서 사이트→내부 검색→5명/최근 콘텐츠·공개 지표 관찰 | 승인된 브리프/대상 조건, 사용할 수 있는 Work 브라우저 환경 | [체크리스트](PHASE-0-RUNBOOK.md), 비공개 원본 증거, 플랫폼별 pass/partial/blocked. 15명 성공을 미리 약속하지 않음 |
| discovery-probe-01 / feat/discovery-probe-01 | 최소 원격 MCP 인증/보호 리소스, capabilities, synthetic probe write/read·audit·idempotency만 | #1–4 승인 병합 후 main, 테스트 조직 및 인증 endpoint 설계 승인. SNS 실험과 독립 준비 가능 | 로컬 인증/격리/DB tests + 승인된 스테이징 배포 후 **실제 Work MCP-01**. 로컬 tests만 통과하면 Work 지원은 unverified. creator 수집/실행 UI 없음 |
| discovery-schema-01 / feat/discovery-schema-01 | runs/accounts/evidence/campaign links/logs 및 최소 alias/reviews/requests additive migration | 최소 1개 플랫폼 SNS 실증 pass와 결과에 맞춘 필드 검토, 현행 schema와 병합 경로 확보 | 빈 DB/기존 0002 DB 이관, scoped FK/unique/불변성. 기존 브리프·파일 JSON/바이트 보존. MCP transport/UI 없음 |
| discovery-core-01 / feat/discovery-core-01 | service/runtime schema, 계정 dedupe/alias 충돌, 관찰 append·캠페인 연결, run 사본/집계·검토 규칙 | schema PR, 실제 관찰 형태와 권한 정책 확인 | 동시 upsert/중복 요청/응답 유실, cross-tenant, 데이터 정정/과거 run 재현. STEP 4 점수·승인/이메일 없음 |
| discovery-mcp-01 / feat/discovery-mcp-01 | 검증된 MCP auth adapter에 context/prepare/log/observation/submit/read 도구 연결 | probe의 Work write_verified + core + 대상 플랫폼 pass. 인증 경로 미검증이면 미완료로 유지 | 실제 Work SNS 관찰 1명→DB read-back→캠페인 연결, 5명 실험·재시도·다른 조직/권한 차단. SDK-only 테스트로 완료 불가 |
| discovery-ui-01 / feat/discovery-ui-01 | 실제 저장된 run/evidence/실패·검토 상태 조회, 출처·확인 시각·제약 표시 | schema/core, Work 데이터 표시는 해당 capability 검증 후 | 권한/빈 상태/로딩/실패/중복/과거 run 브라우저 테스트. 임의 Start Work/가짜 성공 버튼 없음 |

probe PR의 endpoint 배포·외부 연결은 준비된 코드·설정·테스트를 먼저 검토 가능하게 만든 뒤 사용자 승인을 받는다. 실제 배포 승인이 없으면 준비 완료와 Work 쓰기 미실행을 구분한다. 현재 작업에서는 어떤 endpoint도 배포하지 않는다.

운영 관련 OPS-03 업로드 환경, OPS-04 S3 정책 호환, OPS-05 cleanup, OPS-06 인증·보안 보완도 각각 독립 PR로 진행한다. discovery 기능 PR에 운영 정책 변경을 끼워 넣지 않는다. 작업 소유자는 코드/설계 Codex, 실제 Work 운영자와 워크스페이스 관리자·보안/배포 담당은 배정 필요다.

## 병합과 검증 원칙

1. 기존 [PR #1→#2→#3→#4 병합 절차](PR-MERGE-READINESS.md)는 승인 전 미실행이다. 새 기능 PR은 가능하면 정리된 main에서 시작한다. 먼저 시작해야 하면 의존 branch/base를 명시하고 임의 병합하지 않는다.
2. 각 PR은 acceptance, 비구현 범위, migration 영향, 테스트 결과, 실제 Work 실행 여부를 본문에 구분한다. 실증 raw 프로필/채팅/토큰을 Public PR이나 테스트 fixture로 넣지 않는다.
3. 코드 PR마다 타입·린트·단위·해당 DB/transport 통합·빌드를 실행한다. UI가 있으면 브라우저 검증을 추가하고 기존 파일/브리프 회귀를 유지한다. 데이터-only PR에 가짜 UI를 만들어 스모크를 채우지 않는다.
4. 연결 환경·auth scope·서버 build 또는 Work runtime이 달라지면 기존 capability 실증이 적용되는지 재확인한다. 플랫폼 통과를 다른 플랫폼에 전파하지 않는다.
5. Work task는 운영자가 수동 시작한다. 대시보드는 먼저 수동 실행 안내/브리프 복사를 제공할 수 있으나 자동 실행 성공처럼 표시하지 않는다. 외부 시작/재개는 별도 지원 경로와 실제 수신 결과를 확인한 후 새 PR로 평가한다.

## 실험 결과별 분기

| 관찰 결과 | 다음 조치 |
| --- | --- |
| SNS 하나 이상 pass + MCP write_verified | 통과한 플랫폼부터 schema/core/MCP 관찰 왕복 PR 진행. 나머지 제한 표시 |
| SNS pass, MCP 연결/쓰기 차단 | 증거·실패 기록 유지, 인증/환경 문제를 좁혀 재실증. 필요 시 별도 명시적인 manual_import 경로를 설계하되 Work 연동 완료로 표기하지 않음 |
| SNS 접속만 가능하거나 5명/내부 검색/최근 콘텐츠 미달 | partial 상태에서 추가 실험. 수집 필드 계약은 관찰 결과로 보완하고 실제 발굴 기능 완료 선언 보류 |
| 모든 SNS 차단 | 원인·환경을 기록하고 다음 경로를 사용자와 결정. Google-only나 벤더 API로 요구를 대체하지 않음 |
| Workspace Agent API 등의 별도 경로 사용 가능성 발견 | 일반 Work와 분리해 새 실증 제안. API 202/도구 목록 표시를 SNS 발굴 완료로 간주하지 않음 |

현재 실제 결과는 [PHASE-0-RESULTS](PHASE-0-RESULTS.md)의 not_tested/unverified다. 준비 문서·로컬 MVP·미래 운영 배포를 각각 구분한다.

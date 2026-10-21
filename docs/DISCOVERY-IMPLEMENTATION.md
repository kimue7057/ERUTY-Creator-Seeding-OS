# STEP 3 구현 및 실증 상태

기준: PRD v1.2, STEP-3-DATA-MCP-DESIGN, STEP-3-PR-PLAN. 기존 STEP 1–2와 STEP 4–5 기획을 변경하지 않는다.

실증 근거 확인: 저장소 PHASE-0-RESULTS는 Instagram/TikTok/YouTube 각각 not_tested, hosted Work MCP 쓰기는 unverified다. 비공개 로컬 checkpoint도 실제 OAuth 로그인·Work 도구 응답·독립 read-back이 미검증이며 실제 proof receipt 파일은 없다. 현재 Codex 도구 목록에 ERUTY 플러그인의 세 도구가 없다. 따라서 SNS 직접 발굴/Work 연결의 성공 근거는 확보하지 못했다. 로컬 Tunnel/metadata/SDK 테스트를 실제 Work 결과로 대체하지 않는다.

사용자가 STEP 3 실기능 구현을 요청하여 실증 의존성 미충족 상태의 **로컬 구현 Draft**를 준비한다. STEP-3-PR-PLAN의 플랫폼 pass / Work write_verified 조건은 완료·배포 판정의 미충족 항목으로 유지한다. 원본 후보·private trace·receipt·OAuth 정보를 Public GitHub에 넣지 않는다.

| 범위 | 구현 상태 | 실제 Work 수용 기준 |
| --- | --- | --- |
| Phase A / discovery-schema-01 | additive 0004: runs/accounts/evidence/campaign links/logs, aliases/reviews/requests/capability receipts. DB 조직·플랫폼·캠페인 scoped FK, 불변 이력/context, 안정 ID/활성 별칭 unique | 미충족. migration은 기존 캠페인/브리프/파일을 바꾸거나 실제 발견/실증 성공 행을 만들지 않는다 |
| Phase B / discovery-core-01 | context/prepare/log/observation/submit/read 및 내부 staff review 서비스. 계정 재사용·별칭 충돌 거절, 타겟팅 사본/근거/미확인 지표, 원자적 멱등성·감사, live membership 검증 | 실제 관찰 형태/플랫폼별 제약 추가 검증 필요. 테스트의 Work-source fixture는 합성 계약 검증이며 실제 Work 결과가 아님 |
| Phase C / discovery-mcp-01 | 기존 JWT/HTTP 보호를 재사용한 별도 6도구 discovery 모드, 캠페인 allowlist grant, private operator grant/revoke/proof 검증. probe 모드 3도구 유지 | 로컬 synthetic SDK 왕복과 별도 read-only DB 검증/철회 차단 통과. hosted Work 원본 SNS 검색 1명→인증 MCP→독립 PostgreSQL 검증 미완료. [실행·수용 체크리스트](DISCOVERY-MCP.md) |
| Phase D / discovery-ui-01 | 캠페인별 기록 화면, 계정·원본 근거·지표·시각, 검색·실패 로그, 필터·집계·페이지, staff 검토와 조회 전용·빈 상태·로딩·실패 화면. STEP 4에는 읽기 전용 근거 인터페이스만 제공 | 로컬 합성 PostgreSQL→브라우저 검증. 실제 Work 데이터 표시 검증 미완료 |

0004는 Drizzle 모델에 더해 scoped self-FK 및 이력/상태 변경 trigger를 명시 SQL로 관리한다. 과거 evidence/log/review/request/capability는 UPDATE/DELETE를 거절한다. run은 context 수정/삭제/종료 후 재쓰기를 거절하고 lock_version 증가와 상태 전이를 검사한다. 별칭은 폐쇄(valid_to 최초 설정)만 허용한다. 별도 보존/삭제 정책은 이번 범위가 아니다.

마이그레이션 검증은 빈 독립 DB 및 기존 0000–0003 데이터에서 수행한다. 기존 파일 ID/version/브리프 JSON과 campaign asset reference를 보존하고, 조직·플랫폼·캠페인 간 FK 위반과 이력 덮어쓰기를 PostgreSQL에서 차단하는지 검사한다. 모든 테스트 후보는 합성 fixture이며 SNS 접속 증거가 아니다.

공통 서비스는 호출마다 현재 membership/역할과 campaign allowlist를 확인하고, MCP adapter가 전달한 grant 재검증 함수를 동일 트랜잭션에서 실행한다. client 입력에 org/actor/accepted/status 필드를 허용하지 않는다. Work 출처의 준비는 해당 환경 hash에 맞는 사람이 검토한 MCP 쓰기 receipt와 최소 1명 native search·최근 콘텐츠 실증 receipt가 있어야 한다. 테스트/수동 입력을 Work 출처로 바꾸지 않는다.

run 준비는 Work 시작이 아니며 첫 실제 보고 로그/관찰이 들어와야 collecting으로 전이한다. 제출은 awaiting_review까지만 가능하다. 내부 staff 검토는 현행 admin/manager만 수행하며 reviewer의 조회 전용 권한을 바꾸지 않는다. 직접 SNS 검증 수는 Work 출처·native search 성공·원본 프로필/최근 콘텐츠·공개 지표·프로필과 콘텐츠의 사람 검토를 모두 만족한 계정만 집계한다. 합성/수동 자료는 사람이 accepted로 검토해도 직접 SNS 검증으로 승격하지 않는다. 종료 run의 정정은 새 run에서 이전 evidence를 참조해 append한다.

해시 규칙 v1은 JSON object key 정렬과 UTF-8을 사용한다. 타겟팅 집합과 metric 이름은 정렬하고 null/수치/관찰 콘텐츠 순서는 보존한다. 동일 principal/tool/key의 정규화 본문이 같으면 원래 receipt를 반환하고 다르면 conflict다. receipt/evidence/log/audit는 한 트랜잭션에 저장한다. 새 key는 종료 run에 쓸 수 없지만 이전 요청의 재조회형 replay는 허용한다. 기록은 이력/보존 정책이 정해질 때까지 자동 만료·삭제하지 않는다. run당 관찰은 요청 수의 3배, 로그 10,000개, principal당 요청 receipt 10,000개로 제한한다.

URL 정규화는 URL 문법/허용 SNS hostname/path만 검사하며 실제 프로필 존재·열람을 증명하지 않는다. YT Unicode handle은 [공식 handle 안내](https://support.google.com/youtube/answer/11585688?hl=en)에 따라 지원하고 channel ID와 구분한다. IG/TikTok의 초기 handle 허용 범위와 세 플랫폼의 실제 UI/URL 변형은 실증 전까지 호환성 미확정이다. 입력 URL을 서버에서 자동 fetch하지 않는다. `getRun`은 로그 cursor와 evidence offset/limit을 제공하며 수집 중 offset 페이지는 갱신될 수 있다.

## 대시보드 검증 경계

2026-10-21 사용자가 실제 Work SNS·MCP 실증 기록이 아직 없다고 확인했다. 이 작업 환경의 도구 목록에도 ERUTY 플러그인 도구가 없다. 따라서 hosted Work 원본 관찰을 기록하는 최종 통합 실험은 미실행이다.

`/discovery` → 캠페인 → run/creator 상세에서 실제 PostgreSQL 행을 조회한다. 원본 프로필·게시물·지표와 관찰 시각, 반올림/비공개·미확인, 국가 근거와 시청자 국가 미확인을 구분한다. profile identity는 관찰 facts에 고정하므로 이후 이름/별칭 변경이 과거 관찰을 덮어쓰지 않는다. 이전 facts에 identity가 없는 경우 현재 계정 표시 이름을 보조 표시하며 원본 URL/해시는 보존한다.

내부 admin/manager의 검토는 append-only review와 audit를 남긴다. UI에 바인딩한 campaign/account 범위를 서비스에서 다시 검사하고 현재 membership/역할을 확인한다. reviewer는 조회만 한다. completed는 실제 Work 검색·공개 지표·프로필/콘텐츠의 검토·목표 인원 없이는 거절한다. 합성 데이터를 accepted로 검토해도 verification_pending을 유지한다. 종료된 run의 근거는 화면에서도 수정/검토 제어를 제공하지 않는다.

플랫폼 카드는 사람이 검토한 capability와 `DISCOVERY_CURRENT_ENVIRONMENT_SHA256`가 같은 환경인 경우만 판정을 표시한다. 설정 누락/환경 변경은 미검증 또는 재확인 필요다. 임의 hash 설정만으로 실증 성공을 만들 수 없다. Work 보고 출처, 근거의 사람 검토, 플랫폼별 5명 안정성은 서로 다른 상태다.

읽기 전용 `getDiscoveryEvaluationInput`은 향후 STEP 4에 account/run/brief/evidence ID, 원본 URL·hash·시각·출처·페이지 및 준비 상태만 전달한다. 평가 점수·승인·이메일은 구현하지 않는다. 파일 다운로드 MCP와 외부 Work 자동 시작도 이번 범위가 아니다.
## 로컬 검증 결과 (2026-10-21)

- 타입 검사·린트·Next.js production build·MCP Node bundle: 통과.
- 단위 15개, PostgreSQL/S3/HTTP MCP 통합 27개: 통과. 마지막 관찰 identity 보존 변경 후 discovery core/MCP/query 6개를 다시 실행해 통과.
- Chromium 브라우저 6개: 통과. 저장 데이터 새로고침, 플랫폼/카테고리/팔로워/출처/검증 필터, 원본 링크·검토 이력, 합성 completed 거절, partial 상태 유지, 차단 로그, 다른 조직/조회 전용·membership 철회, 390px 화면을 확인했다.
- 기존 프로젝트·제품·캠페인 CRUD와 실제 S3 PDF/이미지 업로드·미리보기·다운로드 및 파일 v2 이후 과거 브리프 v1 유지: 회귀 통과.
- 브라우저 검증 중 발견한 작업별 집계 상관 쿼리와 필터 초기화 문제를 수정하고 해당 경로를 재검증했다. 로딩/서버 실패 컴포넌트는 구현했으나 DB 중단을 통한 브라우저 장애 주입 실험은 수행하지 않았다.
- 전부 합성 데이터/로컬 실행이다. hosted Work SNS 검색·인증된 실제 도구 호출·실제 원본 DB 대조는 미검증이며 최종 수용 기준을 충족했다고 판정하지 않는다.
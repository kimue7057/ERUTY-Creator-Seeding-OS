# STEP 4: 근거 기반 평가와 담당자 승인

캠페인 브리프와 STEP 3의 공개 관찰 근거를 고정해 평가 이력을 저장한다. 승인된 PRD의 배점(제품 30 / 스타일 20 / 타깃 20 / 콘텐츠 15 / 참여도 10 / 협업 5)을 유지한다. 평가를 새 SNS 관찰이나 발송 승인으로 간주하지 않는다.

## 수용 범위

- `/evaluations`와 크리에이터 상세에서 캠페인별 평가 및 승인/보류/제외 이력을 조회한다. admin/manager만 저장하며 reviewer는 조회한다. 모든 요청에서 현재 membership과 조직/캠페인 범위를 다시 확인한다.
- Work가 실제 반환한 JSON을 가져와 평가 초안으로 저장할 수 있다. 도구/모델명은 사용자 입력 출처로 표시한다. 가져오기만으로 Work 실행이나 SNS 방문을 인증하지 않는다.
- 선택적인 서버 OpenAI Responses API 공급자를 구현했다. 기본값은 비활성화다. 실제 키/모델을 설정하지 않은 환경에서는 호출하지 않으며 API가 동작한 것처럼 보고하지 않는다.
- 미확인 항목은 `null`이다. 0점이나 100점 환산으로 바꾸지 않고 확인 가능한 항목의 합계와 미확인 개수를 표시한다. 각 항목에 근거 ID, 사유, 신뢰도 및 위험 표시를 보존한다. 크리에이터 소재지로 시청자 국가를 추정하지 않는다.
- 최종 승인은 최신 평가, 변경되지 않은 입력 hash, 검토된 Work 원본 근거, `direct_sns_verified` 상태 및 담당자의 미확인 항목 확인이 필요하다. 합성 자료나 초기 검증 run을 임의로 승격하지 않는다. 브리프/타깃/근거/검토 상태가 바뀌면 후속 작업 대상 판정이 해제된다.
- 실제 연락/이메일/DM/계약 및 STEP 5–7은 구현하지 않는다. 후속 작업 대상 표시는 전송 동작이 아니다.

## 데이터와 재시도

`0009_evaluation_workflow.sql`은 평가, 담당자 검토, AI 요청 원장을 추가한다. 기존 STEP 1–3 행은 변경하지 않는다. 평가는 입력 스냅샷/브리프 버전/입력 hash/출력/모델/사유/생성자/시각을 기록한다. 평가와 검토는 append-only이며 DB 트리거를 수동 SQL로 유지한다.

동일 사용자/멱등키의 평가는 같은 payload에서만 재조회한다. 다른 입력은 충돌이다. API 호출은 트랜잭션 밖에서 실행하되 호출 전에 원장을 선점하며 자동 재시도하지 않는다. 응답 유실·거절·형식 오류·저장 실패 후 같은 키로 다시 유료 호출하지 않는다. 실행 중 종료된 요청도 같은 키로 재실행하지 않는다. 필요하면 운영자가 저장 여부를 확인한 후 새 요청을 명시적으로 시작한다. 최근 10분의 동시 요청은 사용자당 2건으로 제한한다.

공급자 요청은 45초, 응답은 1MiB로 제한한다. 고정 API 주소, strict JSON Schema, `store:false`, 도구 없는 요청을 사용한다. 키/원문 응답/토큰을 로그에 출력하지 않는다. 브리프/관찰 문자열은 비신뢰 데이터로 취급하며 프롬프트의 지시문으로 실행하지 않는다.

## 배포 순서

1. DB와 역할/설정을 비공개 백업한다. `pnpm db:migrate`로 additive `0009`를 적용한다.
2. 별도 제한 역할을 쓰는 로컬 Discovery 환경에서는 owner로 `staging/discovery/evaluation-grants.sql`을 검토·적용한다. dashboard는 평가 저장/검토, verifier는 SELECT만 허용하며 MCP runtime에는 평가 권한을 추가하지 않는다.
3. 대시보드 서버에 `EVALUATION_ENABLED=true`를 설정하고 재시작한다. 마이그레이션 전 기본값 false를 유지한다.
4. API 자동 평가가 필요할 때만 서버 전용 `EVALUATION_AI_ENABLED=true`, `OPENAI_API_KEY`, `EVALUATION_MODEL`을 설정한다. 모델/요금/전달할 실제 데이터를 검토한 뒤 활성화한다. 키를 브라우저나 Work 프롬프트에 넣지 않는다.

되돌리기는 `EVALUATION_ENABLED=false`와 서버 재시작으로 화면을 비활성화한다. 저장된 평가/검토/요청 원장은 삭제하지 않는다. API 공급자는 별도로 `EVALUATION_AI_ENABLED=false`로 중단할 수 있다.

## 초기 플랫폼 업무 실행 허가

기존 관리자 운영 승인에 대해 한 플랫폼/캠페인/환경/사용자로 제한된 초기 실행 허가를 발급할 수 있다. 실제 성공 capability와 구분해 `partial`, `initial_validation=true`, `work_connection=unverified`를 유지한다. 최대 4시간·5명·한 run이며 기본 권한 검사와 검토 제한을 우회하지 않는다. 기존 legacy grant 경로도 유지한다.

`authorize-initial-run`의 선택 환경 변수 `MCP_DISCOVERY_INITIAL_AUTHORIZATION_FILE`은 `.local/discovery` 안의 JSON basename만 허용한다. 파일별 허가와 UUID별 영수증을 보존하며 기존 허가/차단 run을 덮어쓰지 않는다. 같은 운영 허가 입력의 재호출은 기한을 연장하지 않는다. 실제 SNS 방문이나 성공 receipt를 생성하는 명령이 아니다.

## 검증 경계

단위/격리 PostgreSQL/브라우저 검사는 모두 합성 자료이며 hosted Work 또는 실제 OpenAI API 성공이 아니다. 검사는 조직/역할, 점수·근거 검증, 멱등성, 불변 이력, 근거 변경 후 승인 해제, 동시 API 요청/응답 유실/동시 입력 변경, 미설정 공급자 차단, 모바일 저장/조회 및 reviewer 접근을 포함한다. 실제 브랜드와 크리에이터 목록·실행 영수증은 Git에서 제외한다.

공식 API 참고: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

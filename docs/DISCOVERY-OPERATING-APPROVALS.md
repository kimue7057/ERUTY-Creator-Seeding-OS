# Discovery 관리자 운영 승인

기존 24시간 실증 grant와 최대 4시간 초기 실증 허가는 그대로 보존한다. 반복 grant 재발급을 대신할 선택 가능한 운영 승인 경로를 추가한다. 기본값은 꺼짐이며, 이 문서와 코드 추가만으로 운영 DB나 공개 MCP 서버가 변경되지는 않는다.

## 권한 경계

- 조직의 현재 admin이 명시적으로 승인한다. 대상 사용자는 같은 조직의 현재 멤버여야 한다. reviewer는 읽기만 허용한다.
- OAuth issuer/subject, 보호 resource, 코드 build를 포함한 환경 hash, 캠페인 allowlist, scope를 고정한다. 승인은 최대 7일이며 더 짧게 발급할 수 있다.
- 매 요청과 서비스 트랜잭션에서 토큰 만료·scope·조직 membership·역할·캠페인·승인 만료·철회를 다시 확인한다. 기존 JWT 서명/issuer/audience 검증을 유지한다.
- 승인과 allowlist는 불변 이력이다. 최초 철회만 가능하며, 만료 연장·철회 취소·삭제를 제공하지 않는다. 동일 멱등키와 동일 입력은 같은 승인을 반환하고 기간을 연장하지 않는다.
- 만료·철회된 운영 승인이 있으면 과거 실증 grant로 우회하지 않는다. 새 승인은 관리자가 새 멱등키로 명시적으로 발급한다. supervisor·MCP 도구·예약 작업에 자동 발급이나 갱신 경로가 없다.
- MCP DB 계정은 승인/allowlist를 읽고 행 잠금을 획득할 수 있지만 발급·철회·연장·범위 변경을 할 수 없다. 관리자 명령은 별도 운영자 DB 연결을 사용한다.

OAuth access token 수명·refresh rotation·offline session 설정은 변경하지 않는다. OAuth 재로그인은 DB 승인을 갱신하지 않는다. 운영 승인만으로 Work/SNS 실증 또는 후보 검토가 완료되지 않는다. 기존 capability Gate와 초기 실증 허가의 제한도 유지한다.

## 승인 후 적용 순서

운영 환경 공개 적용은 사용자 승인 후 진행한다. 기존 성공 run·증거·세션·Secret·Tunnel은 보존한다.

1. 기존 DB/role 권한과 현재 MCP 이미지·구성을 비공개로 백업한다. 복원 검증은 별도 격리 대상에서 한다.
2. 승인된 코드의 `pnpm db:migrate`로 `0008`까지 적용한다. `0008`은 새 승인 테이블/제약/불변 트리거만 추가하고 기존 기록을 수정하지 않는다. 기존 운영 DB에 로컬 테스트나 seed를 실행하지 않는다.
3. DB 소유자 연결로 `staging/discovery/runtime-grants.sql`의 제한 권한을 적용한다. MCP 계정의 승인 발급·철회 권한은 주지 않는다.
4. 승인한 build에서만 `MCP_DISCOVERY_OPERATING_APPROVALS=true`를 설정한다. Compose 기본값은 `false`다. 기능을 켜면 환경 hash가 바뀌며, 새 승인과 검토된 capability가 각각 필요하다. 이전 환경의 성공 기록을 새 환경의 방문 증거로 자동 이관하지 않는다.
5. 같은 설정의 관리자 전용 환경에서 아래 `environment` 명령을 실행해 실제 hash를 얻는다. 현재 OAuth principal은 기존 IdP/연결 기록에서 확인한다. 비밀번호·JWT·인증 코드를 JSON이나 채팅에 복사하지 않는다.
6. 사용자·캠페인·scope·기간을 확인한 후 승인 파일을 작성하고 `approve-operation`을 실행한다. 새 승인 ID와 만료 시각은 비공개 영수증에 보존한다.

`DATABASE_URL`은 관리자 명령과 MCP 런타임에서 서로 다른 계정이다. `.local/discovery/operator.env`는 Git 제외된 개인 파일이며 기존 파일을 덮어쓰지 않는다. 아래 명령은 설정 파일을 읽고 실행한다. `approve-operation`과 `revoke-operation`은 DB를 변경한다.

```powershell
node --env-file=.local/discovery/operator.env --import tsx scripts/discovery-operator.ts environment
node --env-file=.local/discovery/operator.env --import tsx scripts/discovery-operator.ts approve-operation
# 철회할 때만 operator.env의 MCP_DISCOVERY_OPERATING_APPROVAL_ID를 명시한다.
node --env-file=.local/discovery/operator.env --import tsx scripts/discovery-operator.ts revoke-operation
```

`.local/discovery/operating-approval.json` 형식 예시다. 아래는 모두 합성 예시이며 실제 값과 미래 만료 시각으로 교체해야 한다. 읽기만 먼저 허용할 경우 scopes에 `discovery:read` 하나만 둔다.

```json
{
  "organization_id": "00000000-0000-4000-8000-000000000001",
  "user_id": "00000000-0000-4000-8000-000000000002",
  "approved_by": "00000000-0000-4000-8000-000000000002",
  "issuer": "https://idp.example.invalid/realms/example",
  "subject": "synthetic-example-subject",
  "resource": "https://mcp.example.invalid/mcp",
  "environment_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "campaign_ids": ["00000000-0000-4000-8000-000000000003"],
  "scopes": ["discovery:read", "discovery:observe", "discovery:submit"],
  "expires_at": "2030-01-01T00:00:00Z",
  "reason": "Synthetic example; replace with explicit operating purpose and duration",
  "idempotency_key": "00000000-0000-4000-8000-000000000004",
  "confirmation": "approve-bounded-discovery-operation"
}
```

`approved_by`는 `MCP_DISCOVERY_OPERATOR_USER_ID`와 같아야 하며 DB의 현재 admin인지도 검사한다. `approve-operation`은 capability를 attest하지 않는다. 영수증을 Git·공개 PR·스크린샷에 게시하지 않는다.

## 오류와 복구

| 결과 | 의미 | 대응 |
| --- | --- | --- |
| `invalid_token` / HTTP 401 | OAuth access token 만료 또는 검증 실패 | 정상 refresh, 거절되면 기존 연결에서 로그인 |
| `insufficient_scope` | OAuth scope 부족 | 필요한 scope를 명시적으로 승인 |
| `approval_expired` / `approval_revoked` | DB 운영 승인 만료·철회 | 관리자 확인 후 필요하면 새 승인. 재로그인·무한 재시도 금지 |
| `approval_scope_denied` | DB 승인 scope 부족 | 관리자 검토 후 범위가 맞는 새 승인 |
| `approval_environment_mismatch` | issuer/resource/build/정책 환경이 다름 | 배포·설정을 대조하고 새 환경 승인. hash 검증 제거 금지 |
| `unverified_capability` | 실제 Work/SNS 검토 Gate 미충족 | 기존 원본과 독립 DB 증거를 검토. 임의 성공 처리 금지 |
| `database_unavailable` / `database_timeout` | DB 중단·연결/쿼리 시간 초과 | 읽기는 제한 재시도. 쓰기는 같은 멱등키와 동일 payload 유지 |

예상 가능한 도구 오류는 SDK 호환 `isError`와 안전한 코드·request_id·복구 메시지를 반환한다. 승인 만료·철회는 OAuth 재로그인 challenge나 자동 재시도를 발생시키지 않는다. 실제 stack과 driver code는 기존 비공개 마스킹 로그에 남는다.

`pnpm mcp:diagnose discovery`는 별도 읽기 전용 verifier URL이 있으면 legacy grant와 운영 승인의 만료·철회·환경 일치·캠페인 수를 분리해 보고한다. 이 진단은 실제 hosted Work 도구 호출이 아니다.

## 검증 및 현재 범위

격리 PostgreSQL 테스트는 승인/철회·동시 멱등성·범위 거절·만료·역할 변경·환경 변경·DB 불변 제약·runtime 최소 권한을 검사한다. 합성 HTTP MCP SDK 테스트는 실제 structuredContent, 잘못된 audience/만료 JWT의 401, scope 거절과 철회 시 isError를 확인한다. 운영 데이터나 SNS를 사용하지 않는다.

2026-10-26 기존 Work 대화의 성공 보고와 독립 읽기 전용 PostgreSQL 대조에서 run 1건·계정 1건·증거 2건·원본 링크·관찰 응답 payload hash가 일치했다. 이 검토는 개별 원시 브라우저 trace 재실행이나 새 환경의 실증이 아니다. 기존 `awaiting_review` / `verification_pending` 상태를 그대로 보존했다. 추가 SNS 발굴·관찰 저장·검증 완료 처리는 수행하지 않았다.

PC 전원·Docker·인터넷·임시 OAuth Tunnel의 가용성 한계는 별개다. [PC 운영 안내](LOCAL-PC-OPERATIONS.md)를 따른다. 상시 서버 전환은 보류 상태이며 STEP 4 평가는 이번 변경에 포함하지 않는다.

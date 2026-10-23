# STEP 3 discovery MCP 실행

연결 오류, 재인증 반복, grant 만료, DB/Tunnel 복구는 [MCP 진단·복구](MCP-STABILITY.md)를 따른다. 도구 실행 오류는 안전한 structuredContent와 request_id를 제공하며, grant 거절을 OAuth 갱신으로 해결하려고 반복하지 않는다.

상태: 로컬 코드/SDK 통합 검증 및 2026-10-24 실제 hosted Work 캠페인 조회·서버 로그·DB hash 대조 완료. **실제 hosted Work SNS→관찰 저장→DB→대시보드 검증은 미완료**. 기존 probe 실행 환경과 연결된 플러그인을 자동 변경하지 않는다.

## 서버와 권한

- 기본 `MCP_SERVER_MODE=probe`: 기존 synthetic 3도구/권한/4KiB 제한 유지.
- 명시 `MCP_SERVER_MODE=discovery`: `get_campaign_discovery_context`, `prepare_discovery_run`, `append_discovery_log`, `record_discovery_observation`, `submit_discovery_run`, `get_discovery_run` 6개만 노출. 64KiB/관찰 1명/콘텐츠 최대3개.
- 두 모드는 같은 JWT/HTTPS resource·issuer/JWKS·Host/Origin·timeout·concurrency 보호를 재사용한다. UI session cookie는 사용하지 않는다. 서버가 SNS를 탐색하거나 Work를 자동 실행하지 않는다.
- discovery는 `MCP_DISCOVERY_ORGANIZATION_ID`와 실제 build SHA가 필수다. JWT와 DB grant의 read/observe/submit scope 교집합, 현재 membership/역할, campaign allowlist, source, 환경 hash, 만료·철회를 매 호출/쓰기 트랜잭션에서 검사한다. DB grant 생성/확장과 증거 검토는 MCP 도구가 아니다.
- 새 grant는 최대24시간이며 초기 실험은 1시간을 권장한다. 같은 active principal의 중복 grant는 거절한다. 철회 후 새 환경의 grant를 만들 수 있고 과거 권한·receipt는 보존한다.
- `codex_test`는 명시적 synthetic probe sandbox campaign에만 grant 가능하며 production에서는 거절한다. Work grant를 만들었다는 사실만으로 Work 검증이 되지 않는다. Work-source run 준비에는 해당 환경의 검토된 MCP write receipt와 실제 native search·프로필/최근 콘텐츠 1명 이상 근거가 필요하며, 플랫폼 pass는 별도로 5명 기준이다.

## 로컬 운영자 순서

### 격리된 Windows 로컬 Discovery 실행

`staging/discovery/compose.local.yaml`은 기존 Probe와 별도 DB volume/역할을 사용한다. DB는 loopback 55434, MCP gateway는 3311, 대시보드는 3001이다. 기존 Probe Tunnel에 두 runtime을 동시에 연결하지 않고 별도 Discovery Tunnel을 준비한다. 비공개 `.local/discovery/tunnel-id.txt`에 실제 ID를 저장한 뒤 `pnpm exec tsx scripts/discovery-local.ts prepare`를 실행한다. 현재 사용자 전용 폴더 ACL을 먼저 확인한다. 이 명령은 기존 환경 파일이 있으면 덮어쓰지 않는다.

`docker compose --env-file .local/discovery/compose.env -f staging/discovery/compose.local.yaml up -d --wait db` 후 `node --env-file=.local/discovery/operator.env --import tsx scripts/discovery-local.ts init`으로 **빈 전용 DB만** 초기화한다. 기존 public 테이블이나 setup receipt가 있으면 거부하며, 실제 크리에이터 관찰을 삽입하지 않는다. 같은 operator env로 `discovery-local-oauth.ts prepare`를 실행하면 기존 테스트 realm/user/Probe client를 보존하고 별도 `eruty-work-discovery` public/S256/consent client를 만든다. 정확한 ChatGPT callback은 `.local/discovery/work-callback.txt`를 통해 `callback` action으로 등록한다.

기존 `discovery-operator.ts grant`로 캠페인 한정 Work grant를 발급한다. 새 환경의 capabilities가 미검증이면 운영자 전용 `authorize-initial-run` action이 `.local/discovery/initial-run-authorization.json`을 읽어 특정 grant·campaign·platform에 **1개 run, 최대 5명, 최대 4시간**의 초기 실험을 승인할 수 있다. 이는 `initial_validation/partial`이며 통과 attestation이 아니다. run/관찰은 실제 Work trace·검색 log·원본 출처를 요구하고 `work_connection=unverified`, 검증 계정 수 0을 유지한다. blocked capability를 우회하지 않으며 재시도는 같은 run, 다른 키의 두 번째 run은 거절한다. 권한 만료/철회 검사는 계속 적용된다. 검증 완료가 필요하면 실제 증거와 독립 DB read-back을 검토한 뒤 별도 capability 판정을 하고 새 run을 사용한다.

MCP 이미지를 `build`하고 `up -d mcp private-gateway`로 실행한다. `mcp-local-access.ps1 -Mode discovery`는 별도 profile/connection을 사용하면서 기존 DPAPI runtime key를 재사용한다. 대시보드는 `pnpm exec tsx scripts/discovery-dashboard.ts`로 실행한다. Next worker가 거부하는 `--env-file` 인자 대신 전용 launcher가 private 환경을 child에 전달한다. Work의 실제 observation/read 응답으로 기존 verifier→revoke→closed verifier를 수행한다. 원본 증거·자격증명은 ignored private 폴더에만 보관한다.

스택 이관은 `0004_probe_grant_rotation → 0005_discovery_schema → 0006_discovery_mcp → 0007_discovery_initial_validation` 순서다. `db:migrate`는 기존 SQL hash를 확인해 이미 적용된 SQL을 재실행하지 않고 필요한 journal marker를 추가한다. 기존 기록은 수정하지 않으며, 알 수 없는 migration hash가 있으면 중단한다. `0000–0003` SQL과 이전 Discovery SQL의 바이트는 유지한다.

1. `pnpm db:migrate`, `pnpm mcp:build`. 기존 앱 DB/브리프/파일을 보존한다. 운영 연결 전에는 전용 DB/최소 권한 runtime·별도 read-only verifier 계정을 준비한다. 운영자가 별도 LOGIN role을 만든 뒤 `staging/discovery/runtime-grants.sql`의 제한된 권한을 적용할 수 있다. 비밀번호/DB 자격 증명은 이 파일에 넣지 않는다. production discovery 프로세스는 elevated role, unrelated user/session/asset 읽기, 권한/검토 기록 생성, 과거 증거 수정 권한을 발견하면 시작을 거부한다. 로컬 SDK fixture에서 사용한 owner 연결을 운영 runtime으로 재사용하지 않는다.
2. 현재 사용자만 읽을 수 있는 ignored `.local/discovery/`와 그 안의 `.env`, `evidence/`를 준비한다. 기존 OAuth 설정·resource를 재사용하되 **별도 discovery 조직/포트/서버 build**를 정확히 지정한다. DB/토큰/원본 후보를 Git·PR·CI 로그로 보내지 않는다. `DOTENV_CONFIG_PATH=.local/discovery/.env`를 선택한 뒤 아래 명령을 실행한다.
3. `pnpm mcp:discovery:operator environment`로 resource/issuer/JWKS/build에 묶인 환경 hash를 구한다. `.local/discovery/grant.json`에 명시 operator `user_id`, `organization_id`, exact issuer/subject, `environment_sha256`, `execution_source`, allowlisted `campaign_ids`, 필요한 `scopes`, UTC `expires_at`, `confirmation: create-explicit-discovery-campaign-grant`를 준비한다. `MCP_DISCOVERY_OPERATOR_USER_ID`는 현재 writer 사용자 UUID다.
4. `pnpm mcp:discovery:operator grant`는 기존 회원/캠페인 범위를 검사하고 private grant receipt만 저장한다. 이미 receipt가 있으면 먼저 이력을 별도 보존해야 한다. **기존 probe runtime DB 계정의 권한으로 discovery가 자동 동작한다고 가정하지 않는다.**
5. 별도 process에서 `MCP_SERVER_MODE=discovery pnpm mcp:start`에 해당하는 환경을 설정한다. PowerShell에서는 `$env:MCP_SERVER_MODE='discovery'`로 지정한다. 보호된 Tunnel/HTTPS와 OAuth 연결 변경은 실제 사용자/관리자 승인 범위에서 수행하고 새 Work 채팅의 도구 목록을 확인한다.
6. 실제 Work에서 context→prepare→실제 SNS 내부 검색/프로필/최근 콘텐츠→log→observation→read→submit을 수행한다. 파라미터는 tools/list의 strict schema를 따른다. `expected_context_sha256`과 idempotency key/본문을 보존한다. 접근 차단은 log에 사실대로 남기며 Google-only로 대체하지 않는다. read의 evidence 페이지에 해당 evidence IDs가 포함되도록 cursor/limit을 사용한다.
7. 실제 `observation`·`read` structuredContent를 private `.local/discovery/proof.json`에 저장한다. `MCP_DISCOVERY_VERIFIER_DATABASE_URL`은 **별도 읽기 전용 DB 계정**의 URL이다. `pnpm mcp:discovery:operator verify`는 row/receipt/hash/actor/principal/캠페인 연결/audit와 verifier 권한을 대조한다. owner·변조된 receipt·scope 불일치는 거절한다. 반환값은 여전히 `work_connection: unverified`, `operator_work_sns_trace_review: required`다. Work 원본 실행 기록까지 사람이 확인해야 실제 Work 성공 판정이 가능하다.
8. `MCP_DISCOVERY_GRANT_ID`를 실제 grant ID로 설정하고 `pnpm mcp:discovery:operator revoke`, 실제 Work 재호출 거절, `pnpm mcp:discovery:operator verify --closed`를 수행한다. IdP 세션/consent·Work plugin·Tunnel 종료는 각각 별도로 확인한다.

## 실증 근거의 사람 검토

`review-capability`는 자동 실증 테스트가 아니라 명시적인 운영자 attestation이다. 실제 수행 기록과 독립 DB 검증을 먼저 사람이 확인한다. private `capability-review.json`은 `platform`, `kind: sns_native_search | work_mcp_write`, `verdict: partial | verified | blocked`, `observed_at`, `private_evidence_file`(evidence 폴더 내부 JSON/MD 상대 경로), `facts: {native_search,direct_profiles,recent_content_profiles,limitations}`, 정확한 `confirmation: I-reviewed-the-private-Work-trace-and-independent-DB-proof`를 사용한다.

`pnpm mcp:discovery:operator review-capability`는 현재 writer와 파일 범위/존재·크기를 확인하고 내용 대신 hash를 저장한다. 이 명령은 파일 내용이 실제 Work 수행임을 독립적으로 증명하지 않는다. 생성된 template/fixture를 성공 증거로 입력하지 않는다. 코드·SDK 결과만으로 이 명령을 실행하지 않는다. 환경/build가 달라지면 적용 가능성을 재검토한다.

## 실제 Work 실증 체크리스트

실제 Work의 캠페인 조회는 확인했다. 아래 목록은 쓰기·SNS·종료까지 포함한 수용 기준이며, 조회 성공만으로 체크하지 않는다.

- [ ] 승인된 discovery grant/OAuth/Tunnel 연결, 실제 Work의 6개 도구 발견
- [ ] 한 플랫폼 원본 방문·SNS 내부 검색·실제 계정 프로필·최근 콘텐츠·공개 수치와 관찰 시각
- [ ] 실제 Work observation 호출과 read의 동일 evidence/hash/actor
- [ ] 별도 read-only PostgreSQL proof 검증 및 원본 Work 실행 기록 대조
- [ ] 캠페인 대시보드에서 같은 계정·근거·상태 확인
- [ ] 테스트 grant 철회 후 실제 Work 쓰기 차단, 보존된 receipt/감사 기록 확인
- [ ] 이후 플랫폼별5명·검색 안정성 확대, 실패/제약 별도 기록

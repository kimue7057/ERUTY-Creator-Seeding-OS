# discovery-probe-01 — 최소 원격 MCP 쓰기 검증 서버

후속 스테이징 준비: [실행 가능한 container/전용 DB/OAuth preflight/독립 proof·closeout 구성](../staging/probe/README.md). 기존 로컬/CI 통과와 외부 IdP 로그인·hosted Work 호출 검증을 구분한다. 외부 배포/플러그인 설치는 승인 전 미실행이다.

상태: 구현 및 로컬·CI 검사 완료 / [Draft PR #6](https://github.com/kimue7057/ERUTY-Creator-Seeding-OS/pull/6) 검토 대기 / **스테이징 미배포·실제 Work 연결 미실행**. 기준: [DB/MCP 설계](STEP-3-DATA-MCP-DESIGN.md), [작업 계획](STEP-3-PR-PLAN.md). PR #5 `c3b3c44` 위 별도 Draft PR로 작업한다. 기존 PR은 병합하지 않는다.

## 범위와 수용 계획

1. 독립 Node 프로세스의 stateless Streamable HTTP `/mcp`와 `eruty_capabilities`, `write_discovery_probe`, `read_discovery_probe`만 제공한다.
2. 외부 OAuth 서버의 JWKS로 JWT 서명/issuer/audience/기한/scope를 검증하고 현재 DB membership·전용 테스트 workspace·사용자 grant를 매 요청/도구 호출에서 확인한다. 앱 쿠키·SQL 도구·운영 조직은 받지 않는다.
3. synthetic nonce/idempotency key를 불변 probe 행에 저장하고 감사 기록과 하나의 transaction으로 게시한다. 재시도/동시 호출은 같은 행, 변경 payload는 conflict다.
4. 실제 HTTP MCP client→실제 PostgreSQL 저장→MCP read 및 별도 DB 연결의 read-back·감사 확인, 조직/권한/토큰/Origin/Host/입력/멱등성/철회·만료 부정 경로를 테스트한다.
5. 타입·린트·단위·DB/MCP 통합·MCP bundle·기존 Next 빌드를 검사한다. 기존 STEP 1–2 회귀를 유지한다.
6. hosted Work 플러그인/인증 연결 및 승인 후 실증 절차를 기록한다. 서버 개발/로컬 검증과 실제 Work 쓰기를 구분한다. 스테이징 배포·외부 터널·플러그인 설치/게시·실제 Work 연결은 이번에 수행하지 않는다.

전체 discovery run/creator/evidence/캠페인 UI, SNS 탐색, STEP 4 평가·STEP 5 이메일은 범위 밖이다. Work 지원 상태는 실제 실증까지 unverified다.

## 구현 경계

- 별도 Node process / `/mcp` / stateless Streamable HTTP JSON. SDK `@modelcontextprotocol/sdk 1.32.1`은 protocol `2025-11-25` 및 하위 협상 범위다. 새로운 2026 protocol/legacy SSE 연결은 미지원·미검증이다. Next 대시보드 라우트/버튼은 추가하지 않았다.
- 공개 읽기 전용 resource metadata: `/.well-known/oauth-protected-resource/mcp`(root 별칭도 제공). MCP endpoint는 initialize/tools/list를 포함해 인증을 요구한다. HTTP 401/403 challenge, 도구별 OAuth securitySchemes·호환 `_meta`, tool-level auth challenge를 제공한다.
- **외부 OAuth IdP 필요:** 이 서버는 JWT 보호 리소스다. issuer/JWKS는 운영자 설정이며 토큰의 `jku`/`x5u`로 key URL을 정하지 않는다. JWKS redirect를 거절한다. RS256/ES256 서명·정확한 issuer/audience(`/mcp` resource URL)·sub/scope/iat/exp·15분 이하 수명·미래/만료를 확인한다. opaque token/introspection, OAuth 로그인/코드 교환·client 등록/발급 서버는 미구현이다.
- 모든 요청과 도구의 실제 DB 작업에서 현재 membership, grant scope/만료·철회, sandbox 활성 상태를 확인한다. transaction에서 share lock으로 권한과 쓰기의 경합을 직렬화한다. 권한 철회 커밋 후 시작하는 요청은 거절된다. DB 연결 불가/오류는 fail closed한다.
- client org/user/project/campaign ID를 입력받지 않는다. 서버에 설정된 `MCP_PROBE_ORGANIZATION_ID`와 등록된 issuer+subject에서 범위를 도출한다. reviewer는 기존 조회 전용을 유지한다. read는 같은 principal의 probe만 허용한다. 읽기 전용 scope로 write할 수 없다.
- Host 정확 일치/Origin allowlist, HTTPS 설정(개발 loopback 예외), 4KiB JSON·단일 JSON-RPC 요청·synthetic UUID nonce/idempotency key 제한을 적용한다. body/headers/socket/DB statement·lock 시간과 연결 수를 제한한다. 프록시는 public Host를 보존해야 하며 Forwarded 헤더를 권한 근거로 쓰지 않는다.
- schema `0003`은 sandbox/grant/probe 3개 테이블만 추가한다. migration은 기존 조직을 등록하거나 가짜 run/후보를 만들지 않는다. 기존 0000–0002/브리프·파일 트리거/JSON을 유지한다.
- probe 행의 UPDATE를 DB trigger로 막고 scoped FK와 unique `(principal_id, idempotency_key)`로 격리·중복 방지를 보장한다. 같은 nonce/키 재시도는 같은 receipt, 다른 nonce는 conflict다. 동일 transaction의 최초 write audit 1건과 read/replay 감사가 남는다. principal당 probe 100행 상한이며 replay는 허용한다.
- stdout은 request UUID/짧은 outcome만 기록한다. token·쿠키·raw body·subject·DB 자격증명은 출력하지 않는다. DB read receipt의 nonce/IDs는 synthetic 정보이며 비공개 실증 기록으로 관리한다. 실제 Work 성공 문장/echo만으로 검증하지 않는다.

## 도구 계약

| 도구 | strict 입력 | 실제 출력/효과 |
| --- | --- | --- |
| eruty_capabilities | `{contract_version:1}` | 현재 principal/org/project/campaign/scope, build, protocol, sandbox_only. work_connection은 항상 unverified |
| write_discovery_probe | `{contract_version:1,nonce:UUID,idempotency_key:UUID}` | probe_id, SHA-256, 최초 request_id/recorded_at, actor/principal/scope IDs, replayed. 실제 DB 행+audit |
| read_discovery_probe | `{contract_version:1,probe_id:UUID}` | 현재 권한으로 저장된 동일 행을 재조회하고 audit 기록. 다른 principal/조직은 거절 |

write와 read 모두 유효 `discovery:read`가 필요하고 write에는 추가 `discovery:probe` + admin/manager 역할이 필요하다. 도구 결과의 도메인 실패는 `isError=true`와 안전한 code다. 인증/접근 검사는 HTTP에서도 먼저 수행한다. 요청 중 응답이 유실돼도 DB 커밋 여부를 추측하지 말고 같은 idempotency key로 재조회/재시도한다. SHA-256은 nonce UUID를 소문자로 정규화한 `JSON.stringify({contract_version:1,nonce})` UTF-8의 해시다.

## 로컬 준비 및 검증 명령

기존 `.env`/PostgreSQL/스토리지 개발 설정을 사용한다. MCP는 Next 서버와 별도 포트이며 자동으로 시작되지 않는다.

```powershell
pnpm db:migrate
pnpm mcp:build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build
```

통합 테스트는 매번 임시 synthetic 사용자/서로 다른 테스트 조직, 로컬 JWKS HTTP 서버, 실제 HTTP MCP client와 실제 PostgreSQL을 사용한다. OAuth 승인/로그인 절차를 재현하는 테스트는 아니다. 빌드한 Node entry의 별도 프로세스 실행도 포함하며 테스트 자원만 정리한다. `test:integration` 전에 `mcp:build`가 필요하다. 원격 주소로 배포하거나 외부 IdP/Work에 연결하지 않는다.

CLI로 별도 실증 sandbox를 준비할 때는 승인된 테스트 IdP의 issuer/subject와 기존 staff user를 사용한다. `.env.example`의 주석을 참고해 다음 값들을 **개인 로컬 환경**에 설정한다: `MCP_PROBE_SETUP_CONFIRM=create-new-synthetic-organization`, `MCP_PROBE_USER_EMAIL`, `MCP_OAUTH_ISSUER`, `MCP_PROBE_SUBJECT`. 토큰을 입력/로그 파일에 붙이지 않는다.

```powershell
pnpm mcp:provision # 새 테스트 조직/프로젝트/캠페인/1시간 grant, 기존 조직 등록 불가
# 반환 organization_id를 MCP_PROBE_ORGANIZATION_ID에 설정하고
# resource/issuer/JWKS/port를 실제 로컬 또는 승인된 스테이징 구성으로 공급
pnpm mcp:dev       # 또는 mcp:build 후 mcp:start
# write receipt의 probe ID와 sandbox org를 개인 환경에 설정
pnpm mcp:verify    # 독립 DB 연결로 nonce/hash/actor/request/audit 확인
pnpm mcp:revoke    # MCP_PROBE_GRANT_ID + sandbox org. 기존 receipt는 보존
```

외부 IdP/subject가 없는 상태에서 실제 Work 계정을 임의로 만들어 연결하지 않는다. 같은 issuer+subject는 한 grant에만 묶인다. 만료 후 갱신·주체 변경은 운영자가 별도 검토해야 하며 자동 refresh/권한 확대를 제공하지 않는다. CLI는 운영자의 DB 접근 권한으로 실행하는 관리 명령이며 OAuth 사용자 로그인 증거가 아니다. revoke는 `MCP_PROBE_USER_EMAIL`로 명시한 현재 sandbox writer를 감사 행위자로 기록하고 이전 grant 생성자를 현재 실행자로 추정하지 않는다. 장기 운영용 grant 관리 UI·retention/purge·분산 rate limiter는 범위 밖이다. 배포된 앱에는 이 CLI를 공개 endpoint로 노출하지 않는다.

## Hosted Work 플러그인 연결 검토 — 승인 후 수행할 절차

1. reviewer가 release SHA, public HTTPS resource URL(또는 별도 승인된 사설 연결 방식), 테스트 DB/조직, IdP issuer/JWKS·client 등록·PKCE/callback/scopes, 환경/비밀값 전달, 로그·rollback·테스트 grant를 검토한다. **현재 endpoint/IdP/client는 승인·구성되지 않았다.**
2. 사용자 배포 승인 후 스테이징에 한정해 배포한다. Postgres 포트를 공개하거나 임의 터널을 열지 않는다. metadata→OAuth discovery→resource audience→토큰 발급→tool 호출을 확인한다. 로컬 JWT 검증 통과는 대화형 OAuth 호환성 검증이 아니다.
3. 해당 계정/워크스페이스의 Plugins에서 Add custom MCP server와 승인된 인증·endpoint를 검토해 plugin으로 생성·설치하고 새 **hosted Work** 채팅에서 선택한다. 관리자 권한/정책에 따라 제공 여부가 달라질 수 있다. 직접 연결이 제공되지 않으면 승인된 plugin 배포 경로를 다시 결정한다. [공식 연결 절차](https://developers.openai.com/plugins/deploy/connect-chatgpt)
4. 도구 목록 3개와 입력·write 승인 표시를 확인한 뒤 capabilities→synthetic write→read를 실행한다. 별도 `mcp:verify`/DB 조회에서 probe ID·nonce·hash·actor·request·write/read audit를 비교한다. 같은 키 재시도 1행/다른 nonce conflict, 다른 조직·read-only/철회·만료 거절도 기록한다.
5. 실제 Work 채팅 참조·client/환경·tool/correlation ID·DB 확인 시각·서버 build·권한·제약을 **비공개** 증거로 남긴다. 이때만 PHASE-0-RESULTS의 MCP 판정을 write_verified로 갱신할 수 있다. SNS 탐색/외부 task 시작 가능성은 별도 실증 항목이다.

검토용 미설치 패키지는 [integrations/work-probe](../integrations/work-probe/README.md)에 있다. 로컬 Codex의 MCP 설정 파일은 hosted Work의 플러그인 설치/권한/세션 설정을 대신하지 않는다. [공식 Work MCP 설명](https://learn.chatgpt.com/docs/extend/mcp), [인증 metadata/challenge](https://developers.openai.com/plugins/build/auth)

## 테스트 기록 (2026-10-21, Asia/Seoul)

| 검사 | 로컬 결과 |
| --- | --- |
| 타입 검사 / lint / Next build / MCP build | 통과 |
| 단위 | 8건 통과 (기존 포함) |
| DB/S3/MCP 통합 | 19건 통과 (MCP/CLI 8건 + 기존 11건) |
| 실제 MCP wire/별도 Node bundle → PostgreSQL write/read | 통과, synthetic loopback client |
| 신규 migration / 이전 데이터/브리프·파일 보존 | 통과, 등록되지 않은 기존 조직 유지 |
| 대화형 OAuth 로그인 / hosted Work plugin 설치·쓰기 | 미실행·미검증 |
| 스테이징 배포 / 병합 / 운영 설정 변경 | 미실행 |

기능·테스트 코드 `7929498`의 [CI 실행 39553509808](https://github.com/kimue7057/ERUTY-Creator-Seeding-OS/actions/runs/39553509808)에서 설치/실제 PostgreSQL·S3/마이그레이션/타입/린트/단위 **8건**/DB·S3·MCP·CLI 통합 **19건**/MCP·Next 빌드/기존 Chromium **4건** 전체 통과를 확인했다. 테스트 데이터는 synthetic이며 OAuth 로그인이나 실제 Work 지원 결과가 아니다. GitHub Actions 자체 runtime 전환 안내 외 앱 lint/build 경고는 없다.

UI 변경이 없어 신규 UI 스모크를 만들지 않았다. 자동 테스트의 client 이름도 local-probe-test-not-work로 구분한다. Public 저장소/CI에는 실제 후보·Work 채팅·비밀값을 넣지 않는다.

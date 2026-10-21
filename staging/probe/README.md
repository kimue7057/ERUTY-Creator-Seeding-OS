# Synthetic MCP 스테이징 실행 구성

2026-10-21: **준비 코드이며 외부 배포·OAuth 제공자 설정 변경·Tunnel 생성·플러그인 설치·실제 Work 호출은 미실행**이다. 기존 STEP 1–5 기획/앱 DB migration은 바꾸지 않는다. 실제 SNS 발굴 기능은 없다.

## 구성과 경계

- `compose.yaml`: 전용 PostgreSQL 18 cluster/volume, Node 24 MCP 이미지, 선택적 private/HTTPS gateway. DB/MCP 포트를 인터넷에 공개하지 않는다. 기본 `up`은 DB만 시작한다.
- `init`: 빈 `eruty_probe_*` DB에서 기존 Drizzle 0000–0003을 적용하고 로그인 불가능한 synthetic operator·새 synthetic 조직·1시간 grant를 만든다. 기존 public 테이블 또는 동명 role이 있으면 거부한다. 기존 Campaign OS/Creator 앱 DB나 공유 DB cluster에 실행하지 않는다.
- MCP runtime: owner 비밀번호 없이 4개 테이블 SELECT, probe/audit INSERT만 사용한다. PostgreSQL의 `FOR SHARE` 요구 때문에 grants/workspaces/memberships의 **updated_at 한 열**만 UPDATE할 수 있다. scopes/role/revoked_at/disabled_at 변경·과거 probe 수정/삭제·일반 users/assets 읽기·DDL은 불가하다.
- verifier: 별도 read-only credential/프로세스로 세 도구 응답과 DB 및 감사 행을 대조한다. owner/runtime 계정으로 검증하면 실패한다.
- owner: migration/초기화/명시적 revoke에만 사용하는 별도 operator container. MCP container에는 owner/verifier credential·IdP secret/signing key·S3 설정이 들어가지 않는다.
- `.local/mcp-staging/`는 git/Docker build context에서 제외한다. 실제 토큰/응답/Work trace는 PR·CI artifact에 올리지 않는다. Windows에서는 이 폴더의 사용자 ACL도 제한한다. `docker compose config`는 비밀번호를 전개하므로 **`config --quiet`만 사용**한다.

## 승인 전에 준비할 값

Auth0를 기준 후보로 검토했다. 실제 tenant/app/client 생성이나 설정 변경은 하지 않았다. 다른 IdP도 아래 계약을 모두 만족해야 한다.

| 항목 | 설정 및 실제 확인 방법 |
| --- | --- |
| API/resource | `MCP_RESOURCE_URL`과 API identifier 및 JWT `aud`를 정확히 같게 한다. `/mcp`·trailing slash 포함 exact match. Tunnel에서는 이 식별자가 private여도 되지만, transport가 반환한 metadata와 일치해야 한다. |
| Auth0 resource 호환 | 전용 테스트 tenant의 **Resource Parameter Compatibility Profile** 활성화 필요. 기본 설정에서 `resource`만 보내면 올바른 API JWT가 나오지 않을 수 있다. `audience` 파라미터를 임의 추가해 Work 지원으로 간주하지 않는다. |
| issuer/JWKS | `MCP_OAUTH_ISSUER`는 discovery `issuer`·JWT `iss`와 exact match. JWKS는 동일 origin의 HTTPS, redirect 없이 RS256/ES256 서명 키 제공. Auth0 기본 경로는 `/.well-known/jwks.json`. custom domain을 쓰면 세 값의 domain을 통일한다. |
| OAuth client | Work 전용 사전 등록 public client, Authorization Code + S256 PKCE, token endpoint auth `none`. implicit/password/client_credentials 사용하지 않는다. 이 PR은 CIMD/DCR를 구현하거나 자동 등록하지 않는다. Work 관리 화면의 provided client 선택이 가능한지도 확인한다. |
| 로그인/동의 | synthetic IdP 사용자만 허용하고 두 API scope `discovery:read discovery:probe`를 허용한다. consent에서 정확한 앱/테스트 resource/두 scope 표시를 직접 확인한다. consent skip 정책을 쓰지 않는다. OIDC에 광고된 openid/email/profile 등도 해당 client에서 허용되어야 한다. |
| callback | **Work MCP 관리 화면에서 실제 표시된 redirect URI를 복사**해 exact allowlist 등록한다. wildcard 금지. issuer identification 지원 시 stable callback을 쓸 수 있고, 미지원 시 callback-ID별 URI가 달라질 수 있어 URL을 미리 확정하지 않는다. Auth0의 Include Issuer in Authorization Responses도 확인한다. |
| PKCE/state/iss | authorization request의 `response_type=code`, `resource`, `state`, `code_challenge_method=S256` 및 callback의 state/iss 일치를 operator가 확인한다. token exchange에 verifier와 동일 redirect/resource가 사용되는지 IdP 로그로 확인한다. verifier 원문을 로그/문서에 복사하지 않는다. metadata 광고만으로 실제 PKCE 교환 성공을 판정하지 않는다. |
| JWT | API access token: `sub iat exp scope`, `exp-iat <= 900초`, `aud=정확한 MCP resource`, RS256/ES256. Auth0의 API Token Expiration 및 Token Expiration For Browser Flows를 모두 900초 이하로 검토한다. opaque/ID token/기본 authenticated audience는 현 리소스 서버와 호환되지 않는다. |
| 회수 | DB grant revoke + IdP authorized grant/refresh token 철회 + Work unlink를 별도로 준비한다. provider 로그와 DB audit는 token 값 없이 보존한다. 자동 refresh 지원은 이번 PR에서 주장하지 않는다. |

`mcp:oauth:preflight`는 discovery의 issuer/JWKS/endpoint origin·code flow·S256·public client 광고를 점검한다. API scopes가 OIDC discovery에 없는 경우도 별도로 표시한다. 실제 API scope 허용은 token/Work 호출로 확인해야 한다. 선택적으로 ignored token 파일을 `MCP_PREFLIGHT_TOKEN_FILE`로 제공하면 **현 서버와 같은 JWT 검증**을 수행한다. 토큰/subject는 출력하지 않고 subject hash만 표시한다. 이 명령은 DB나 org ID 없이 실행 가능하며, 로그인·동의·callback·PKCE exchange·Work 성공은 계속 `not_tested/unverified`다.

## 로컬 준비와 승인 후 실행

사전 요구: Node 24/pnpm 11.25, Docker Engine + Compose v2, PowerShell 7 또는 CI와 같은 Linux shell. 현재 사용자 PC에는 Docker와 tunnel-client가 설치되어 있지 않다. 설치·외부 자원 생성·아래 스테이징 가동/연결은 승인 범위를 먼저 확정한다. CI Docker 실행은 runner 내부 synthetic 환경이다.

```powershell
pnpm mcp:staging:prepare
# .local/mcp-staging/.env를 로컬 편집:
# resource URL/그 URL의 host(포트 포함), issuer/JWKS/discovery,
# 검증된 synthetic subject, 검토한 commit SHA. 생성된 세 비밀번호는 노출하지 않는다.
$env:DOTENV_CONFIG_PATH = '.local/mcp-staging/.env'
pnpm mcp:oauth:preflight
$composeArgs = @('--env-file', '.local/mcp-staging/.env', '-f', 'staging/probe/compose.yaml')
docker compose @composeArgs config --quiet
docker compose @composeArgs build init

# 여기부터 승인된 테스트 환경에서만 실행. 새 전용 volume을 사용한다.
docker compose @composeArgs up -d --wait db
docker compose @composeArgs run --rm init | Out-File -Encoding utf8NoBOM .local/mcp-staging/sandbox.json
if ($LASTEXITCODE -ne 0) { throw 'Synthetic init failed; inspect locally before continuing' }
pnpm mcp:staging:prepare --sandbox
```

`sandbox.json`에는 테스트 org/project/campaign/grant/actor ID, synthetic operator email과 만료 시각만 있다. IdP subject·DB 비밀번호는 출력하지 않는다. 초기화는 1회이며 재실행/자동 grant 갱신은 지원하지 않는다. 1시간 안에 실험을 끝낼 수 있게 OAuth 준비 후 초기화한다. 실패/만료 시 기존 증거를 보존하고 새 격리 환경·새 테스트 identity로 재실험 계획을 검토한다. 데이터 volume을 임의 삭제해서 초기화하지 않는다.

### 경로 A — 공식 Secure MCP Tunnel (조건부 우선 후보)

현재 binary/tunnel ID/Platform org·Work workspace association·권한·runtime key는 확인되지 않았다. 따라서 이 계정에서 사용 가능하다고 표시하지 않는다. 승인 후 공식 최신 배포의 도움말을 먼저 확인한다. 생성자는 Tunnels Read+Manage, runtime key/Work operator는 Read+Use가 필요하다. OAuth 제공자는 사용자 브라우저/Work OAuth 교환 주체에서 접근 가능해야 한다. Tunnel이 IdP를 자동 공개하지 않는다.

```powershell
docker compose @composeArgs --profile private up -d mcp private-gateway
pnpm mcp:staging:smoke
tunnel-client help quickstart
# 승인 후 Platform의 기존 적합한 tunnel/key를 먼저 검토한다.
# runtime key는 secure local input으로 CONTROL_PLANE_API_KEY 환경 참조에 넣는다.
# 정확한 init/sample/profile 문법은 설치된 binary 도움말로 확인한다.
# HTTP MCP target: http://127.0.0.1:3310/mcp
tunnel-client doctor --profile eruty-probe --explain
tunnel-client run --profile eruty-probe
```

`private-gateway`는 host의 **127.0.0.1:3310**에만 bind하고 canonical resource Host를 MCP에 전달한다. OAuth bearer를 생성/대체하지 않는다. tunnel-client의 doctor/readiness/active polling과 Work의 Tunnel 선택을 모두 확인한다. `/healthz`·`/readyz`·admin UI는 설치된 client의 실제 주소를 사용하고 공개하지 않는다. 이 PR은 임의 tunnel profile 형식이나 tunnel ID를 만들어 넣지 않는다.

### 경로 B — OAuth로 보호된 HTTPS

승인된 전용 host/DNS/firewall·TLS 운영 주체를 정한 후에만 `https` profile을 사용한다. 이 profile 시작은 공개 ingress와 ACME 통신을 만들 수 있다. `MCP_RESOURCE_HOST`가 `MCP_RESOURCE_URL`의 host와 정확히 같아야 한다. 443은 OAuth MCP/metadata 경로만, 80은 HTTPS redirect/인증서 발급에 사용한다. DB와 MCP backend 포트는 공개하지 않는다. Vercel의 일반 Function에 장기 실행 Node 프로세스를 그대로 배포하지 않는다. 현재 코드의 검증 대상은 container host다.

```powershell
# 별도 배포 승인 후에만:
docker compose @composeArgs --profile https up -d mcp https-gateway
$env:MCP_SMOKE_URL = 'https://승인된-실제-host/mcp'
pnpm mcp:staging:smoke
```

추가 인증 프록시가 Work에 HTML 로그인/401을 돌려주거나 Authorization을 제거하면 사용할 수 없다. MCP OAuth challenge/metadata는 그대로 전달한다. 실제 TLS chain·외부 reachability·방화벽·provider 설정은 배포 후 확인할 항목이다. 배포 전 image digest와 revision label도 검토해 고정한다.

## 승인 후 ChatGPT Plugins / hosted Work 실증 체크리스트

1. [ ] 승인된 build/image digest, IdP tenant/client ID, resource/issuer/JWKS, 테스트 subject hash, synthetic org/grant와 만료 시각을 비공개 실험 기록에 남긴다. 운영 org/DB가 아님을 확인한다.
2. [ ] [ChatGPT Plugins](https://chatgpt.com/plugins) → `+` → `Add custom MCP server`. Connection은 경로 B의 **실제 `/mcp` HTTPS URL** 또는 경로 A의 **실제 Tunnel ID**다. OAuth provided client ID/`none` 및 두 scope를 설정한다. No Auth를 선택하지 않는다.
3. [ ] UI가 제공하는 실제 callback을 IdP exact allowlist와 대조하고 로그인/동의/PKCE/state/iss/token audience/JWKS 교환을 확인한다. 오류는 시각·단계·redacted provider error code와 함께 기록한다. callback URL에 붙은 code/state/token은 기록하지 않는다.
4. [ ] `Create as a plugin` 이후 도구가 정확히 `eruty_capabilities`, `write_discovery_probe`, `read_discovery_probe`인지 검토한다. 승인 후 설치하고 **새 hosted Work 채팅**에서 `@`로 이 테스트 plugin을 선택한다. 로컬 Codex MCP 설정/Inspector/API Playground 성공을 Work 성공으로 대체하지 않는다.
5. [ ] `eruty_capabilities({contract_version:1})` 실제 호출. build/org/project/campaign/principal/scopes/sandbox_only가 승인 값과 일치하는지 확인한다.
6. [ ] 로컬 `node -e "console.log(require('crypto').randomUUID())"`로 nonce와 idempotency UUID를 각각 만들고 Work에 synthetic 값만 전달한다. `write_discovery_probe({contract_version:1,nonce,idempotency_key})` 실제 호출·사용자 쓰기 확인 동작·receipt를 기록한다.
7. [ ] 반환한 probe ID로 `read_discovery_probe({contract_version:1,probe_id})` 실제 호출. nonce/hash/request_id/actor/principal/시각이 write receipt와 같은지 확인한다. 같은 UUID로 재시도했을 때 동일 ID/replayed, 다른 nonce로 같은 key를 쓸 때 conflict도 확인한다.
8. [ ] 세 실제 `structuredContent`를 로컬 파일 `.local/mcp-staging/proof.json`에 **`{"capabilities":{...},"write":{...},"read":{...}}`**로 저장한다. 원문 chat/OAuth tokens는 이 파일에 넣지 않는다. 아래 verifier를 실행한다. 다른 build/org/grant, read audit 누락, owner credential, 변경된 receipt는 실패해야 한다.

```powershell
docker compose @composeArgs run --rm verify
```

9. [ ] 별도 DB 연결의 nonce/SHA-256/시각/request/actor/principal과 write/read 감사 행을 확인한다. 비공개 Work trace/도구 호출 화면·서버 request 로그의 request_id도 사람이 대조한다. **도구 응답/파일만으로 호출 출처가 Work임을 증명할 수 없어서 verifier도 `work_connection: unverified`를 유지**한다. 실제 hosted Work trace와 DB 증거를 함께 검토한 후에만 실험 결과 문서에서 write_verified 판정한다.
10. [ ] 바로 grant를 철회하고 동일 Work 연결의 capabilities/write/read가 거부되는지 확인한다. 철회 뒤 새 probe 행이 생기면 실패다.

```powershell
docker compose @composeArgs run --rm revoke
docker compose @composeArgs run --rm verify node .local/build/mcp-staging-verify.mjs --closed
```

11. [ ] closeout의 revoked_at·revoke audit·active grant 0·기존 probe/hash/read audit 보존을 확인한다. IdP의 테스트 authorized grant/refresh token 철회, Work plugin unlink, 전용 tunnel runtime key 철회/프로세스 중지(또는 HTTPS ingress 정지)를 각각 확인한다. DB grant 철회만으로 IdP 토큰이 무효화됐다고 가정하지 않는다.
12. [ ] 제한된 감사 증거를 보존한 뒤 disposable token 파일/로컬 비밀번호·세션을 정리하고 보존/삭제 정책에 따라 테스트 volume을 처리한다. 기존 조직·멤버십·앱 데이터는 수정하지 않는다. 실패한 경우 성공 상태를 채우지 않고 어느 단계가 미검증인지 기록한다.

## 검증 기록과 보안 확인

- Native PostgreSQL integration은 별도 `eruty_probe_test_*` DB에서 실제 migration·bundle init·restricted runtime HTTP write/read·JWT/JWKS·read-only verifier·bundle revoke/closeout·과거 receipt 보존을 검증한다. 테스트 JWKS는 **로컬 fixture이며 외부 OAuth 로그인이나 Work가 아니다**.
- CI `probe-staging` job은 runner 내부 Docker image build→전용 PostgreSQL init→실제 Caddy private gateway→canonical metadata/무인증 401을 검증하고 종료한다. image push/외부 배포 job은 없다. 실제 OAuth provider나 Tunnel은 사용하지 않는다.
- 2026-10-21 GitHub 재점검: repo Public, main 보호 없음/ruleset 0, secret scanning/push protection enabled, 열린 secret alert 0, Actions secrets/environment/deployments 각각 0, 기본 workflow read 권한. 전체 이력 무비밀을 보증하는 결과는 아니다. Private 전환·보호 규칙·운영 cloud/TLS/IdP 보안 설정은 승인 필요하고 변경하지 않았다.
- 연결 도구에서 Creator Seeding 전용 Supabase project를 찾지 못했고 Vercel team 목록은 비어 있었다. 기존 `eruty-campaign-os`에는 접근/재사용하지 않았다. 전용 cloud 자원·실제 OAuth tenant·Work 권한은 아직 미확정이다.
- 기존 SDK 1.32.1 / protocol 2025-11-25 contract를 유지한다. Work가 협상한 실제 protocol/transport 오류를 기록하고 지원을 관찰한 뒤 판단한다. SDK-only 통과로 hosted Work 호환을 확정하지 않는다.

## Windows 로컬 E2E: 클라우드 서버 없이 실행

사용자가 로컬 E2E/Tunnel/OAuth 설정을 승인한 경우에만 실행한다. 기존 `compose.yaml`의 전용 PostgreSQL·MCP·private gateway를 그대로 재사용한다. 운영 조직/DB는 연결하지 않는다.

1. 검증한 공식 `tunnel-client.exe`와 번들 `cloudflared.exe`를 ignored `.local/bin/tunnel-client/`에 둔다. PowerShell 7에서 `./scripts/mcp-local-access.ps1 -Action Collect`를 직접 실행하여 Tunnel ID와 전용 Read + Use runtime key를 입력한다. 키는 Windows 사용자 DPAPI로 암호화하고 `.local/mcp-local-e2e` ACL을 현재 사용자로 제한한다. `Inspect`는 실제 org/workspace 연결을 조회한다. 키/응답 원문을 Git·채팅·CI에 복사하지 않는다.
2. Auth0 테스트 tenant 관리자 권한이 없으면 `compose.oauth-local.yaml`의 독립 Keycloak 26.8.1 + 별도 PostgreSQL을 테스트 IdP로 사용할 수 있다. **RFC 8707 `resource-indicators`는 Keycloak의 experimental 기능**이며 운영 준비 완료를 뜻하지 않는다. MCP는 Secure MCP Tunnel을 사용하고, OAuth 로그인·discovery/JWKS만 개발용 HTTPS로 연결한다.
3. 번들 `cloudflared.exe tunnel --no-autoupdate --url http://127.0.0.1:3381 --metrics 127.0.0.1:3382 --loglevel info --management-diagnostics=false`를 실행하고 로그를 private 디렉터리에만 저장한다. 출력된 실제 origin을 `.local/mcp-local-e2e/oauth-origin.json`의 `{"origin":"https://실제할당호스트.trycloudflare.com"}`에 기록한다. Quick Tunnel은 개발 전용이며 재시작하면 hostname이 바뀐다. 기존 identity를 자동 덮어쓰지 않는다.
4. `pnpm exec tsx scripts/mcp-local-oauth.ts prepare`로 합성 사용자/realm·무작위 비밀번호를 생성한다. 기존 IdP 설정이 있으면 거부한다. `.local/mcp-staging/.env`의 OAuth issuer/JWKS/metadata/실제 import subject를 설정한다. `docker compose --env-file .local/mcp-local-e2e/oauth.env -f staging/probe/compose.oauth-local.yaml up -d` 후 `pnpm exec tsx scripts/mcp-local-oauth.ts inspect`로 실제 사용자 ID와 public/S256/consent 설정을 재조회한다.
5. 외부 gateway는 테스트 realm의 OIDC/login/resource 경로만 허용한다. `/admin`, master realm, account console, DCR, MCP와 DB는 공개하지 않는다. 관리자 접근은 `127.0.0.1:3380`으로 제한한다. Keycloak의 기본 discovery가 누락한 public-client `none` 광고만 공식 SPI metadata override로 추가한다. **JWT 서명 알고리즘의 `none` 허용과는 무관하며 기존 RS256/ES256 검증을 유지한다.** 이 설정만으로 실제 PKCE/token 발급 성공을 주장하지 않는다.
6. 기존 절차대로 빈 전용 DB `init` 결과를 `.local/mcp-staging/sandbox.json`에 저장하고 `mcp:staging:prepare --sandbox`, `--profile private up -d mcp private-gateway`를 실행한다. grant는 초기화 시점부터 1시간이다. `mcp:staging:smoke`, `mcp-local-access.ps1 -Action Doctor`, `Connect`, `Status`를 실행한다. 단순 process/ready 외에 loopback health details에서 control-plane polling 성공과 OAuth discovery 완료를 확인한다. 실제 로그인 전에는 tools/list가 `auth_required/not_observed`일 수 있으며 성공으로 채우지 않는다.
7. ChatGPT Plugins에서 Connection `Tunnel`, 실제 ERUTY Tunnel, OAuth `Provided`, public client `eruty-work-probe`, 인증 방식 `none`, scopes `discovery:read discovery:probe`를 사용한다. **관리 화면의 정확한 callback**을 private `work-callback.txt`에 저장하고 `pnpm exec tsx scripts/mcp-local-oauth.ts callback`으로 allowlist를 갱신·재조회한다. 추정 callback/와일드카드를 등록하지 않는다. `mcp-local-access.ps1 -Action OAuthLogin`은 사용자 전용 별도 창에만 합성 로그인 정보를 표시한다. 사용자가 로그인/동의를 완료한다.
8. 위 hosted Work 체크리스트의 세 실제 호출→독립 `verify`→`revoke`→실제 Work 재호출 거부→`verify --closed`를 수행한다. 실험 종료 후 IdP consent/session, Work plugin, 전용 runtime key를 각각 철회하고 `mcp-local-access.ps1 -Action Stop`, HTTPS 터널 프로세스 종료, OAuth compose `stop`을 실행한다. 기존 증거/DB volume은 삭제하지 않는다.

Keycloak metadata/public client 호환성 근거: [공식 MCP 설정](https://www.keycloak.org/securing-apps/mcp-authz-server), [SPI discovery override](https://www.keycloak.org/server/all-provider-config), [기본 metadata의 none 누락 이슈](https://github.com/keycloak/keycloak/issues/49730). Quick Tunnel의 임시 URL/가용성 제약은 [Cloudflare 공식 문서](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)를 따른다.

## 공식 근거 (확인 2026-10-21)

- [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels): 사설 연결/권한/워크스페이스/외부 IdP 경계.
- [Plugins OAuth](https://developers.openai.com/plugins/build/auth): PKCE, exact callback, resource/audience, discovery.
- [Plugins 연결·테스트](https://developers.openai.com/plugins/deploy/connect-chatgpt), [Work MCP](https://learn.chatgpt.com/docs/extend/mcp): custom MCP를 plugin으로 연결 후 새 채팅에서 실제 도구 확인.
- [Auth0 resource compatibility](https://auth0.com/ai/docs/mcp/guides/resource-param-compatibility-profile): resource profile/issuer response 설정. 이 문서가 특정 tenant 설정 완료를 증명하지 않는다.

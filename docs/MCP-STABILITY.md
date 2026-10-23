# MCP diagnostics and recovery

STEP 1–3, the pinned SDK, JWT validation, scopes, campaign isolation and immutable history are preserved. Local SDK, Keycloak and Tunnel tests do not establish hosted Work success.

## Failure boundaries

Record the client time window, server `X-Request-Id` / `X-Correlation-Id` and tool `_meta.request_id`. Replayed receipts retain the original committed `request_id`; `_meta.request_id` identifies the current invocation. Only UUID correlation headers are propagated. MCP and gateway logs omit bodies, JWTs, cookies, query strings, SQL parameters and creator data. Private error records retain real stack frames and nested driver codes. Gateway logs attach server response IDs. IdP diagnostics and vendor Tunnel command IDs are separate hops; never invent a mapping without a shared trace.

Authenticated `tools/call` domain/DB failures use HTTP 200 with MCP `isError: true` and a safe structured error, status, layer, request ID, retryability and recovery. Invalid authentication, Host/Origin, HTTP input and admission failures remain HTTP failures. Initialize/tools/list still require a current grant. All tool operations recheck live authorization, including within mutation transactions.

| Failure | Recovery |
| --- | --- |
| `token_expired` / HTTP 401 | Client refresh; user login only if refresh is rejected. |
| `invalid_token` / HTTP 401 | Check exact issuer/audience, signature and time claims. Never disable validation. |
| `jwks_unavailable` / HTTP 503 | Restore IdP/network; bounded retry, no user reauthentication loop. |
| `grant_expired`, `grant_revoked`, `grant_environment_mismatch`, `grant_scope_denied` | Operator inspection; terminal for this grant. OAuth does not renew DB authority. |
| `insufficient_scope` | Reauthenticate only when a real OAuth challenge is present; distinguish DB/role denial. |
| `database_unavailable`, `database_timeout`, `transaction_retry_required` | Restore DB; bounded reads, identical payload/key for writes. |
| `invalid_input`, `idempotency_conflict`, `run_closed`, quota errors | Correct the request; no automatic retry. |
| `server_busy` / HTTP 503 | Respect Retry-After and bounded backoff. |

### Protocol negotiation versus a failed tool call

The pinned SDK remains 1.32.1. A newer client can probe `server/discover` with protocol `2026-07-28` before using the legacy `initialize` handshake. The existing SDK rejects unsupported versions with HTTP 400. The server records an authenticated, well-formed probe's rejection as `protocol_probe_rejected`, with its safe version identifier, method, request/correlation IDs and private SDK stack. Only a subsequent successful initialize/call establishes recovery; this label alone is not success. Unsupported `tools/call` versions and other SDK errors remain errors. Do not rewrite request headers, disable validation, count the probe as a DB failure, or retry a denied grant. This behavior is exercised through the real SDK and HTTP gateway; original historical requests without version/method telemetry remain unclassified. See the [SDK version-negotiation contract](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions).

### Explicit authority replacement

OAuth access-token expiry, OAuth offline-session expiry and the DB grant's `expires_at` are independent. Increasing an OAuth lifetime does not grant campaign access. Start the bounded DB authority shortly before the actual task, after infrastructure checks. A DB grant is never renewed by the supervisor, a tool, a timer or a login.

`provisionDiscoveryGrant` returns `grant_already_active` or `grant_expired_requires_rotation` rather than an opaque duplicate-index exception. The single-unrevoked-principal index is retained. To replace a genuinely expired, unrevoked grant, prepare private `.local/discovery/grant-rotation.json` with all normal explicit grant fields plus `previous_grant_id`, a fresh UUID `idempotency_key`, and `confirmation: rotate-expired-discovery-campaign-grant`. Specify the current environment hash, exact campaign allowlist, minimum scopes and a new bounded expiry. The exact prior principal/user/source must match; another organization's or revoked grant cannot be rotated.

```powershell
node --env-file=.local/discovery/operator.env --import tsx scripts/discovery-operator.ts rotate-expired-grant
```

The operator must still be a current writer. One transaction closes only that expired grant with an audit, validates and creates its replacement, and saves a durable request receipt. Invalid campaigns/expiry roll back the closure. Concurrent identical requests issue once; reusing the key with different input returns `idempotency_conflict`. Retrying identical input returns the original expiry and receipt, including after the replacement is revoked; it never reactivates authority. Private receipt files are immutable and a failed CLI call reports a safe error/request ID with redacted stack frames saved privately. This path does not create a run, initial validation permit, observation or capability pass.

### Reviewed offline-session policy

The existing operational realm and both clients were inspected with an offline idle/max of one hour, independent of 5-minute access tokens. `scripts/lib/discovery-oauth-policy.ts` prepares a partial update for Discovery's offline idle of 24 hours and absolute max of 7 days, preserving refresh rotation/reuse=0, access-token/SSO lifetimes, issuer, callbacks, scopes and audience. Since the realm maximum is shared, every other existing OIDC login client's effective old offline limits are pinned before raising that ceiling; Probe stays at one hour. New clients require explicit lifetime review. This changes how long an authorized client can refresh without a login, so operational application is a separately reviewed step. The helper itself performs no network mutation. See [Keycloak session policy](https://www.keycloak.org/docs/latest/server_admin/index.html#_offline-access).

The isolated Keycloak test mints an offline token first, applies the proposed partial policy to that disposable realm, confirms the same offline session still exists, expires the access token, refreshes into the longer bound, and rejects reuse of the old refresh token. It does not prove that a hosted client's token cache saved the new token. Operational changes require private before/after snapshots, read-back and an exact rollback plan; preserve existing users and sessions, then verify a real client refresh.

Read retry guidance: at most three attempts for transient network/503 failures, with jittered backoff. Writes never use a fresh key after an uncertain acknowledgement. Replay the identical body/key and read back the receipt. Revoked grants and submitted runs stay closed. Admission defaults to 32 requests/64 connections; pools cap at 8, with a 3-second connection budget and an idle-error handler. Discovery retains 8-second statement/5-second lock budgets. JWT clock tolerance remains zero; measure clocks before proposing a policy change.

## Local validation

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm mcp:build
pnpm test:integration
pnpm build
pnpm test:smoke
```

Run write regression tests on a disposable DB with synthetic bootstrap credentials and `E2E_ALLOW_WRITES=true`. A separate dev server can use `ERUTY_TEST_DIST_DIR=.local/stability-next` to preserve an existing dashboard. Supply private environment values through a clean child launcher rather than passing Node `--env-file` flags into Next workers. Production intentionally rejects plaintext S3; loopback S3 browser tests require the dev server.

The reliability integration test covers 20 successful context calls, six-tool discovery, same-key prepare/log replay, concurrent logging, lost observation acknowledgement, DB deduplication, receipt IDs, payload conflict, get/submit, cross-tenant/campaign denial, token expiry, grant denial, DB loss/recovery, restart and bounded concurrency. Set `MCP_VENDOR_TUNNEL_BIN` to the verified official binary and run `tests/integration/mcp-stability.test.ts` for another 20 calls through the vendor's local control-plane/dispatcher. `tests/integration/tunnel-managed-profile.test.ts` uses isolated vendor state and a local control plane to exercise actual generated-profile replacement and two fresh managed processes with the configured issuer route and payload capture disabled. Without the optional binary this one vendor-specific test is explicitly skipped. These are not hosted Work.

`pnpm test:oauth:stability` requires a loopback Keycloak and explicit `KEYCLOAK_STABILITY_ADMIN` / `KEYCLOAK_STABILITY_PASSWORD`. It creates only a random synthetic realm, tests S256, expiry, offline-session policy migration with the existing synthetic session, normal rotated refresh and rejection of old-token reuse, then removes only that realm. Operational users/clients/sessions are untouched. CI supplies its own disposable Keycloak container.

## Environment inspection and local restart

```powershell
node --env-file=.local/discovery/operator.env --import tsx scripts/mcp-diagnose.ts discovery
./scripts/mcp-local-access.ps1 -Mode discovery -Action Doctor
./scripts/mcp-local-access.ps1 -Mode discovery -Action Status
./scripts/mcp-local-access.ps1 -Mode probe -Action Doctor
```

The read-only diagnostic checks resource/issuer metadata, JWKS/clocks, runtime health and optional verifier grant state. It does not obtain user tokens or prove a hosted call. Match the attempt window in MCP/gateway, Tunnel, Keycloak and DB logs. No local records and unchanged dispatcher counters narrow the failure to the upstream connection path; they do not identify a specific Plugin OAuth exception. Inspect admin-side configuration and the original support/error ID before declaring that root cause.

Vendor 0.0.16 `runtimes connect` unconditionally regenerates YAML and reuses an existing process for the same tunnel. Editing YAML before Connect therefore loses issuer routing, and setting launch environment without replacing the old process leaves it unchanged. The helper validates durable operator inputs, keeps a private `.routing.json` snapshot, loads only five allowlisted routing/logging overrides, stops the existing managed process and launches the same alias/ID/key. The managed child inherits those overrides despite regenerated YAML. The helper mirrors them back for offline Doctor, then verifies the live issuer selection, configured Harpoon route, readiness and disabled payload capture; it saves a private `tunnel-routing-verification.json` receipt. Parent environment is restored. Use this helper for subsequent connections; raw vendor Connect does not preserve these settings. Unfamiliar YAML or unsupported routing constraints are refused, and profile backups are retained. An authorized local reconnection uses the same profile:

This behavior is visible in the pinned vendor's [Manager.Connect](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/manager.go) and [WriteRuntimeProfile / childEnv](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/session/session.go), and is exercised by the optional real-binary regression above.

```powershell
./scripts/mcp-local-access.ps1 -Mode discovery -Action Connect
./scripts/mcp-local-access.ps1 -Mode discovery -Action Status
```

Do not loop reconnect for terminal grant denial. Startup `auth_required` can be expected; ready/live is not tools/call success. Historical dispatcher upstream 400/403 counters are not proof of DB/network failure. Containers use bounded logs, process liveness, graceful shutdown and restart-unless-stopped. Health probes use native HTTP because some fetch runtimes ignore custom Host headers. Liveness does not claim authenticated readiness.

For a Windows PC kept running, `scripts/mcp-local-supervise.ps1` can run as a current-user, limited Task Scheduler action independently of the chat's terminal. Its `-CheckOnly` mode performs one read-only check. The supervisor compares live issuer, target and logging settings, checks both public issuer and local gateway before transport recovery, and caps connection attempts at three per outage. It does not sign users in, rotate origins, renew grants or create discovery data. It waits for an operator if the configured issuer is unavailable. Run only with the machine's normal PowerShell policy; do not bypass that policy. Keep Node available on the task's PATH and keep the task running without an execution time limit. A host-side process health check is not hosted Work acceptance.

Inspect actual container restart policies as well as Compose files: changing YAML does not update existing containers. Apply a reviewed runtime policy to the existing named services without recreating their database volumes. Recovery commands must pass the existing Compose project name explicitly; a shared file's default project can target a different staging stack.

The existing canonical resource-metadata challenge points at an internal resource origin, which the local runtime does not trust. The runtime can log that rejected discovery attempt before successfully using its local well-known metadata. Distinguish that fallback warning from failure to fetch the configured authorization server. Do not add wildcard origins or rewrite the canonical OAuth resource to silence it. A verified issuer route fixes the latter; it does not by itself explain an upstream Plugin `-32603`.

## Fixed issuer migration and hosted acceptance

A Quick Tunnel hostname can change on restart. Exact issuer/JWKS, Keycloak hostname, both MCP configs, audience/resource mappings, both Tunnel profiles and ChatGPT's stored Authorization Server must agree. Preserve the current issuer/sessions while validating a candidate fixed HTTPS origin in a separate realm/client and isolated DB. Check TLS, metadata/JWKS, S256, callback issuer identification, both audiences, refresh, deny paths and rollback. A controlled DNS name and explicit cutover approval are prerequisites. This change performs no domain switch, callback rewrite or purchase. Build/issuer changes alter the environment hash; any new minimal grant requires explicit operator review and cannot repair a client routing error.

The user performs admin login, plugin authorization and hosted Work browser launch. Inspect the existing tunnel/issuer/client/scopes first. Obtain real hosted context structuredContent, or preserve its original error/support ID and timestamp. Then perform directly visited SNS observation → read → independent PostgreSQL proof → dashboard comparison. Prior research and local tests cannot substitute for that path. STEP 3 remains unverified until it succeeds.

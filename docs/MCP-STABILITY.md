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

`pnpm test:oauth:stability` requires a loopback Keycloak and explicit `KEYCLOAK_STABILITY_ADMIN` / `KEYCLOAK_STABILITY_PASSWORD`. It creates only a random synthetic realm, tests S256, expiry, offline-session existence, normal rotated refresh and rejection of old-token reuse, then removes only that realm. Existing users/clients/sessions are untouched. CI supplies its own disposable Keycloak container.

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

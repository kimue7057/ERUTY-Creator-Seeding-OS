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

The reliability integration test covers 20 successful context calls, six-tool discovery, same-key prepare/log replay, concurrent logging, lost observation acknowledgement, DB deduplication, receipt IDs, payload conflict, get/submit, cross-tenant/campaign denial, token expiry, grant denial, DB loss/recovery, restart and bounded concurrency. Set `MCP_VENDOR_TUNNEL_BIN` to the verified official binary and run `tests/integration/mcp-stability.test.ts` for another 20 calls through the vendor's local control-plane/dispatcher. This is not hosted Work.

`pnpm test:oauth:stability` requires a loopback Keycloak and explicit `KEYCLOAK_STABILITY_ADMIN` / `KEYCLOAK_STABILITY_PASSWORD`. It creates only a random synthetic realm, tests S256, expiry, offline-session existence, normal rotated refresh and rejection of old-token reuse, then removes only that realm. Existing users/clients/sessions are untouched. CI supplies its own disposable Keycloak container.

## Environment inspection and local restart

```powershell
node --env-file=.local/discovery/operator.env --import tsx scripts/mcp-diagnose.ts discovery
./scripts/mcp-local-access.ps1 -Mode discovery -Action Doctor
./scripts/mcp-local-access.ps1 -Mode discovery -Action Status
./scripts/mcp-local-access.ps1 -Mode probe -Action Doctor
```

The read-only diagnostic checks resource/issuer metadata, JWKS/clocks, runtime health and optional verifier grant state. It does not obtain user tokens or prove a hosted call. Match the attempt window in MCP/gateway, Tunnel, Keycloak and DB logs. No local records and unchanged dispatcher counters narrow the failure to the upstream connection path; they do not identify a specific Plugin OAuth exception. Inspect admin-side configuration and the original support/error ID before declaring that root cause.

Connect/Doctor validate the existing tunnel ID/target and persist exact issuer routing in generated profiles, retaining earlier profile backups. Unfamiliar YAML is refused. DPAPI runtime keys are retained; payload capture stays disabled. This removes reliance on temporary parent environment variables. An authorized local reconnection uses the same profile:

```powershell
./scripts/mcp-local-access.ps1 -Mode discovery -Action Connect
./scripts/mcp-local-access.ps1 -Mode discovery -Action Status
```

Do not loop reconnect for terminal grant denial. Startup `auth_required` can be expected; ready/live is not tools/call success. Historical dispatcher upstream 400/403 counters are not proof of DB/network failure. Containers use bounded logs, process liveness, graceful shutdown and restart-unless-stopped. Health probes use native HTTP because some fetch runtimes ignore custom Host headers. Liveness does not claim authenticated readiness.

## Fixed issuer migration and hosted acceptance

A Quick Tunnel hostname can change on restart. Exact issuer/JWKS, Keycloak hostname, both MCP configs, audience/resource mappings, both Tunnel profiles and ChatGPT's stored Authorization Server must agree. Preserve the current issuer/sessions while validating a candidate fixed HTTPS origin in a separate realm/client and isolated DB. Check TLS, metadata/JWKS, S256, callback issuer identification, both audiences, refresh, deny paths and rollback. A controlled DNS name and explicit cutover approval are prerequisites. This change performs no domain switch, callback rewrite or purchase. Build/issuer changes alter the environment hash; any new minimal grant requires explicit operator review and cannot repair a client routing error.

The user performs admin login, plugin authorization and hosted Work browser launch. Inspect the existing tunnel/issuer/client/scopes first. Obtain real hosted context structuredContent, or preserve its original error/support ID and timestamp. Then perform directly visited SNS observation → read → independent PostgreSQL proof → dashboard comparison. Prior research and local tests cannot substitute for that path. STEP 3 remains unverified until it succeeds.

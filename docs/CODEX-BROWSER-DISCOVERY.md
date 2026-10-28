# Codex direct browser discovery

## Selected browser account

An operator can select an existing SNS account in the local, ignored `.local/discovery/codex-browser/browser-preferences.private.json` file. This is a browser/account preference, not a credential or a discovery authorization. It must not contain passwords or cookies, and it never changes the campaign/request scope.

```json
{
  "version": 1,
  "platforms": {
    "youtube": {
      "browser_family": "chrome",
      "extension_instance_id": "UUID_FROM_THE_ACTUAL_BROWSER_INVENTORY",
      "account_label": "Selected account display name",
      "account_email": "selected-account@example.invalid"
    }
  }
}
```

Read this preference before navigating the requested SNS. Obtain the actual host browser inventory and match `metadata.extensionInstanceId`; numeric browser IDs are local to a tool session and can be reordered. Select that exact connection with the documented browser API and use its returned browser ID for a new task tab. Verify the platform's actual account menu against the selected account email and label before any discovery search or content visit. If the connection is unavailable, authorization surface is incompatible, or the account cannot be verified, stop and report the actual setup mismatch without switching to a different/personal account or inventing SNS evidence. Existing saved results remain intact.

Account selection does not authorize login, purchase, or history/privacy changes. Do not turn off, clear, or restore personal watch/search history automatically. New CLI executions read the current preference through the installed discovery skill; updating it does not interrupt an already running execution. Keep the repository skill and installed copy in sync. Account names and stable browser IDs stay in this private local file, never in committed skill instructions or public PRs.

## Dashboard request workflow

With migration 0014 and a connected automatic worker, the request button launches Codex CLI without a chat handoff. See [automatic execution](AUTOMATIC-CODEX-DISCOVERY.md). The manual flow below remains available when automatic execution is disabled. An automatic assignment already has a claimed authorization and prepared run; do not claim it again.

The 2026-10-27 extension adds a real request queue and scoped collection of 1–20 distinct accounts per platform. In campaign discovery, save a request, copy its execution instructions into Codex, then use the installed discovery skill. The dashboard does not automatically launch a Codex session or browser. Requests preserve the targeting/context hash; a changed campaign requires a new request. Cancellation preserves observations and prevents further collection. A claim lasts at most four hours and can be replayed by the same operator/execution without issuing another run.

Enable `CODEX_DISCOVERY_ENABLED=true` for both the dashboard and restricted local runtime. Apply migration `0011` after backup; reapply `staging/discovery/runtime-grants.sql` to the existing restricted runtime role. It can read/claim/attach requests, but cannot create dashboard requests or human reviews. No old Work grants, memberships or capability receipts are changed.

Create a private operator identity file inside `.local/discovery/codex-browser/` containing only `organization_id` and `user_id` of the current operator. This is a local process adapter, not an HTTP credential. All calls check current membership/role. For commands below, replace the placeholder paths/IDs with actual private files and the dashboard's returned request ID:

```powershell
node --env-file=.local/discovery/codex-browser/runtime.env --import tsx scripts/codex-discovery.ts requests .local/discovery/codex-browser/operator.json
node --env-file=.local/discovery/codex-browser/runtime.env --import tsx scripts/codex-discovery.ts claim .local/discovery/codex-browser/operator.json <request-id> iab <private-execution-reference>
node --env-file=.local/discovery/codex-browser/runtime.env --import tsx scripts/codex-discovery.ts context <returned-authorization-file>
node --env-file=.local/discovery/codex-browser/runtime.env --import tsx scripts/codex-discovery.ts collect <returned-authorization-file> <candidate-batch-file>
node --env-file=.local/discovery/codex-browser/runtime.env --import tsx scripts/codex-discovery.ts submit <returned-authorization-file> <submission-manifest-file>
```

Each candidate batch uses the format described below, with `prepare_key` equal to the dashboard request ID and without `submit_key`. Use new stable log/observation keys per candidate. `collect` validates all captures before writing, records the candidate and reports `lock_version`, distinct-account counts and remaining slots. Exact replay creates no duplicate observations. A failure-only batch has only failed/blocked logs, no observation and no artifacts. It never creates a creator.

The submission manifest contains `prepare_key`, `submit_key`, `expected_lock_version` (from the latest collection), `outcome` (`submitted`, `partial`, `blocked` or `failed`) and `limitations`. Preserve this file and keys for lost-acknowledgement replay. Submission means awaiting human review, even when the requested count was reached.

Human review has two independent requirements: accept the original profile/content evidence, and review the browser execution from actual SNS searches/captures. The run page records execution-review verdict/reason separately and binds it to the immutable context/environment. Neither hashes nor an ordinary evidence acceptance alone attest execution. Unreviewed/synthetic/manual sources cannot pass. Once both checks pass, STEP 4 can use these candidates; an actual Codex evaluation JSON can be imported as `codex_import`, distinct from Work. Final approval still requires a current evaluation, reviewed cited evidence and acknowledged unknowns. A new execution review invalidates older evaluation input hashes. Nothing sends messages or executes outreach.

Acceptance checks: request idempotency and tenant/role scoping; changed-context/cancelled/forged claims rejected; sequential two-candidate collection, capture tampering and lost-response replay checked under a restricted role; original-evidence plus execution review gates evaluation approval; later review invalidates approval. Integration fixtures are synthetic and isolated, never proof of actual SNS discovery.

## Preserved single-candidate pilot

The user authorized a Work-free desktop Codex browser pilot on 2026-10-27. Keep the approved product/SNS-native search requirements and historical Work evidence. This adapter adds `codex_browser`; it never claims `work_manual_task` or changes the approved PRD. Terminal Codex CLI still needs separate browser tooling.

The initial scope was one real candidate, original native search/profile/content captures, core-service persistence, immediate read-back, independent verifier and dashboard comparison. Existing runs remain pending until the new explicit human execution review; the migration never approves them automatically. No outreach, Work capability attestation, automatic final approval or Work/Tunnel changes.

Apply additive migration `0010` after a private DB/roles backup. It appends one nullable browser trace column and a new execution-source constraint, leaving old rows and migration hashes untouched. Existing restricted Discovery runtime and verifier table privileges cover the new column. Do not run tests/seed against the operating database. Run the CLI with a restricted runtime connection, never the owner connection. Local authorization is a private operator-issued file, not an HTTP credential or public MCP tool. Existing Work grant/capability rules are unchanged.

Create `.local/discovery/codex-browser/<execution>/authorization.json` with UUID `authorization_id`, current `organization_id`/`user_id`, one `campaign_id`/`platform`, `browser_surface` (`iab` or `chrome`), private `execution_reference`, `issued_at`, `expires_at` (at most four hours), `max_creators:1` and `confirmation:"authorize-one-codex-browser-run"`. The same authorization creates only one run. Each call rechecks expiry, current membership and campaign; role revocation blocks writes. Changing the file changes the environment hash and cannot mutate its old run.

The private runtime env must contain the restricted `DATABASE_URL` and `CODEX_DISCOVERY_ENABLED=true`. It contains no SNS cookies. Commands:

```powershell
node --env-file=.local/discovery/codex-browser/runtime.env --import tsx scripts/codex-discovery.ts context .local/discovery/codex-browser/<execution>/authorization.json
node --env-file=.local/discovery/codex-browser/runtime.env --import tsx scripts/codex-discovery.ts save .local/discovery/codex-browser/<execution>/authorization.json .local/discovery/codex-browser/<execution>/batch.json
```

`batch.json` contains stable UUID `prepare_key`/`submit_key`, `logs` using the existing append-log fields without `run_id`, and `observation` using existing observation fields without `run_id`/`expected_context_sha256`/`search_log_id`. Supply one successful native search and successful profile/content log with actual observation times. `artifacts` lists `{kind,file,sha256}` for captured JSON files with `{source_url,observed_at,visible_text,query?}`. Files must resolve inside the private directory and match hashes/log URLs/times. Search query must match. The adapter pins all run/context bindings, refuses Work trace claims, preserves the original receipt, and reuses stable keys after a lost acknowledgement. Hashes protect capture integrity; source authenticity still requires human review of the real browser execution.

To stop the pilot, remove `CODEX_DISCOVERY_ENABLED=true` or let the authorization expire. Do not delete stored runs/evidence or reactivate old grants. Keep runtime credentials and captures out of Git/PRs. Versioned skill source is `skills/eruty-codex-discovery/SKILL.md`; install a copy into the user's Codex skills folder.

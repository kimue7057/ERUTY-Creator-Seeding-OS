# Codex direct browser pilot

The user authorized a Work-free desktop Codex browser pilot on 2026-10-27. Keep the approved product/SNS-native search requirements and historical Work evidence. This adapter adds `codex_browser`; it never claims `work_manual_task` or changes the approved PRD. Terminal Codex CLI still needs separate browser tooling.

The initial scope is one real candidate, original native search/profile/content captures, core-service persistence, immediate read-back, independent verifier and dashboard comparison. No outreach, capability attestation, automatic final approval or Work/Tunnel changes. Codex browser runs remain pending even after ordinary evidence acceptance; broader provenance-review support is deferred explicitly.

Apply additive migration `0010` after a private DB/roles backup. It appends one nullable browser trace column and a new execution-source constraint, leaving old rows and migration hashes untouched. Existing restricted Discovery runtime and verifier table privileges cover the new column. Do not run tests/seed against the operating database. Run the CLI with a restricted runtime connection, never the owner connection. Local authorization is a private operator-issued file, not an HTTP credential or public MCP tool. Existing Work grant/capability rules are unchanged.

Create `.local/discovery/codex-browser/<execution>/authorization.json` with UUID `authorization_id`, current `organization_id`/`user_id`, one `campaign_id`/`platform`, `browser_surface` (`iab` or `chrome`), private `execution_reference`, `issued_at`, `expires_at` (at most four hours), `max_creators:1` and `confirmation:"authorize-one-codex-browser-run"`. The same authorization creates only one run. Each call rechecks expiry, current membership and campaign; role revocation blocks writes. Changing the file changes the environment hash and cannot mutate its old run.

The private runtime env must contain the restricted `DATABASE_URL` and `CODEX_DISCOVERY_ENABLED=true`. It contains no SNS cookies. Commands:

```powershell
node --env-file=.local/discovery/codex-browser/runtime.env --import tsx scripts/codex-discovery.ts context .local/discovery/codex-browser/<execution>/authorization.json
node --env-file=.local/discovery/codex-browser/runtime.env --import tsx scripts/codex-discovery.ts save .local/discovery/codex-browser/<execution>/authorization.json .local/discovery/codex-browser/<execution>/batch.json
```

`batch.json` contains stable UUID `prepare_key`/`submit_key`, `logs` using the existing append-log fields without `run_id`, and `observation` using existing observation fields without `run_id`/`expected_context_sha256`/`search_log_id`. Supply one successful native search and successful profile/content log with actual observation times. `artifacts` lists `{kind,file,sha256}` for captured JSON files with `{source_url,observed_at,visible_text,query?}`. Files must resolve inside the private directory and match hashes/log URLs/times. Search query must match. The adapter pins all run/context bindings, refuses Work trace claims, preserves the original receipt, and reuses stable keys after a lost acknowledgement. Hashes protect capture integrity; source authenticity still requires human review of the real browser execution.

To stop the pilot, remove `CODEX_DISCOVERY_ENABLED=true` or let the authorization expire. Do not delete stored runs/evidence or reactivate old grants. Keep runtime credentials and captures out of Git/PRs. Versioned skill source is `skills/eruty-codex-discovery/SKILL.md`; install a copy into the user's Codex skills folder.

---
name: eruty-codex-discovery
description: Execute an ERUTY dashboard discovery request in the Codex desktop app, directly search Instagram, TikTok or YouTube, and save scoped candidates with original evidence. Use for creator discovery without hosted Work.
---

Read `docs/CODEX-BROWSER-DISCOVERY.md` in the ERUTY repository for the current local command and private authorization contract. Work from the actual implementation checkout, not the original design handoff folder.

Use the browser tool provided by the host. The desktop app can operate its in-app browser; use an existing signed-in Chrome profile when the user requests it or the in-app browser fails. A terminal-only CLI needs separately configured browser tooling; this skill does not supply browser control. Do not start another Work chat.

Read the pinned campaign through the local `context` command. Use justified campaign category names for the structured categories; keep original SNS labels in notes so translation differences do not silently become category mismatches. Keep its platform, geography and follower conditions. Open the SNS itself and use its search UI. Open a returned profile and a recent original content page. Capture the actual search query, source URLs, observation times and rendered text with available browser tools. Record login, CAPTCHA and access failures rather than inventing candidates. Never infer audience country from residence or language.

For a dashboard request, use `requests` and `claim` from the repository guide with the private operator identity file and restricted runtime env. Claim only the requested ID, surface and execution reference; the command saves the DB-bound private authorization. Request storage does not launch Codex or open a browser. Keep the pinned campaign, platform, count (1–20) and four-hour expiry. If the campaign changed, cancel/recreate the request rather than editing its authorization. A legacy pilot authorization is still limited to one candidate.

Keep captures and stable-key batches under `.local/discovery/codex-browser/`; never commit real creator lists, captures, receipts or credentials. Capture files contain `source_url`, `observed_at`, `visible_text` and optional `query`. Preserve raw metric text and rounded/unknown precision; a relative date is not an exact publication timestamp.

After actual source inspection, call `collect` once per candidate with matching capture hashes and logs. Use the dashboard request ID as `prepare_key`, new stable observation/log keys for each candidate, and reuse exactly the same keys after a lost acknowledgement. Re-read each saved result. Duplicate accounts do not fill remaining slots. Stop at the requested distinct-account count; preserve observed access failures in a failure-only batch without an invented observation. Finish with `submit` using the returned lock version, a stable submission key and honest limitations. An incomplete request is submitted as partial or blocked. Legacy `save` is only for the one-candidate pilot.

Compare returned evidence with independent DB rows and the dashboard. Saved candidates remain `verification_pending` until a human separately accepts their profile/content evidence and reviews the original browser execution. Do not perform those human reviews or final suitability approval yourself. Local captures do not attest hosted Work. Do not use `codex_test` for real observations, create observations through arbitrary SQL, or reuse Work grants to impersonate Work.

The skill authorizes no outreach. Do not email, DM, follow, like or comment. Use only the local campaign authorization already explicitly approved for this task.

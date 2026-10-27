---
name: eruty-codex-discovery
description: Directly explore Instagram, TikTok or YouTube for an ERUTY campaign in the Codex desktop app, capture original evidence, and save one scoped candidate through the local Discovery adapter. Use for real creator discovery without hosted Work.
---

Read `docs/CODEX-BROWSER-DISCOVERY.md` in the ERUTY repository for the current local command and private authorization contract. Work from the actual implementation checkout, not the original design handoff folder.

Use the browser tool provided by the host. The desktop app can operate its in-app browser; use an existing signed-in Chrome profile when the user requests it or the in-app browser fails. A terminal-only CLI needs separately configured browser tooling; this skill does not supply browser control. Do not start another Work chat.

Read the pinned campaign through the local `context` command. Use justified campaign category names for the structured categories; keep original SNS labels in notes so translation differences do not silently become category mismatches. Keep its platform, geography and follower conditions. Open the SNS itself and use its search UI. Open a returned profile and a recent original content page. Capture the actual search query, source URLs, observation times and rendered text with available browser tools. Record login, CAPTCHA and access failures rather than inventing candidates. Never infer audience country from residence or language.

For the initial pilot, use one candidate per explicit private authorization, at most four hours. Keep captures and the stable-key batch JSON under `.local/discovery/codex-browser/`; never commit real creator lists, raw captures, private receipts or credentials. Capture files contain `source_url`, `observed_at`, `visible_text` and optional `query`. Preserve raw metric text and rounded/unknown precision; a relative date is not an exact publication timestamp.

Only after actual source inspection, call the local `save` command with matching capture hashes and stable idempotency keys. Read the returned evidence and independently compare its DB rows and dashboard. Keep `codex_browser`, `awaiting_review` and `verification_pending`. Local captures do not attest hosted Work or become verified through this pilot. Do not use `codex_test` for real observations, write arbitrary SQL to create observations, or reuse Work grants to impersonate Work.

The skill authorizes no outreach. Do not email, DM, follow, like or comment. Use only the local campaign authorization already explicitly approved for this task.

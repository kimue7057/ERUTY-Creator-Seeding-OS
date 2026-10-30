# Campaign workspace UX

Scope: make a campaign the place to request discovery, compare automatically recommended creators, make a final human selection, and revisit progress and original evidence. Keep existing targeting, scoring, source validation, permissions, audit history and worker execution unchanged.

Acceptance:
- Campaign tabs: 후보 검토, 선정 명단, 진행·기록, 캠페인 설정. Bookmarks identify the tab and candidate; closing details restores list focus and scroll.
- Processing and interrupted assessments are separate from insufficient information, recommendations and human decisions. No queued creator appears as needing human review.
- Compact comparable candidate rows open an accessible detail panel. Original sources, unknown scores and explicit human acknowledgement remain available before final selection.
- Home and campaign lists lead to the next task. The review inbox contains current recommendations and information-insufficient candidates awaiting a human decision, with direct candidate links.
- Existing discovery/evaluation URLs and historical records remain accessible as detailed records. No active worker restart or real human decision is required for the UI release.
- Verify disjoint presentation states, tenant/read-only access, discovery request, selection persistence, deep links, keyboard focus and mobile overflow in an isolated browser fixture; run quality checks and verify the staged production release before promotion.

Human decision correction:
- AI recommendation is advice. A writer can select a current, completed candidate marked information-insufficient or excluded after acknowledging unknowns and recording their own selection reason. Original-source integrity, current campaign scope and role checks still apply.
- Selection, hold and exclusion controls stay visible while reading details. Existing human selections can be changed with an audit trail; AI scores and unknown facts remain unchanged.
- Information-insufficient candidates are visible in the review inbox and have an explicit entry point from an empty recommendation screen. Verify selecting and excluding these candidates through the browser and independent DB read-back, not only the recommended-candidate path.

Creator review usability correction (2026-10-30):
- A real, read-only walkthrough confirmed that channels were mixed behind a small dropdown, profiles had no list shortcut, content links were hidden inside disclosures, and the primary selection action was disabled before the reviewer knew how to proceed. Earlier checks established technical eligibility but did not establish a usable entry action.
- Treat the main journey as: choose SNS channel → compare candidates → open profile/content in another tab → read fit and unknowns → select/hold/exclude → continue to the next candidate → revisit the selection list.
- Show all three channel filters, including zero counts, in the campaign workspace and review inbox. Channel counts describe all candidates (or selected candidates in the selected tab); state counts follow the chosen channel. A result line identifies the combined channel/state/search result, with a reset action for empty combinations.
- Persist channel, search and sort in the URL. Keep that context when changing workspace tabs, reviewing a candidate, reloading, or returning from SNS. Changing the state/channel starts a new review queue.
- Place validated profile and captured-content links on each list row and in a fixed detail header. Original evidence URLs are visible without opening a disclosure. Open links in a new tab with noreferrer/noopener; do not invent handles, media, follower data or source URLs.
- `최종 선정` starts an explicit confirmation step instead of being disabled for an unchecked acknowledgement or missing reason. `선정 확정` validates missing fields visibly and moves focus to the first missing input. Only saving, already-selected status, and genuine source/permission restrictions disable applicable actions. Backend acknowledgement/reason/source rules remain unchanged.
- Keep hold/exclude one-step decisions. Show a persisted receipt, next-candidate action and change-decision path after saving. Review order is fixed when opening the list; completed decisions leave the pending list when details close. Selecting the next candidate cannot inherit the previous candidate's acknowledgement or reason.
- Verify a synthetic three-channel journey, new-tab source navigation, missing-acknowledgement and missing-reason recovery, persisted selection/hold/exclusion, next-candidate progression, filters across reload/back navigation, empty channels, read-only access and mobile layouts. Never save a real creator decision for release verification.

Remaining product boundaries:
- Direct SNS links may require the user's SNS login; the app does not bypass platform login or provide embedded media.
- Missing audience/engagement facts remain missing. Human selection records a decision; it does not turn AI unknowns into verified information.
- Multi-campaign review shows bounded recent results; automated outreach and contracts remain separate future work.

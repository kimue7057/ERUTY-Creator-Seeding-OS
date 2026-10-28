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

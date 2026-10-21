# PHASE 1 — STEP 1 + STEP 2 working MVP

## Deliverables
1. New standalone responsive web app, authenticated access, left navigation: Projects, Campaigns; later steps appear clearly disabled or planned, never as fake working features.
2. Projects index/create/edit/detail screen. Project names are arbitrary, with '리플러츠' and '베베도르' usable as **example labels only**; no invented proprietary brand claims or copyrighted asset population.
3. Within a project: products CRUD, brand text/USP/style, links, versioned secure file uploads and asset list (PDF/image/video accepted within configured limits).
4. Campaign index/create/edit/detail linked to one project. Inputs: campaign name, related products, countries multiple selection, platform multiple selection, category, follower min/max, goal custom or preset, notes/exclusions, optional budget/timing.
5. Project brief snapshot on campaign detail showing linked brand/products and assets; targeting independent across campaigns. Persist immutable revision reference or effective snapshot at campaign creation to provide historical evaluation reproducibility.
6. DB schemas/migrations, server-side validation, basic search/filter, loading/errors/empty state, role-aware access and audit fields.
7. `README.md` with local Windows setup, env variable examples (without secret values), migrations, seeding with **synthetic** fixtures, tests and run commands.

## Acceptance checks
- I can create a project '리플러츠', attach one product and upload a test image/PDF, refresh and see the same records.
- I can create a separate project '베베도르'; project data/permissions are not mixed.
- I can create JP/TikTok and US/Instagram campaigns under the same project with different follower filters; revisiting either preserves its own targeting.
- I can select multiple countries and platforms; invalid min/max follower bounds are rejected.
- New campaigns automatically link project brand and assets without requiring reupload.
- File type/size rules, access permissions, and failed requests show clear error states.
- No fictitious creator search or real email sending button claims successful execution.
- Typecheck/lint/build/tests pass and a basic browser smoke test is documented.

## Explicit non-goals for Phase 1
- No production SNS crawling, no Google-only creator search feature, no Gmail sending, no contract execution, no performance polling.
- No fake 'Start Work' automation button. A future Discovery view may display a labeled 'Work 실행 안내' and a copyable task brief, but only if it is clearly not an integrated launch.

## Suggested code boundaries
- `src/app/(app)/projects/*`, `src/app/(app)/campaigns/*`
- `src/lib/db`, `src/lib/auth`, `src/lib/storage`, `src/lib/validation`
- `src/components/projects`, `src/components/campaigns`, `src/components/layout`
- migrations and tests beside relevant features
- Adapt to the chosen Next.js project convention; don't add unnecessary monorepo infrastructure.

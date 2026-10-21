# Repository instructions for Codex

## Product boundaries
- This is a **new, standalone ERUTY Creator Seeding OS**. Do not modify or import code from ERUTY Campaign OS without an explicit task.
- `docs/PRD-v1.2.md` is the product source of truth. STEP 1-4 are locked functional decisions; STEP 5's fixed-design-template + AI-written-content principle is locked; STEP 6-7 remain baseline scope for later development.
- `docs/PHASE-1-MVP.md` defines the current implementation scope. Do not silently implement future phases or invent external integrations.
- Work's **direct platform visit/search** is required for STEP 3. Google-only lookups and influencer-vendor search APIs cannot be silently substituted for SNS-native search.
- Do **not** claim an external dashboard can start a GPT Work session automatically until verified against a supported integration path.

## Engineering expectations
- Stack target: Next.js App Router, TypeScript, Tailwind, PostgreSQL; choose one simple ORM with migrations. File uploads need object storage abstraction and metadata in the DB.
- Use a clear server/client boundary, typed schemas and runtime validation for inputs.
- Multi-tenant-ready project data and role-scoped access; avoid leaking one project's assets into another campaign.
- Store audit fields (`created_at`, `updated_at`, actor ID), source evidence/verification status, and no duplicated creator identity across campaigns.
- Protect secrets in environment variables, never commit credentials, session cookies, private emails or real influencer lists as fixtures.
- Real external email send and contractual actions always require user approval. Provide safe dry-run paths in development.
- Never bypass third-party site access controls, login challenges, scraping limits, or platform rules.
- Keep Work/browser connector adapters behind interfaces; use a manual-import/mock adapter only when clearly labeled, not as fake live Work integration.

## Workflow
- Start each feature with a short scope/acceptance plan. Make changes in small reviewable pull requests.
- For code changes run available typecheck, lint, unit tests and build; for UI flows run or document browser smoke checks.
- Record incomplete dependencies and site/API constraints explicitly. Do not present placeholders as functioning automation.
- Update only relevant docs and migration notes when implementation alters them. Do not rewrite the approved PRD without asking.
- Keep `README.md` updated with setup and run instructions, sample `.env.example`, and demo commands.

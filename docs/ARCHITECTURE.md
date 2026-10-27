# Architecture and integration contracts

## Proposed starting stack
- Web: Next.js + React + TypeScript + Tailwind CSS + accessible component library.
- Server: Next.js server actions / API routes for the first MVP; split workers when background jobs begin.
- Persistence: PostgreSQL with one migration-managed TypeScript ORM (Prisma or Drizzle; document the choice).
- Assets: private, S3-compatible object storage and DB metadata. Signed URLs and file type/size validation.
- Authentication: real team sign-in and server-side permissions before production deployment.
- Quality: ESLint, typecheck, unit tests, integration tests for relationships, Playwright smoke tests.
- Source control: GitHub, branch PRs, CI. Never sync live source code by copying it into cloud-drive folders.

## Data model (v1 target)
- `users`, `organizations` / `organization_memberships` (if single tenant initially, design namespace explicitly)
- `projects` (name, site, brand_style, summary, owner)
- `products` (project_id, name, features, URL, metadata)
- `project_assets` (project_id, optional product_id, kind, object_path, version, provenance)
- `campaigns` (project_id, title, country_codes[], platforms[], categories, follower_min/max, goal_count, notes, budget, status)
- `campaign_products` (campaign_id, product_id) if more than one product selected

## Later tables (reserve contracts, not all built in phase 1)
- `creators`, `creator_accounts` (unique platform+platform_creator_id or canonical URL)
- `campaign_creators` (unique campaign+account, current pipeline status)
- `discovery_runs`, `discovery_searches`, `creator_evidence`
- `evaluations`, `review_decisions`
- `email_templates`, `email_drafts`, `send_jobs`, `email_threads`, `email_messages`
- `contracts`, `deliverables`, `performance_snapshots`, `campaign_reports`, `audit_events`

## Work browser integration: explicit uncertainty

현재 Codex 실행 경로는 [원격 Codex 안내](REMOTE-CODEX-DISCOVERY.md)를 따른다. Vercel 웹앱/Neon DB가 캠페인과 요청을 공유하고, 각 PC의 Codex 데스크톱 브라우저가 SNS 내부 탐색을 수행한다. 발굴 전용 HTTPS API는 토큰·현재 소속/역할·claim 범위를 검증하고 원본 텍스트 캡처를 수정 불가 이력으로 저장한다. Work MCP 경로와 기존 로컬 DB 실행은 별도로 보존한다.
**Do not assume a supported external API for starting standard ChatGPT Work sessions.**

Path A (Stage-0 baseline): human starts a Work task in ChatGPT, cloud browser navigates to a target SNS. The Work result is written to an ERUTY MCP tool if the environment and connection support the needed write actions; test these permissions and tool calls with a tiny project. If unsupported, use a documented manual verified CSV import as a temporary bridge. Mark data as `manual_import`, never `verified_by_work` without evidence.

Path B (later optional automation): independently evaluate available Agents API/browser control or supported agent API. This is a runtime alternative to starting ordinary GPT Work; do not call it the same thing. Preserve native SNS exploration and the same discovery data contract.

Potential MCP tools after feasibility:
- `get_project_brief(project_id)`
- `get_campaign_targeting(campaign_id)`
- `start_discovery_run(campaign_id, platform, execution_mode)`
- `upsert_creator_account(platform, canonical_profile_url, verified_facts, evidence)`
- `attach_creator_to_campaign(campaign_id, creator_account_id, run_id)`
- `complete_discovery_run(run_id, results, constraints)`
- All writes are idempotent and authenticated with least privilege; enforce schema validation and audit records.

## Privacy/security and operations
- Never expose Gmail or SNS account cookies/passwords in app, logs or fixtures.
- Separate staff account connections from public user credentials, validate access at all API entry points.
- Respect platform terms and access controls; stop and record restrictions rather than working around them.
- Separate employer's user approval of outbound emails/contract terms from informational agent steps.
- Preserve source URLs, timestamps, statuses and failure reasons for trustworthy reporting.

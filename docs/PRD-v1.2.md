# Product Requirements — ERUTY Creator Seeding OS v1.2

## Product vision
Manage the end-to-end influencer seeding lifecycle with a **Work-first SNS-native discovery** core, human-controlled approvals, and a reusable creator database.

## Scope and locked decisions
- **STEP 1 — Project library (locked):** Brand/project records (e.g., 리플러츠, 베베도르), website, brand narrative and visual identity, product catalog, features/USP, files (PDF, images, videos, style guides), reference URLs, versioned assets and AI-derived project summary. Project is above campaign; records reusable across campaigns.
- **STEP 2 — Independent campaign targeting (locked):** Link to project and relevant product(s); campaign title, target countries (multi-select), platforms (Instagram/TikTok/YouTube, multi-select), creator categories, min/max follower counts, goal 50/100/300/500 or custom, extra targeting or exclusion criteria, optional budget/schedule. Brand information inherited by reference, targeting not stored on projects.
- **STEP 3 — GPT Work direct SNS discovery (locked):** Work browser opens selected SNS domain and uses internal search, hashtags, relevant videos/accounts, then opens original creator profiles and recent content for verification. Google/web search only as supplemental candidate discovery; web-only candidate remains `verification_pending` until SNS source inspected. Log the source, evidence, time, attempt outcome, site restrictions, and deduplication. Do not invent inaccessible data.
- **STEP 4 — AI scoring + human approval (locked):** Campaign-specific score out of 100: product fit 30, brand style fit 20, target audience fit 20, content/activity 15, engagement 10, partnership feasibility 5. Log source-based reasons, confidence, risk flags, reviewer notes, reviewer ID/time. Approve / hold / reject. Only approved creators go to outreach. Do not confuse audience country with creator residence or infer audience geography without evidence.
- **STEP 5 — Fixed email template library + AI writes copy (direction locked):** Prebuild 4 design templates: personalized text, brand visual, formal proposal, short follow-up. Staff selects design, AI writes subject/body using approved project and campaign facts and creator-specific verified observations, translates/localizes language. Provide draft, preview, edit, approval, individual/batch scheduling and send status. Separate template layout from generated message. Send only after explicit approval. Observe applicable commercial email, consent and unsubscribe rules.
- **STEP 6 — Reply + negotiation CRM (baseline):** Threaded email sync, reply classification, multilingual summary, proposed responses, no-response follow-up reminders, offer terms/budget/deliverables negotiation and approval. Distinguish sent, delivered, open (only when verifiable), replied, interested, negotiation, rejected, unsubscribed, agreement.
- **STEP 7 — Contract/performance lifecycle (baseline):** Contract/statement-of-work, compensation and product/shipping costs, deliverables, deadlines, disclosure checks, approval, posting URLs, snapshots at configurable intervals, views/reach/engagement/clicks/attributed conversions when obtainable, settlement, final report, actual-vs-predicted creator performance, reusable collaboration history.

## Primary actors
- Admin: workspace/project/account permissions, billing and integration config
- Campaign Manager: create projects and campaigns, approve outreach, track results
- Reviewer: human approval and quality control
- Agent: discovery/evaluation/drafts via constrained tools and credentials

## Information architecture
1. Projects: brand, products, assets, reference library
2. Campaigns: targeting and campaign-specific configuration
3. Discovery Center: direct-SNS discovery jobs, evidence, progress
4. Creator Evaluation: scores, evidence, human approval
5. Outreach Studio: templates, AI drafts, send approval
6. Inbox/CRM: threaded replies, follow-up, negotiations
7. Contracts & Performance: delivery, posting, metrics, closure
8. Global Creator DB: de-duplicated identity & history
9. Settings: users, roles, integrations, retention, audit

## Important invariants
- Each creator account has a stable canonical identity per SNS; the same creator may be in multiple campaigns with different scores and statuses.
- A creator's profile attributes and campaign-specific decisions are stored separately.
- Each discovery data field can be marked verified/unverified with original-source evidence and timestamp.
- Public profile evidence does not imply actual audience geography. If unknown, leave unknown.
- No real emails/contracts/charges without an explicit staff approval path.
- Visual UI must distinguish placeholders, simulations and real connected data.

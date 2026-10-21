# Roadmap & gates

| Phase | Scope | Completion gate |
|---|---|---|
| 0: browser feasibility | Work directly opens Instagram/TikTok/YouTube, native search and profiles; MCP write attempt | Evidence-backed compatibility matrix and explicit launch path decision |
| 1: data + dashboard | Project/brand/product/asset library, campaign targeting | Persisted functional STEP 1-2 UI, tests, demo |
| 2: discovery + review | Direct-SNS Work workflow, stable DB schema, creator dedupe, evaluation scoring and approvals | An actually observed Work result is saved with source evidence; human approves selected candidates |
| 3: outreach + CRM | 4 design templates, AI-written content, draft review, Gmail send and reply monitoring | Approved messages can be sent with audited user approval; replies tracked by thread |
| 4: contracts + metrics | Contract & delivery lifecycle, post metrics, costs and reporting | Campaign closes with sourced metrics, verified gaps, final report |

## Rules
- Scope every Codex work item to one phase, one acceptance set, one reviewable PR.
- Phase 0 should begin *before or alongside* Phase 1 implementation; it informs Phase 2 runtime selection.
- Do not auto-switch SNS native search to influencer data APIs as a hidden implementation choice.
- Maintain issue/task log with status, owner, dependency, evidence, branch, test result, decision.
- Production launch also requires domain/email compliance review, security permissions, backups, audit, retention and monitoring.

## Initial task breakdown for Codex
1. `foundation-01`: repo bootstrap, app skeleton, CI quality checks, README, env example.
2. `projects-01`: schema/CRUD and project UI.
3. `projects-02`: products, assets, secure uploads.
4. `campaigns-01`: campaign schema/form, country/platform multi-select, validation.
5. `campaigns-02`: project link + snapshot/version logic; smoke and integration tests.
6. `discovery-00`: inspect Work direct SNS result matrix, decide integration adapter and data contract.
7. `discovery-01`: evidence-backed creator upsert/dedupe and import/MCP tool boundary.
8. `evaluation-01`: scoring rules + confidence + review state model.

All further outreach and reporting tasks remain backlog until earlier gates pass.

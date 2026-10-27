-- Apply as the migration owner to the dedicated cloud DB, migrations 0000–0012.
-- The web app can administer its product flows; workers receive only API tokens.
GRANT CONNECT ON DATABASE neondb TO eruty_seeding_app;
GRANT USAGE ON SCHEMA public TO eruty_seeding_app;
GRANT SELECT ON organizations,users,organization_memberships,discovery_capability_receipts TO eruty_seeding_app;
GRANT UPDATE(updated_at) ON organizations,users,organization_memberships TO eruty_seeding_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON sessions,login_attempts,discovery_browser_sessions TO eruty_seeding_app;
GRANT SELECT,INSERT,UPDATE ON projects,products,campaigns,project_assets,asset_uploads,creator_accounts,campaign_creators,discovery_runs,discovery_browser_requests TO eruty_seeding_app;
GRANT SELECT,INSERT,DELETE ON campaign_products TO eruty_seeding_app;
GRANT SELECT,INSERT ON campaign_brief_revisions,campaign_asset_references,project_asset_versions,audit_events,creator_account_aliases,discovery_evidence,discovery_logs,discovery_requests,discovery_evidence_reviews,discovery_browser_run_reviews,discovery_browser_captures,creator_evaluations,creator_evaluation_reviews,evaluation_requests TO eruty_seeding_app;
GRANT UPDATE(state,error_code,updated_at) ON evaluation_requests TO eruty_seeding_app;

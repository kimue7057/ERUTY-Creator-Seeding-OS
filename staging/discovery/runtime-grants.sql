-- Operator applies AFTER creating a dedicated LOGIN role and migrations 0000–0008.
-- Supply the role password only through a private operator session, never in this file/CI.
-- This file creates no role, credentials, memberships, grants or capability attestations.
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO eruty_discovery_runtime', current_database()); END $$;
GRANT USAGE ON SCHEMA public TO eruty_discovery_runtime;
GRANT SELECT ON organization_memberships,campaigns,campaign_brief_revisions,
  discovery_runs,creator_accounts,creator_account_aliases,discovery_evidence,
  discovery_logs,campaign_creators,discovery_evidence_reviews,discovery_requests,
  discovery_capability_receipts,discovery_mcp_grants,discovery_grant_campaigns
  TO eruty_discovery_runtime;
GRANT SELECT ON discovery_operating_approvals,discovery_operating_campaigns TO eruty_discovery_runtime;
-- PostgreSQL row SHARE locks need a column UPDATE privilege; policy fields stay read-only.
GRANT UPDATE(updated_at) ON discovery_operating_approvals TO eruty_discovery_runtime;
GRANT INSERT ON discovery_runs,creator_accounts,creator_account_aliases,discovery_evidence,
  discovery_logs,campaign_creators,discovery_requests,audit_events TO eruty_discovery_runtime;
GRANT UPDATE(updated_at) ON organization_memberships,campaigns,discovery_mcp_grants TO eruty_discovery_runtime;
GRANT UPDATE(status,started_at,submitted_at,outcome_summary,limitations,lock_version,updated_by,updated_at) ON discovery_runs TO eruty_discovery_runtime;
GRANT UPDATE(platform_account_id,identity_state,canonical_profile_url,current_handle,display_name,last_seen_at,updated_by,updated_at) ON creator_accounts TO eruty_discovery_runtime;
GRANT UPDATE(valid_to) ON creator_account_aliases TO eruty_discovery_runtime;
GRANT UPDATE(discovery_state,updated_by,updated_at) ON campaign_creators TO eruty_discovery_runtime;

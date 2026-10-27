CREATE TABLE discovery_browser_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, campaign_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('instagram','tiktok','youtube')), requested_count integer NOT NULL CHECK (requested_count BETWEEN 1 AND 20),
  context_sha256 text NOT NULL CHECK (context_sha256 ~ '^[a-f0-9]{64}$'), targeting_snapshot jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','claimed','cancelled')), idempotency_key uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id), claimed_by uuid, claimed_at timestamptz, expires_at timestamptz,
  browser_surface text, execution_reference text, authorization_sha256 text, run_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT browser_request_key UNIQUE(organization_id,created_by,idempotency_key),
  CONSTRAINT browser_request_campaign_fk FOREIGN KEY(organization_id,project_id,campaign_id) REFERENCES campaigns(organization_id,project_id,id),
  CONSTRAINT browser_request_creator_fk FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id),
  CONSTRAINT browser_request_claimant_fk FOREIGN KEY(organization_id,claimed_by) REFERENCES organization_memberships(organization_id,user_id),
  CONSTRAINT browser_request_run_fk FOREIGN KEY(organization_id,project_id,campaign_id,platform,run_id) REFERENCES discovery_runs(organization_id,project_id,campaign_id,platform,id),
  CONSTRAINT browser_request_claim CHECK (state <> 'claimed' OR (claimed_by IS NOT NULL AND claimed_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at > claimed_at AND expires_at <= claimed_at + interval '4 hours' AND browser_surface IS NOT NULL AND browser_surface IN ('iab','chrome') AND execution_reference IS NOT NULL AND authorization_sha256 IS NOT NULL AND authorization_sha256 ~ '^[a-f0-9]{64}$'))
);
CREATE INDEX browser_request_campaign_time ON discovery_browser_requests(organization_id,campaign_id,created_at);
--> statement-breakpoint
CREATE TABLE discovery_browser_run_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, campaign_id uuid NOT NULL, run_id uuid NOT NULL,
  context_sha256 text NOT NULL CHECK (context_sha256 ~ '^[a-f0-9]{64}$'), environment_sha256 text NOT NULL CHECK (environment_sha256 ~ '^[a-f0-9]{64}$'),
  verdict text NOT NULL CHECK (verdict IN ('accepted','rejected','needs_review')), reason text NOT NULL, reviewed_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT browser_review_run_fk FOREIGN KEY(organization_id,project_id,campaign_id,run_id) REFERENCES discovery_runs(organization_id,project_id,campaign_id,id),
  CONSTRAINT browser_review_member_fk FOREIGN KEY(organization_id,reviewed_by) REFERENCES organization_memberships(organization_id,user_id)
);
CREATE INDEX browser_review_latest ON discovery_browser_run_reviews(organization_id,run_id,created_at);
CREATE TRIGGER browser_review_immutable BEFORE UPDATE OR DELETE ON discovery_browser_run_reviews FOR EACH ROW EXECUTE FUNCTION eruty_discovery_append_only();
--> statement-breakpoint
CREATE FUNCTION eruty_browser_request_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Browser request history is immutable' USING ERRCODE='23514'; END IF;
  IF (NEW.id,NEW.organization_id,NEW.project_id,NEW.campaign_id,NEW.platform,NEW.requested_count,NEW.context_sha256,NEW.targeting_snapshot,NEW.idempotency_key,NEW.created_by,NEW.created_at)
     IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.project_id,OLD.campaign_id,OLD.platform,OLD.requested_count,OLD.context_sha256,OLD.targeting_snapshot,OLD.idempotency_key,OLD.created_by,OLD.created_at)
     OR OLD.state='cancelled' AND NEW IS DISTINCT FROM OLD
     OR OLD.state='claimed' AND NEW.state NOT IN ('claimed','cancelled')
     OR OLD.state='claimed' AND (NEW.claimed_by,NEW.claimed_at,NEW.expires_at,NEW.browser_surface,NEW.execution_reference,NEW.authorization_sha256) IS DISTINCT FROM (OLD.claimed_by,OLD.claimed_at,OLD.expires_at,OLD.browser_surface,OLD.execution_reference,OLD.authorization_sha256)
     OR OLD.run_id IS NOT NULL AND NEW.run_id IS DISTINCT FROM OLD.run_id THEN
    RAISE EXCEPTION 'Browser request scope and claim are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER browser_request_history BEFORE UPDATE OR DELETE ON discovery_browser_requests FOR EACH ROW EXECUTE FUNCTION eruty_browser_request_history();
--> statement-breakpoint
ALTER TABLE creator_evaluations DROP CONSTRAINT evaluation_source;
ALTER TABLE creator_evaluations ADD CONSTRAINT evaluation_source CHECK (source IN ('work_import','codex_import','openai_api'));

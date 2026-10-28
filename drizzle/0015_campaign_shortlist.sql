ALTER TABLE creator_evaluations ADD CONSTRAINT evaluation_account_identity UNIQUE(organization_id,campaign_id,creator_account_id,id);
--> statement-breakpoint
CREATE TABLE creator_assessment_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, campaign_id uuid NOT NULL, creator_account_id uuid NOT NULL,
 input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'), input_snapshot jsonb NOT NULL,
 state text NOT NULL DEFAULT 'queued', recommendation text, source_eligible text NOT NULL,
 worker_id uuid, instance_id uuid, attempts integer NOT NULL DEFAULT 0, error_code text, evaluation_id uuid,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT assessment_input UNIQUE(organization_id,campaign_id,creator_account_id,input_sha256),
 FOREIGN KEY(organization_id,campaign_id,creator_account_id) REFERENCES campaign_creators(organization_id,campaign_id,creator_account_id),
 FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,worker_id) REFERENCES discovery_browser_workers(organization_id,id),
 FOREIGN KEY(organization_id,campaign_id,creator_account_id,evaluation_id) REFERENCES creator_evaluations(organization_id,campaign_id,creator_account_id,id),
 CONSTRAINT assessment_state CHECK(state IN ('queued','running','completed','failed','cancelled') AND source_eligible IN ('yes','no') AND attempts BETWEEN 0 AND 3),
 CONSTRAINT assessment_result CHECK((state='completed') = (evaluation_id IS NOT NULL AND recommendation IS NOT NULL) AND (recommendation IS NULL OR recommendation IN ('recommended','needs_info','excluded')))
);
CREATE UNIQUE INDEX assessment_worker_active ON creator_assessment_jobs(worker_id) WHERE state='running';
CREATE INDEX assessment_queue ON creator_assessment_jobs(organization_id,state,created_at);
--> statement-breakpoint
CREATE FUNCTION preserve_assessment_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Assessment history is immutable' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.campaign_id,NEW.creator_account_id,NEW.input_sha256,NEW.input_snapshot,NEW.source_eligible,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.campaign_id,OLD.creator_account_id,OLD.input_sha256,OLD.input_snapshot,OLD.source_eligible,OLD.created_by,OLD.created_at) OR OLD.state='completed' THEN RAISE EXCEPTION 'Assessment scope and results are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER assessment_scope BEFORE UPDATE OR DELETE ON creator_assessment_jobs FOR EACH ROW EXECUTE FUNCTION preserve_assessment_scope();

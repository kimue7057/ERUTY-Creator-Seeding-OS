CREATE TABLE outreach_chat_previews (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, account_id uuid NOT NULL, campaign_id uuid NOT NULL,
 sender_username text NOT NULL CHECK(sender_username ~ '^[a-z0-9._]{1,30}$'), targets jsonb NOT NULL,
 goal integer NOT NULL CHECK(goal BETWEEN 1 AND 5), state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','completed','partial','blocked')),
 worker_id uuid, instance_id uuid, claim_hash text, claim_expires_at timestamptz,
 results jsonb NOT NULL DEFAULT '[]', created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,account_id) REFERENCES outreach_sender_accounts(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,worker_id) REFERENCES discovery_browser_workers(organization_id,id),
 CHECK(jsonb_typeof(targets)='array' AND jsonb_array_length(targets) BETWEEN 1 AND 15 AND goal<=jsonb_array_length(targets)),
 CHECK(jsonb_typeof(results)='array' AND jsonb_array_length(results)<=jsonb_array_length(targets)),
 CHECK(state='queued' OR (worker_id IS NOT NULL AND instance_id IS NOT NULL AND claim_hash IS NOT NULL AND claim_expires_at IS NOT NULL))
);
CREATE UNIQUE INDEX chat_preview_one_account ON outreach_chat_previews(organization_id,account_id) WHERE state IN ('queued','running');
CREATE INDEX chat_preview_history ON outreach_chat_previews(organization_id,created_at DESC);
--> statement-breakpoint
CREATE FUNCTION protect_outreach_chat_preview() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Chat preview history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.account_id,NEW.campaign_id,NEW.sender_username,NEW.targets,NEW.goal,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.account_id,OLD.campaign_id,OLD.sender_username,OLD.targets,OLD.goal,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Chat preview target is immutable' USING ERRCODE='23514'; END IF;
 IF NOT ((OLD.state='queued' AND NEW.state='running') OR (OLD.state='running' AND NEW.state IN ('completed','partial','blocked'))) THEN RAISE EXCEPTION 'Chat preview transition is closed' USING ERRCODE='23514'; END IF;
 IF OLD.state='running' AND (NEW.worker_id,NEW.instance_id,NEW.claim_hash,NEW.claim_expires_at) IS DISTINCT FROM (OLD.worker_id,OLD.instance_id,OLD.claim_hash,OLD.claim_expires_at) THEN RAISE EXCEPTION 'Chat preview claim is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_outreach_chat_preview BEFORE UPDATE OR DELETE ON outreach_chat_previews FOR EACH ROW EXECUTE FUNCTION protect_outreach_chat_preview();

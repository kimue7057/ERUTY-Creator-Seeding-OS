ALTER TABLE discovery_browser_workers ADD COLUMN outreach_ready text NOT NULL DEFAULT 'no' CHECK(outreach_ready IN ('yes','no'));
CREATE TABLE outreach_browser_sends (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, account_id uuid NOT NULL, draft_id uuid, draft_revision integer,
 sender_username text NOT NULL CHECK(sender_username ~ '^[a-z0-9._]{1,30}$'), recipient_username text NOT NULL CHECK(recipient_username ~ '^[a-z0-9._]{1,30}$'), body text NOT NULL CHECK(length(body) BETWEEN 1 AND 1000), input_sha256 text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','preparing','armed','sent','blocked','unknown','cancelled')),
 worker_id uuid, instance_id uuid, claim_hash text, claim_expires_at timestamptz, armed_at timestamptz, sent_at timestamptz, observation jsonb, observation_sha256 text, reason text,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,account_id) REFERENCES outreach_sender_accounts(organization_id,id),
 FOREIGN KEY(organization_id,draft_id) REFERENCES outreach_drafts(organization_id,id),
 FOREIGN KEY(organization_id,worker_id) REFERENCES discovery_browser_workers(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id),
 CHECK(state NOT IN ('preparing','armed','sent','unknown') OR (worker_id IS NOT NULL AND instance_id IS NOT NULL AND claim_hash IS NOT NULL AND claim_expires_at IS NOT NULL)),
 CHECK(state NOT IN ('armed','sent','unknown') OR armed_at IS NOT NULL),
 CHECK(state<>'sent' OR (sent_at IS NOT NULL AND observation IS NOT NULL AND observation_sha256 IS NOT NULL))
);
CREATE INDEX browser_outreach_queue ON outreach_browser_sends(organization_id,created_at) WHERE state='queued';
CREATE INDEX browser_outreach_history ON outreach_browser_sends(organization_id,account_id,created_at DESC);
CREATE UNIQUE INDEX browser_outreach_one_pending_recipient ON outreach_browser_sends(organization_id,account_id,recipient_username) WHERE state IN ('queued','preparing','armed','unknown');
CREATE UNIQUE INDEX browser_outreach_one_worker ON outreach_browser_sends(worker_id) WHERE state IN ('preparing','armed');
--> statement-breakpoint
CREATE FUNCTION protect_browser_outreach_send() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Browser outreach history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.account_id,NEW.draft_id,NEW.draft_revision,NEW.sender_username,NEW.recipient_username,NEW.body,NEW.input_sha256,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.account_id,OLD.draft_id,OLD.draft_revision,OLD.sender_username,OLD.recipient_username,OLD.body,OLD.input_sha256,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Browser outreach target and approval are immutable' USING ERRCODE='23514'; END IF;
 IF NOT ((OLD.state='queued' AND NEW.state IN ('preparing','cancelled','blocked')) OR (OLD.state='preparing' AND NEW.state IN ('armed','cancelled','blocked')) OR (OLD.state='armed' AND NEW.state IN ('sent','unknown'))) THEN RAISE EXCEPTION 'Browser outreach transition is closed' USING ERRCODE='23514'; END IF;
 IF OLD.state<>'queued' AND (NEW.worker_id,NEW.instance_id,NEW.claim_hash,NEW.claim_expires_at) IS DISTINCT FROM (OLD.worker_id,OLD.instance_id,OLD.claim_hash,OLD.claim_expires_at) THEN RAISE EXCEPTION 'Browser outreach claim is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.armed_at IS NOT NULL AND NEW.armed_at IS DISTINCT FROM OLD.armed_at THEN RAISE EXCEPTION 'Browser outreach send permit is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER browser_outreach_history BEFORE UPDATE OR DELETE ON outreach_browser_sends FOR EACH ROW EXECUTE FUNCTION protect_browser_outreach_send();

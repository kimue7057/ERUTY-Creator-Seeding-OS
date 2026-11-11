ALTER TABLE outreach_chat_previews ADD COLUMN mode text NOT NULL DEFAULT 'open', ADD COLUMN source_preview_id uuid, ADD COLUMN messages jsonb NOT NULL DEFAULT '[]';
ALTER TABLE outreach_chat_previews ADD CONSTRAINT chat_preview_scoped_id UNIQUE(organization_id,id), ADD CONSTRAINT chat_preview_source_scope FOREIGN KEY(organization_id,source_preview_id) REFERENCES outreach_chat_previews(organization_id,id);
ALTER TABLE outreach_chat_previews ADD CONSTRAINT chat_preview_mode CHECK(
 (mode='open' AND source_preview_id IS NULL AND messages='[]'::jsonb) OR
 (mode='compose' AND source_preview_id IS NOT NULL AND jsonb_typeof(messages)='array' AND jsonb_array_length(messages)=jsonb_array_length(targets) AND jsonb_array_length(messages)=goal AND goal<=5)
);
DROP INDEX chat_preview_one_account;
CREATE UNIQUE INDEX chat_preview_one_running_account ON outreach_chat_previews(organization_id,account_id) WHERE state='running';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_outreach_chat_preview() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Chat preview history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.account_id,NEW.campaign_id,NEW.sender_username,NEW.targets,NEW.goal,NEW.created_by,NEW.created_at,NEW.mode,NEW.source_preview_id,NEW.messages) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.account_id,OLD.campaign_id,OLD.sender_username,OLD.targets,OLD.goal,OLD.created_by,OLD.created_at,OLD.mode,OLD.source_preview_id,OLD.messages) THEN RAISE EXCEPTION 'Chat preview target and text are immutable' USING ERRCODE='23514'; END IF;
 IF NOT ((OLD.state='queued' AND NEW.state='running') OR (OLD.state='running' AND NEW.state IN ('completed','partial','blocked'))) THEN RAISE EXCEPTION 'Chat preview transition is closed' USING ERRCODE='23514'; END IF;
 IF OLD.state='running' AND (NEW.worker_id,NEW.instance_id,NEW.claim_hash,NEW.claim_expires_at) IS DISTINCT FROM (OLD.worker_id,OLD.instance_id,OLD.claim_hash,OLD.claim_expires_at) THEN RAISE EXCEPTION 'Chat preview claim is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

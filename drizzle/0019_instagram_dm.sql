ALTER TABLE outreach_drafts ADD COLUMN instagram_conversation jsonb;
ALTER TABLE outreach_drafts ADD CONSTRAINT outreach_draft_scope UNIQUE(organization_id,id);
CREATE TABLE instagram_dm_sends (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, account_id uuid NOT NULL, draft_id uuid,
 conversation_id text NOT NULL, sender_provider_id text NOT NULL, from_username text NOT NULL,
 recipient_id text NOT NULL, recipient_username text NOT NULL, body text NOT NULL CHECK(length(body) BETWEEN 1 AND 1000), input_sha256 text NOT NULL,
 status text NOT NULL DEFAULT 'sending' CHECK(status IN ('sending','sent','failed','unknown')),
 error_code text, graph_code integer, graph_subcode integer, provider_message_id text, sent_at timestamptz,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,account_id) REFERENCES outreach_sender_accounts(organization_id,id),
 FOREIGN KEY(organization_id,draft_id) REFERENCES outreach_drafts(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id)
);
CREATE INDEX instagram_dm_account ON instagram_dm_sends(organization_id,account_id,created_at DESC);
CREATE INDEX instagram_dm_pending ON instagram_dm_sends(organization_id,account_id,conversation_id) WHERE status IN ('sending','unknown');
--> statement-breakpoint
CREATE FUNCTION protect_instagram_dm_send() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'DM history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.account_id,NEW.draft_id,NEW.conversation_id,NEW.sender_provider_id,NEW.from_username,NEW.recipient_id,NEW.recipient_username,NEW.body,NEW.input_sha256,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.account_id,OLD.draft_id,OLD.conversation_id,OLD.sender_provider_id,OLD.from_username,OLD.recipient_id,OLD.recipient_username,OLD.body,OLD.input_sha256,OLD.created_by,OLD.created_at) OR NOT (OLD.status='sending' AND NEW.status IN ('sent','failed','unknown')) THEN RAISE EXCEPTION 'DM attempt is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER instagram_dm_history BEFORE UPDATE OR DELETE ON instagram_dm_sends FOR EACH ROW EXECUTE FUNCTION protect_instagram_dm_send();

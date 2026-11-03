CREATE TABLE outreach_sender_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, provider text NOT NULL, label text NOT NULL, expected_identity text NOT NULL,
 provider_id text, identity text, addresses jsonb NOT NULL DEFAULT '[]', scopes text[] NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'pending', token_ciphertext text, expires_at timestamptz, verified_at timestamptz,
 created_by uuid NOT NULL, updated_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT sender_scope UNIQUE(organization_id,id), CONSTRAINT sender_expected UNIQUE(organization_id,provider,expected_identity), CONSTRAINT sender_provider_identity UNIQUE(organization_id,provider,provider_id),
 FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id), FOREIGN KEY(organization_id,updated_by) REFERENCES organization_memberships(organization_id,user_id),
 CONSTRAINT sender_provider CHECK(provider IN ('google','instagram','tiktok')), CONSTRAINT sender_status CHECK(status IN ('pending','connected','reconnect','disconnected')),
 CONSTRAINT sender_connected CHECK(status<>'connected' OR (provider_id IS NOT NULL AND identity IS NOT NULL AND token_ciphertext IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE TABLE outreach_oauth_states (
 state_hash text PRIMARY KEY, organization_id uuid NOT NULL, account_id uuid NOT NULL, user_id uuid NOT NULL, session_hash text NOT NULL, verifier_ciphertext text NOT NULL, aliases text NOT NULL CHECK(aliases IN ('yes','no')),
 expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,account_id) REFERENCES outreach_sender_accounts(organization_id,id), FOREIGN KEY(organization_id,user_id) REFERENCES organization_memberships(organization_id,user_id)
);
CREATE TABLE outreach_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, campaign_id uuid NOT NULL, creator_account_id uuid NOT NULL, input_sha256 text NOT NULL,
 channel text NOT NULL CHECK(channel IN ('email','instagram','tiktok')), subject text NOT NULL DEFAULT '', body text NOT NULL DEFAULT '', template text NOT NULL DEFAULT 'letter' CHECK(template IN ('letter','brand')),
 sender_account_id uuid, from_address text NOT NULL DEFAULT '', to_address text NOT NULL DEFAULT '', recipient_source text NOT NULL DEFAULT '', revision integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sending','sent','failed','unknown')), provider_message_id text, sent_at timestamptz,
 created_by uuid NOT NULL, updated_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,campaign_id,creator_account_id) REFERENCES campaign_creators(organization_id,campaign_id,creator_account_id),
 FOREIGN KEY(organization_id,sender_account_id) REFERENCES outreach_sender_accounts(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id), FOREIGN KEY(organization_id,updated_by) REFERENCES organization_memberships(organization_id,user_id)
);
CREATE INDEX outreach_drafts_creator ON outreach_drafts(organization_id,campaign_id,creator_account_id,created_at DESC);
--> statement-breakpoint
CREATE FUNCTION protect_outreach_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Outreach history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.campaign_id,NEW.creator_account_id,NEW.input_sha256,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.campaign_id,OLD.creator_account_id,OLD.input_sha256,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Outreach scope is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.status<>'draft' AND ((NEW.subject,NEW.body,NEW.template,NEW.sender_account_id,NEW.from_address,NEW.to_address,NEW.recipient_source,NEW.channel,NEW.revision) IS DISTINCT FROM (OLD.subject,OLD.body,OLD.template,OLD.sender_account_id,OLD.from_address,OLD.to_address,OLD.recipient_source,OLD.channel,OLD.revision) OR NOT (OLD.status='sending' AND NEW.status IN ('sent','failed','unknown'))) THEN RAISE EXCEPTION 'Delivery snapshots are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outreach_history_guard BEFORE UPDATE OR DELETE ON outreach_drafts FOR EACH ROW EXECUTE FUNCTION protect_outreach_history();

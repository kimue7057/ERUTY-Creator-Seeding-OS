CREATE TABLE outreach_provider_apps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, provider text NOT NULL CHECK(provider IN ('google','instagram','tiktok')),
 credentials_ciphertext text NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by uuid NOT NULL, updated_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,provider), FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id), FOREIGN KEY(organization_id,updated_by) REFERENCES organization_memberships(organization_id,user_id)
);
CREATE TABLE outreach_brand_settings (
 organization_id uuid PRIMARY KEY, branding jsonb NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by uuid NOT NULL, updated_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id), FOREIGN KEY(organization_id,updated_by) REFERENCES organization_memberships(organization_id,user_id)
);
CREATE TABLE outreach_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, name text NOT NULL, channel text NOT NULL CHECK(channel IN ('email','instagram','tiktok')),
 language text NOT NULL CHECK(language IN ('한국어','English')), layout text NOT NULL CHECK(layout IN ('letter','brand','proposal','followup')), subject text NOT NULL, body text NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), archived_at timestamptz,
 created_by uuid NOT NULL, updated_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id), FOREIGN KEY(organization_id,updated_by) REFERENCES organization_memberships(organization_id,user_id)
);
CREATE INDEX outreach_template_org ON outreach_templates(organization_id,archived_at,updated_at DESC);
ALTER TABLE outreach_sender_accounts ADD COLUMN app_fingerprint text;
ALTER TABLE outreach_oauth_states ADD COLUMN app_fingerprint text;
ALTER TABLE outreach_drafts ADD COLUMN branding jsonb NOT NULL DEFAULT '{"companyName":"","signature":"","color":"#28543e","website":""}';
ALTER TABLE outreach_drafts ADD COLUMN language text NOT NULL DEFAULT 'English';
ALTER TABLE outreach_drafts ADD COLUMN purpose text NOT NULL DEFAULT '';
ALTER TABLE outreach_drafts DROP CONSTRAINT outreach_drafts_template_check;
ALTER TABLE outreach_drafts ADD CONSTRAINT outreach_drafts_template_check CHECK(template IN ('letter','brand','proposal','followup'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_outreach_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Outreach history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.campaign_id,NEW.creator_account_id,NEW.input_sha256,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.campaign_id,OLD.creator_account_id,OLD.input_sha256,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Outreach scope is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.status<>'draft' AND ((NEW.subject,NEW.body,NEW.template,NEW.branding,NEW.language,NEW.purpose,NEW.sender_account_id,NEW.from_address,NEW.to_address,NEW.recipient_source,NEW.channel,NEW.revision) IS DISTINCT FROM (OLD.subject,OLD.body,OLD.template,OLD.branding,OLD.language,OLD.purpose,OLD.sender_account_id,OLD.from_address,OLD.to_address,OLD.recipient_source,OLD.channel,OLD.revision) OR NOT (OLD.status='sending' AND NEW.status IN ('sent','failed','unknown'))) THEN RAISE EXCEPTION 'Delivery snapshots are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

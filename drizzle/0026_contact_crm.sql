ALTER TABLE outreach_oauth_states ADD COLUMN mail_read boolean NOT NULL DEFAULT false;
ALTER TABLE outreach_drafts ADD COLUMN provider_thread_id text;
CREATE TABLE contact_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, account_id uuid NOT NULL, channel text NOT NULL CHECK(channel IN ('email','instagram')), recipient text NOT NULL, route_key text NOT NULL, from_address text NOT NULL,
 provider_thread_id text, instagram_selection jsonb, subject text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 0, last_synced_at timestamptz, sync_error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id), UNIQUE(organization_id,account_id,channel,route_key),
 FOREIGN KEY(organization_id,account_id) REFERENCES outreach_sender_accounts(organization_id,id)
);
CREATE TABLE contact_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, conversation_id uuid NOT NULL, campaign_id uuid, creator_account_id uuid, display_name text NOT NULL,
 origin text NOT NULL CHECK(origin IN ('selection','legacy','connection_test')), progress text NOT NULL DEFAULT 'proposal' CHECK(progress IN ('proposal','negotiating','agreed','declined','hold','closed')),
 owner_id uuid NOT NULL, next_action_on date, notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000), revision integer NOT NULL DEFAULT 1 CHECK(revision>0), first_sent_at timestamptz NOT NULL,
 created_by uuid NOT NULL, updated_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,conversation_id) REFERENCES contact_conversations(organization_id,id),
 FOREIGN KEY(organization_id,campaign_id,creator_account_id) REFERENCES campaign_creators(organization_id,campaign_id,creator_account_id),
 FOREIGN KEY(organization_id,owner_id) REFERENCES organization_memberships(organization_id,user_id), FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id), FOREIGN KEY(organization_id,updated_by) REFERENCES organization_memberships(organization_id,user_id),
 CHECK((campaign_id IS NULL)=(creator_account_id IS NULL))
);
CREATE UNIQUE INDEX contact_case_campaign ON contact_cases(organization_id,campaign_id,creator_account_id,conversation_id) WHERE campaign_id IS NOT NULL;
CREATE UNIQUE INDEX contact_case_legacy ON contact_cases(organization_id,conversation_id) WHERE campaign_id IS NULL;
CREATE INDEX contact_case_workspace ON contact_cases(organization_id,updated_at DESC);
CREATE TABLE contact_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, conversation_id uuid NOT NULL, case_id uuid, source_key text NOT NULL, provider_message_id text,
 direction text NOT NULL CHECK(direction IN ('in','out')), body text NOT NULL CHECK(length(body) BETWEEN 1 AND 24000), sent_at timestamptz NOT NULL, headers jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id), UNIQUE(organization_id,conversation_id,source_key),
 FOREIGN KEY(organization_id,conversation_id) REFERENCES contact_conversations(organization_id,id), FOREIGN KEY(organization_id,case_id) REFERENCES contact_cases(organization_id,id)
);
CREATE INDEX contact_message_source ON contact_messages(organization_id,source_key);
CREATE UNIQUE INDEX contact_provider_message ON contact_messages(organization_id,conversation_id,provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX contact_message_latest ON contact_messages(organization_id,conversation_id,sent_at DESC,id DESC);
CREATE TABLE contact_reply_attempts (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, case_id uuid NOT NULL, conversation_id uuid NOT NULL, account_id uuid NOT NULL, expected_version integer NOT NULL,
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 12000), input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'), status text NOT NULL CHECK(status IN ('sending','sent','failed','unknown')),
 provider_message_id text, error_code text, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,case_id) REFERENCES contact_cases(organization_id,id), FOREIGN KEY(organization_id,conversation_id) REFERENCES contact_conversations(organization_id,id), FOREIGN KEY(organization_id,account_id) REFERENCES outreach_sender_accounts(organization_id,id), FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id)
);
CREATE UNIQUE INDEX contact_reply_barrier ON contact_reply_attempts(organization_id,conversation_id) WHERE status IN ('sending','unknown');
CREATE INDEX contact_reply_history ON contact_reply_attempts(organization_id,conversation_id,created_at DESC);
--> statement-breakpoint
CREATE FUNCTION protect_contact_message() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (NEW.id,NEW.organization_id,NEW.conversation_id,NEW.case_id,NEW.source_key,NEW.direction,NEW.body,NEW.sent_at,NEW.headers,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.conversation_id,OLD.case_id,OLD.source_key,OLD.direction,OLD.body,OLD.sent_at,OLD.headers,OLD.created_at) OR OLD.provider_message_id IS NOT NULL AND NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id THEN RAISE EXCEPTION 'Contact message evidence is immutable' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER protect_contact_message BEFORE UPDATE OR DELETE ON contact_messages FOR EACH ROW EXECUTE FUNCTION protect_contact_message();
CREATE FUNCTION protect_contact_reply() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (NEW.id,NEW.organization_id,NEW.case_id,NEW.conversation_id,NEW.account_id,NEW.expected_version,NEW.body,NEW.input_sha256,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.case_id,OLD.conversation_id,OLD.account_id,OLD.expected_version,OLD.body,OLD.input_sha256,OLD.created_by,OLD.created_at) OR OLD.status<>'sending' THEN RAISE EXCEPTION 'Contact reply approval is immutable' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER protect_contact_reply BEFORE UPDATE OR DELETE ON contact_reply_attempts FOR EACH ROW EXECUTE FUNCTION protect_contact_reply();

CREATE TABLE outreach_connection_tests (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, account_id uuid NOT NULL,
 from_address text NOT NULL, to_address text NOT NULL, subject text NOT NULL, body text NOT NULL,
 status text NOT NULL DEFAULT 'sending' CHECK(status IN ('sending','sent','failed','unknown')),
 error_code text, provider_message_id text, sent_at timestamptz,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,account_id) REFERENCES outreach_sender_accounts(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id)
);
CREATE INDEX outreach_connection_test_account ON outreach_connection_tests(organization_id,account_id,created_at DESC);
--> statement-breakpoint
CREATE FUNCTION protect_outreach_connection_test() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Connection test history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.account_id,NEW.from_address,NEW.to_address,NEW.subject,NEW.body,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.account_id,OLD.from_address,OLD.to_address,OLD.subject,OLD.body,OLD.created_by,OLD.created_at) OR NOT (OLD.status='sending' AND NEW.status IN ('sent','failed','unknown')) THEN RAISE EXCEPTION 'Connection test attempt is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outreach_connection_test_history BEFORE UPDATE OR DELETE ON outreach_connection_tests FOR EACH ROW EXECUTE FUNCTION protect_outreach_connection_test();

-- A result that was unknown may be confirmed later from fresh, scoped screen
-- evidence. Approval, claim and prior send permit remain immutable.
CREATE OR REPLACE FUNCTION protect_browser_outreach_send() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rechecked boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Browser outreach history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.account_id,NEW.draft_id,NEW.draft_revision,NEW.sender_username,NEW.recipient_username,NEW.body,NEW.input_sha256,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.account_id,OLD.draft_id,OLD.draft_revision,OLD.sender_username,OLD.recipient_username,OLD.body,OLD.input_sha256,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Browser outreach target and approval are immutable' USING ERRCODE='23514'; END IF;
 rechecked := OLD.state='unknown' AND OLD.observation IS NULL AND OLD.armed_at IS NOT NULL
   AND NEW.state='sent' AND NEW.reason='confirmed_on_recheck' AND NEW.sent_at IS NOT NULL
   AND NEW.observation IS NOT NULL AND NEW.observation_sha256 ~ '^[a-f0-9]{64}$'
   AND NEW.observation->>'sender'=OLD.sender_username AND NEW.observation->>'recipient'=OLD.recipient_username AND NEW.observation->>'body'=OLD.body
   AND (NEW.observation->>'observed_at')::timestamptz >= OLD.armed_at
   AND (NEW.observation->>'observed_at')::timestamptz BETWEEN now()-interval '2 minutes' AND now()+interval '30 seconds';
 IF NOT ((OLD.state='queued' AND NEW.state IN ('preparing','cancelled','blocked')) OR (OLD.state='preparing' AND NEW.state IN ('armed','cancelled','blocked')) OR (OLD.state='armed' AND NEW.state IN ('sent','unknown')) OR coalesce(rechecked,false)) THEN RAISE EXCEPTION 'Browser outreach transition is closed' USING ERRCODE='23514'; END IF;
 IF OLD.state<>'queued' AND (NEW.worker_id,NEW.instance_id,NEW.claim_hash,NEW.claim_expires_at) IS DISTINCT FROM (OLD.worker_id,OLD.instance_id,OLD.claim_hash,OLD.claim_expires_at) THEN RAISE EXCEPTION 'Browser outreach claim is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.armed_at IS NOT NULL AND NEW.armed_at IS DISTINCT FROM OLD.armed_at THEN RAISE EXCEPTION 'Browser outreach send permit is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

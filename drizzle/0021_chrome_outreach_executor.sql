CREATE TABLE outreach_browser_executors (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL, account_id uuid NOT NULL,
 worker_id uuid NOT NULL UNIQUE, instance_id uuid NOT NULL, name text NOT NULL, extension_id text NOT NULL,
 pair_hash text UNIQUE, pair_expires_at timestamptz NOT NULL, token_hash text UNIQUE, expires_at timestamptz,
 status text NOT NULL DEFAULT 'pairing', observed_username text NOT NULL DEFAULT '', last_reason text,
 last_seen_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,account_id) REFERENCES outreach_sender_accounts(organization_id,id),
 FOREIGN KEY(organization_id,worker_id) REFERENCES discovery_browser_workers(organization_id,id),
 FOREIGN KEY(organization_id,user_id) REFERENCES organization_memberships(organization_id,user_id),
 CONSTRAINT outreach_executor_status CHECK(status IN ('pairing','connected','revoked')),
 CONSTRAINT outreach_executor_credentials CHECK((status <> 'pairing' OR (pair_hash IS NOT NULL AND token_hash IS NULL)) AND (status <> 'connected' OR (pair_hash IS NULL AND token_hash IS NOT NULL AND expires_at IS NOT NULL))),
 CONSTRAINT outreach_executor_hashes CHECK((pair_hash IS NULL OR pair_hash ~ '^[a-f0-9]{64}$') AND (token_hash IS NULL OR token_hash ~ '^[a-f0-9]{64}$'))
);
--> statement-breakpoint
CREATE INDEX outreach_executor_account ON outreach_browser_executors(organization_id,account_id,status);
--> statement-breakpoint
CREATE FUNCTION protect_outreach_executor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.organization_id,NEW.user_id,NEW.account_id,NEW.worker_id,NEW.instance_id,NEW.extension_id,NEW.created_at) IS DISTINCT FROM
    (OLD.id,OLD.organization_id,OLD.user_id,OLD.account_id,OLD.worker_id,OLD.instance_id,OLD.extension_id,OLD.created_at)
 OR (OLD.status <> 'pairing' AND (NEW.token_hash,NEW.expires_at,NEW.pair_hash) IS DISTINCT FROM (OLD.token_hash,OLD.expires_at,OLD.pair_hash))
 OR (OLD.status = 'revoked' AND NEW.status <> 'revoked') THEN RAISE EXCEPTION 'Immutable outreach executor scope' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER protect_outreach_executor BEFORE UPDATE ON outreach_browser_executors FOR EACH ROW EXECUTE FUNCTION protect_outreach_executor();

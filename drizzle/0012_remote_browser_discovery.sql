CREATE TABLE discovery_browser_sessions (
 token_hash text PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 FOREIGN KEY(organization_id,user_id) REFERENCES organization_memberships(organization_id,user_id) ON DELETE CASCADE,
 CONSTRAINT browser_session_expiry CHECK(expires_at > created_at AND expires_at <= created_at + interval '8 hours')
);
--> statement-breakpoint
CREATE TABLE discovery_browser_captures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
 request_id uuid NOT NULL REFERENCES discovery_browser_requests(id), run_id uuid NOT NULL REFERENCES discovery_runs(id),
 batch_key uuid NOT NULL, payload_sha256 text NOT NULL, originals jsonb NOT NULL,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT browser_capture_batch UNIQUE(request_id,batch_key),
 FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id),
 CONSTRAINT browser_capture_bounds CHECK(payload_sha256 ~ '^[a-f0-9]{64}$' AND octet_length(originals::text) <= 524288)
);
CREATE TRIGGER browser_capture_immutable BEFORE UPDATE OR DELETE ON discovery_browser_captures FOR EACH ROW EXECUTE FUNCTION eruty_discovery_append_only();

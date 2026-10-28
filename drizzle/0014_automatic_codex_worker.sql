CREATE TABLE discovery_browser_workers (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL, instance_id uuid NOT NULL,
 name text NOT NULL, browser_surface text NOT NULL, platforms text[] NOT NULL, ready text NOT NULL,
 last_seen_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT browser_worker_scope UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,user_id) REFERENCES organization_memberships(organization_id,user_id),
 CONSTRAINT browser_worker_config CHECK(browser_surface IN ('iab','chrome') AND ready IN ('ready','unavailable') AND cardinality(platforms) BETWEEN 1 AND 3 AND platforms <@ ARRAY['instagram','tiktok','youtube']::text[])
);
--> statement-breakpoint
CREATE TABLE discovery_browser_executions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, request_id uuid NOT NULL UNIQUE REFERENCES discovery_browser_requests(id),
 worker_id uuid NOT NULL, instance_id uuid NOT NULL, state text NOT NULL DEFAULT 'starting', phase text NOT NULL DEFAULT 'preparing', error_code text,
 started_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 FOREIGN KEY(organization_id,worker_id) REFERENCES discovery_browser_workers(organization_id,id),
 CONSTRAINT browser_execution_state CHECK(state IN ('starting','running','completed','partial','blocked','failed','cancelled','interrupted') AND phase IN ('preparing','browsing','saving','finishing'))
);
CREATE UNIQUE INDEX browser_worker_one_active ON discovery_browser_executions(worker_id) WHERE state IN ('starting','running');
--> statement-breakpoint
CREATE FUNCTION preserve_browser_execution_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Execution history is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.organization_id,NEW.request_id,NEW.worker_id,NEW.instance_id,NEW.started_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.request_id,OLD.worker_id,OLD.instance_id,OLD.started_at) THEN RAISE EXCEPTION 'Execution scope is immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM discovery_browser_requests WHERE id=NEW.request_id AND organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Execution request scope mismatch' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER browser_execution_scope BEFORE INSERT OR UPDATE OR DELETE ON discovery_browser_executions FOR EACH ROW EXECUTE FUNCTION preserve_browser_execution_scope();

CREATE TABLE "campaign_creators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"creator_account_id" uuid NOT NULL,
	"first_discovery_run_id" uuid NOT NULL,
	"first_evidence_id" uuid NOT NULL,
	"discovery_state" text DEFAULT 'verification_pending' NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_creator_identity" UNIQUE("organization_id","campaign_id","creator_account_id"),
	CONSTRAINT "campaign_creator_state" CHECK ("campaign_creators"."discovery_state" in ('verification_pending', 'direct_sns_verified', 'blocked', 'duplicate'))
);
--> statement-breakpoint
CREATE TABLE "creator_account_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"account_id" uuid NOT NULL,
	"normalized_url" text NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"evidence_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "creator_alias_dates" CHECK ("creator_account_aliases"."valid_to" is null or "creator_account_aliases"."valid_to" >= "creator_account_aliases"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "creator_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"platform_account_id" text,
	"canonical_profile_url" text NOT NULL,
	"current_handle" text,
	"display_name" text,
	"identity_state" text DEFAULT 'provisional' NOT NULL,
	"merged_into_id" uuid,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_account_scope" UNIQUE("organization_id","platform","id"),
	CONSTRAINT "creator_platform" CHECK ("creator_accounts"."platform" in ('instagram', 'tiktok', 'youtube')),
	CONSTRAINT "creator_identity_state" CHECK ("creator_accounts"."identity_state" in ('provisional', 'resolved', 'conflict', 'merged'))
);
--> statement-breakpoint
CREATE TABLE "discovery_capability_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"kind" text NOT NULL,
	"verdict" text NOT NULL,
	"environment_sha256" text NOT NULL,
	"private_evidence_reference" text NOT NULL,
	"facts" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"reviewed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_capability_scope" UNIQUE("organization_id","platform","id"),
	CONSTRAINT "discovery_capability_platform" CHECK ("discovery_capability_receipts"."platform" in ('instagram', 'tiktok', 'youtube')),
	CONSTRAINT "discovery_capability_kind" CHECK ("discovery_capability_receipts"."kind" in ('sns_native_search', 'work_mcp_write')),
	CONSTRAINT "discovery_capability_verdict" CHECK ("discovery_capability_receipts"."verdict" in ('partial', 'verified', 'blocked')),
	CONSTRAINT "discovery_capability_hash" CHECK ("discovery_capability_receipts"."environment_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "discovery_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"creator_account_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"kind" text NOT NULL,
	"observation_method" text NOT NULL,
	"source_url" text NOT NULL,
	"profile_url" text NOT NULL,
	"platform_content_id" text,
	"observed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"facts" jsonb NOT NULL,
	"limitations" text[] NOT NULL,
	"search_log_id" uuid NOT NULL,
	"work_trace_reference" text,
	"capture_asset_version_id" uuid,
	"supersedes_id" uuid,
	"payload_sha256" text NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "discovery_evidence_scope" UNIQUE("organization_id","project_id","campaign_id","run_id","id"),
	CONSTRAINT "discovery_evidence_account_scope" UNIQUE("organization_id","project_id","campaign_id","run_id","creator_account_id","id"),
	CONSTRAINT "discovery_evidence_identity_scope" UNIQUE("organization_id","platform","creator_account_id","id"),
	CONSTRAINT "discovery_evidence_kind" CHECK ("discovery_evidence"."kind" in ('profile_observation', 'content_observation', 'metric_observation', 'identity_observation')),
	CONSTRAINT "discovery_evidence_method" CHECK ("discovery_evidence"."observation_method" in ('sns_browser', 'supplemental_web', 'manual_import', 'codex_test')),
	CONSTRAINT "discovery_evidence_hash" CHECK ("discovery_evidence"."payload_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "discovery_evidence_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"reason" text NOT NULL,
	"reviewed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_evidence_verdict" CHECK ("discovery_evidence_reviews"."verdict" in ('accepted', 'rejected', 'needs_review'))
);
--> statement-breakpoint
CREATE TABLE "discovery_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"outcome" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_url" text,
	"query" text,
	"parent_log_id" uuid,
	"failure_code" text,
	"message" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "discovery_log_sequence" UNIQUE("run_id","sequence"),
	CONSTRAINT "discovery_log_scope" UNIQUE("organization_id","project_id","campaign_id","run_id","id"),
	CONSTRAINT "discovery_log_outcome" CHECK ("discovery_logs"."outcome" in ('success', 'partial', 'blocked', 'failed')),
	CONSTRAINT "discovery_log_sequence_positive" CHECK ("discovery_logs"."sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "discovery_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"principal_key" text NOT NULL,
	"tool" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"payload_sha256" text NOT NULL,
	"receipt" jsonb NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_request_idempotency" UNIQUE("organization_id","principal_key","tool","idempotency_key"),
	CONSTRAINT "discovery_request_hash" CHECK ("discovery_requests"."payload_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"brief_version" integer NOT NULL,
	"platform" text NOT NULL,
	"execution_source" text NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"targeting_snapshot" jsonb NOT NULL,
	"targeting_sha256" text NOT NULL,
	"context_sha256" text NOT NULL,
	"snapshot_schema_version" integer DEFAULT 1 NOT NULL,
	"requested_count" integer NOT NULL,
	"time_budget_seconds" integer DEFAULT 1800 NOT NULL,
	"work_task_reference" text,
	"capability_receipt_id" uuid,
	"environment_snapshot" jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"outcome_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"limitations" text[] DEFAULT '{}'::text[] NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_run_scope" UNIQUE("organization_id","project_id","campaign_id","id"),
	CONSTRAINT "discovery_run_platform_scope" UNIQUE("organization_id","project_id","campaign_id","platform","id"),
	CONSTRAINT "discovery_run_platform" CHECK ("discovery_runs"."platform" in ('instagram', 'tiktok', 'youtube')),
	CONSTRAINT "discovery_run_source" CHECK ("discovery_runs"."execution_source" in ('work_manual_task', 'manual_import', 'codex_test')),
	CONSTRAINT "discovery_run_status" CHECK ("discovery_runs"."status" in ('prepared', 'collecting', 'awaiting_review', 'completed', 'partial', 'blocked', 'failed', 'cancelled')),
	CONSTRAINT "discovery_run_hashes" CHECK ("discovery_runs"."targeting_sha256" ~ '^[a-f0-9]{64}$' and "discovery_runs"."context_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "discovery_run_bounds" CHECK ("discovery_runs"."requested_count" between 1 and 500 and "discovery_runs"."time_budget_seconds" between 60 and 14400 and "discovery_runs"."snapshot_schema_version" = 1 and "discovery_runs"."lock_version" >= 0),
	CONSTRAINT "discovery_run_work_provenance" CHECK ("discovery_runs"."execution_source" <> 'work_manual_task' or ("discovery_runs"."work_task_reference" is not null and "discovery_runs"."capability_receipt_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "campaign_creators" ADD CONSTRAINT "campaign_creators_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_creators" ADD CONSTRAINT "campaign_creators_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_creators" ADD CONSTRAINT "campaign_creator_campaign_fk" FOREIGN KEY ("organization_id","project_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_creators" ADD CONSTRAINT "campaign_creator_evidence_fk" FOREIGN KEY ("organization_id","project_id","campaign_id","first_discovery_run_id","creator_account_id","first_evidence_id") REFERENCES "public"."discovery_evidence"("organization_id","project_id","campaign_id","run_id","creator_account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_account_aliases" ADD CONSTRAINT "creator_account_aliases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_account_aliases" ADD CONSTRAINT "creator_alias_account_fk" FOREIGN KEY ("organization_id","platform","account_id") REFERENCES "public"."creator_accounts"("organization_id","platform","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_account_aliases" ADD CONSTRAINT "creator_alias_evidence_fk" FOREIGN KEY ("organization_id","platform","account_id","evidence_id") REFERENCES "public"."discovery_evidence"("organization_id","platform","creator_account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_accounts" ADD CONSTRAINT "creator_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_accounts" ADD CONSTRAINT "creator_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_accounts" ADD CONSTRAINT "creator_accounts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_capability_receipts" ADD CONSTRAINT "discovery_capability_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_capability_receipts" ADD CONSTRAINT "discovery_capability_receipts_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_evidence" ADD CONSTRAINT "discovery_evidence_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_evidence" ADD CONSTRAINT "discovery_evidence_run_fk" FOREIGN KEY ("organization_id","project_id","campaign_id","platform","run_id") REFERENCES "public"."discovery_runs"("organization_id","project_id","campaign_id","platform","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_evidence" ADD CONSTRAINT "discovery_evidence_creator_fk" FOREIGN KEY ("organization_id","platform","creator_account_id") REFERENCES "public"."creator_accounts"("organization_id","platform","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_evidence" ADD CONSTRAINT "discovery_evidence_log_fk" FOREIGN KEY ("organization_id","project_id","campaign_id","run_id","search_log_id") REFERENCES "public"."discovery_logs"("organization_id","project_id","campaign_id","run_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_evidence" ADD CONSTRAINT "discovery_evidence_asset_fk" FOREIGN KEY ("organization_id","project_id","capture_asset_version_id") REFERENCES "public"."project_asset_versions"("organization_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_evidence_reviews" ADD CONSTRAINT "discovery_review_evidence_fk" FOREIGN KEY ("organization_id","project_id","campaign_id","run_id","evidence_id") REFERENCES "public"."discovery_evidence"("organization_id","project_id","campaign_id","run_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_evidence_reviews" ADD CONSTRAINT "discovery_review_member_fk" FOREIGN KEY ("organization_id","reviewed_by") REFERENCES "public"."organization_memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_logs" ADD CONSTRAINT "discovery_logs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_logs" ADD CONSTRAINT "discovery_log_run_fk" FOREIGN KEY ("organization_id","project_id","campaign_id","run_id") REFERENCES "public"."discovery_runs"("organization_id","project_id","campaign_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_requests" ADD CONSTRAINT "discovery_request_member_fk" FOREIGN KEY ("organization_id","actor_id") REFERENCES "public"."organization_memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_run_brief_fk" FOREIGN KEY ("organization_id","project_id","campaign_id","brief_version") REFERENCES "public"."campaign_brief_revisions"("organization_id","project_id","campaign_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_run_capability_fk" FOREIGN KEY ("organization_id","platform","capability_receipt_id") REFERENCES "public"."discovery_capability_receipts"("organization_id","platform","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_creator_account" ON "campaign_creators" USING btree ("organization_id","creator_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_active_alias" ON "creator_account_aliases" USING btree ("organization_id","platform","normalized_url") WHERE "creator_account_aliases"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "creator_alias_account" ON "creator_account_aliases" USING btree ("organization_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_stable_identity" ON "creator_accounts" USING btree ("organization_id","platform","platform_account_id") WHERE "creator_accounts"."platform_account_id" is not null;--> statement-breakpoint
CREATE INDEX "creator_org_last_seen" ON "creator_accounts" USING btree ("organization_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "discovery_capability_latest" ON "discovery_capability_receipts" USING btree ("organization_id","platform","kind","created_at");--> statement-breakpoint
CREATE INDEX "discovery_evidence_account_time" ON "discovery_evidence" USING btree ("organization_id","creator_account_id","observed_at");--> statement-breakpoint
CREATE INDEX "discovery_evidence_review_latest" ON "discovery_evidence_reviews" USING btree ("evidence_id","created_at");--> statement-breakpoint
CREATE INDEX "discovery_runs_campaign_time" ON "discovery_runs" USING btree ("organization_id","campaign_id","created_at");
--> statement-breakpoint
-- Scoped self references and immutability are maintained explicitly by this migration.
ALTER TABLE discovery_logs ADD CONSTRAINT discovery_log_parent_fk FOREIGN KEY
  (organization_id,project_id,campaign_id,run_id,parent_log_id)
  REFERENCES discovery_logs(organization_id,project_id,campaign_id,run_id,id);
ALTER TABLE discovery_logs ADD CONSTRAINT discovery_log_not_own_parent CHECK (parent_log_id IS NULL OR parent_log_id <> id);
ALTER TABLE discovery_evidence ADD CONSTRAINT discovery_evidence_supersedes_fk FOREIGN KEY
  (organization_id,platform,creator_account_id,supersedes_id)
  REFERENCES discovery_evidence(organization_id,platform,creator_account_id,id);
ALTER TABLE discovery_evidence ADD CONSTRAINT discovery_evidence_not_self CHECK (supersedes_id IS NULL OR supersedes_id <> id);
ALTER TABLE creator_accounts ADD CONSTRAINT creator_merge_scope_fk FOREIGN KEY
  (organization_id,platform,merged_into_id) REFERENCES creator_accounts(organization_id,platform,id);
ALTER TABLE creator_accounts ADD CONSTRAINT creator_merge_valid CHECK ((identity_state = 'merged') = (merged_into_id IS NOT NULL) AND (merged_into_id IS NULL OR merged_into_id <> id));
--> statement-breakpoint
CREATE FUNCTION eruty_discovery_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'discovery history is append only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER discovery_evidence_immutable BEFORE UPDATE OR DELETE ON discovery_evidence FOR EACH ROW EXECUTE FUNCTION eruty_discovery_append_only();
CREATE TRIGGER discovery_logs_immutable BEFORE UPDATE OR DELETE ON discovery_logs FOR EACH ROW EXECUTE FUNCTION eruty_discovery_append_only();
CREATE TRIGGER discovery_reviews_immutable BEFORE UPDATE OR DELETE ON discovery_evidence_reviews FOR EACH ROW EXECUTE FUNCTION eruty_discovery_append_only();
CREATE TRIGGER discovery_requests_immutable BEFORE UPDATE OR DELETE ON discovery_requests FOR EACH ROW EXECUTE FUNCTION eruty_discovery_append_only();
CREATE TRIGGER discovery_capabilities_immutable BEFORE UPDATE OR DELETE ON discovery_capability_receipts FOR EACH ROW EXECUTE FUNCTION eruty_discovery_append_only();
--> statement-breakpoint
CREATE FUNCTION eruty_discovery_keep_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'discovery run history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','started_at','submitted_at','reviewed_at','ended_at','outcome_summary','limitations','lock_version','updated_by','updated_at'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','started_at','submitted_at','reviewed_at','ended_at','outcome_summary','limitations','lock_version','updated_by','updated_at']) THEN
    RAISE EXCEPTION 'discovery run context is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.lock_version <> OLD.lock_version + 1 OR OLD.status IN ('completed','partial','blocked','failed','cancelled') THEN
    RAISE EXCEPTION 'invalid discovery run revision' USING ERRCODE = '23514';
  END IF;
  IF NOT (NEW.status = OLD.status OR (OLD.status = 'prepared' AND NEW.status IN ('collecting','cancelled'))
    OR (OLD.status = 'collecting' AND NEW.status IN ('awaiting_review','failed','cancelled'))
    OR (OLD.status = 'awaiting_review' AND NEW.status IN ('completed','partial','blocked','failed','cancelled'))) THEN
    RAISE EXCEPTION 'invalid discovery run transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER discovery_run_context_immutable BEFORE UPDATE OR DELETE ON discovery_runs FOR EACH ROW EXECUTE FUNCTION eruty_discovery_keep_run();
--> statement-breakpoint
CREATE FUNCTION eruty_discovery_keep_alias() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.valid_to IS NOT NULL OR NEW.valid_to IS NULL OR (to_jsonb(NEW) - 'valid_to') IS DISTINCT FROM (to_jsonb(OLD) - 'valid_to') THEN
    RAISE EXCEPTION 'creator alias history is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER creator_alias_history_immutable BEFORE UPDATE OR DELETE ON creator_account_aliases FOR EACH ROW EXECUTE FUNCTION eruty_discovery_keep_alias();

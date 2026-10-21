CREATE TABLE "discovery_grant_campaigns" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	CONSTRAINT "discovery_grant_campaign_identity" UNIQUE("grant_id","campaign_id")
);
--> statement-breakpoint
CREATE TABLE "discovery_mcp_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"environment_sha256" text NOT NULL,
	"execution_source" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_mcp_grant_scope" UNIQUE("organization_id","id"),
	CONSTRAINT "discovery_mcp_source" CHECK ("discovery_mcp_grants"."execution_source" in ('work_manual_task', 'codex_test')),
	CONSTRAINT "discovery_mcp_scopes" CHECK (cardinality("discovery_mcp_grants"."scopes") > 0 and "discovery_mcp_grants"."scopes" <@ ARRAY['discovery:read','discovery:observe','discovery:submit']::text[] and "discovery_mcp_grants"."scopes" @> ARRAY['discovery:read']::text[]),
	CONSTRAINT "discovery_mcp_environment_hash" CHECK ("discovery_mcp_grants"."environment_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "discovery_mcp_expiry" CHECK ("discovery_mcp_grants"."expires_at" > "discovery_mcp_grants"."created_at" and "discovery_mcp_grants"."expires_at" <= "discovery_mcp_grants"."created_at" + interval '24 hours')
);
--> statement-breakpoint
ALTER TABLE "discovery_grant_campaigns" ADD CONSTRAINT "discovery_grant_campaign_fk" FOREIGN KEY ("organization_id","project_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_grant_campaigns" ADD CONSTRAINT "discovery_grant_identity_fk" FOREIGN KEY ("organization_id","grant_id") REFERENCES "public"."discovery_mcp_grants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_mcp_grants" ADD CONSTRAINT "discovery_mcp_grants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_mcp_grants" ADD CONSTRAINT "discovery_mcp_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_mcp_principal" ON "discovery_mcp_grants" USING btree ("organization_id","issuer","subject") WHERE "discovery_mcp_grants"."revoked_at" is null;
--> statement-breakpoint
CREATE FUNCTION eruty_discovery_keep_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - ARRAY['revoked_at','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['revoked_at','updated_at'])
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'discovery grant identity and history are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER discovery_mcp_grant_history BEFORE UPDATE OR DELETE ON discovery_mcp_grants FOR EACH ROW EXECUTE FUNCTION eruty_discovery_keep_grant();
CREATE TRIGGER discovery_campaign_grant_history BEFORE UPDATE OR DELETE ON discovery_grant_campaigns FOR EACH ROW EXECUTE FUNCTION eruty_discovery_append_only();
--> statement-breakpoint
ALTER TABLE discovery_runs ADD CONSTRAINT discovery_terminal_review_required CHECK
  (status NOT IN ('completed','partial','blocked') OR (reviewed_at IS NOT NULL AND ended_at IS NOT NULL));

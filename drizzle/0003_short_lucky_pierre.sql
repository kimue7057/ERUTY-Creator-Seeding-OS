CREATE TABLE "discovery_probe_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "probe_principal_identity" UNIQUE("issuer","subject"),
	CONSTRAINT "probe_grant_scope" UNIQUE("organization_id","user_id","id"),
	CONSTRAINT "probe_grant_scopes" CHECK (cardinality("discovery_probe_grants"."scopes") > 0 and "discovery_probe_grants"."scopes" <@ ARRAY['discovery:read','discovery:probe']::text[])
);
--> statement-breakpoint
CREATE TABLE "discovery_probe_workspaces" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"purpose" text DEFAULT 'synthetic_mcp_probe' NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "probe_workspace_scope" UNIQUE("organization_id","project_id","campaign_id"),
	CONSTRAINT "probe_workspace_synthetic" CHECK ("discovery_probe_workspaces"."purpose" = 'synthetic_mcp_probe')
);
--> statement-breakpoint
CREATE TABLE "discovery_probes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"nonce" uuid NOT NULL,
	"payload_sha256" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "probe_idempotency" UNIQUE("principal_id","idempotency_key"),
	CONSTRAINT "probe_sha256" CHECK ("discovery_probes"."payload_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "discovery_probe_grants" ADD CONSTRAINT "discovery_probe_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_probe_grants" ADD CONSTRAINT "discovery_probe_grants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_probe_grants" ADD CONSTRAINT "discovery_probe_grants_organization_id_discovery_probe_workspaces_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."discovery_probe_workspaces"("organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_probe_grants" ADD CONSTRAINT "discovery_probe_grants_organization_id_user_id_organization_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_probe_workspaces" ADD CONSTRAINT "discovery_probe_workspaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_probe_workspaces" ADD CONSTRAINT "discovery_probe_workspaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_probe_workspaces" ADD CONSTRAINT "discovery_probe_workspaces_organization_id_project_id_campaign_id_campaigns_organization_id_project_id_id_fk" FOREIGN KEY ("organization_id","project_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_probes" ADD CONSTRAINT "discovery_probes_organization_id_project_id_campaign_id_discovery_probe_workspaces_organization_id_project_id_campaign_id_fk" FOREIGN KEY ("organization_id","project_id","campaign_id") REFERENCES "public"."discovery_probe_workspaces"("organization_id","project_id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_probes" ADD CONSTRAINT "discovery_probes_organization_id_actor_id_principal_id_discovery_probe_grants_organization_id_user_id_id_fk" FOREIGN KEY ("organization_id","actor_id","principal_id") REFERENCES "public"."discovery_probe_grants"("organization_id","user_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION eruty_keep_discovery_probe() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Discovery probe receipts are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER discovery_probe_immutable BEFORE UPDATE ON discovery_probes FOR EACH ROW EXECUTE FUNCTION eruty_keep_discovery_probe();

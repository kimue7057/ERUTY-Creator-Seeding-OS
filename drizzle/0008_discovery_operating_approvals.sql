CREATE TABLE "discovery_operating_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"approved_by" uuid NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"resource" text NOT NULL,
	"environment_sha256" text NOT NULL,
	"scopes" text[] NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"payload_sha256" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_operating_scope" UNIQUE("organization_id","id"),
	CONSTRAINT "discovery_operating_idempotency" UNIQUE("organization_id","approved_by","idempotency_key"),
	CONSTRAINT "discovery_operating_scopes" CHECK (cardinality("discovery_operating_approvals"."scopes") > 0 and "discovery_operating_approvals"."scopes" <@ ARRAY['discovery:read','discovery:observe','discovery:submit']::text[] and "discovery_operating_approvals"."scopes" @> ARRAY['discovery:read']::text[]),
	CONSTRAINT "discovery_operating_hashes" CHECK ("discovery_operating_approvals"."environment_sha256" ~ '^[a-f0-9]{64}$' and "discovery_operating_approvals"."payload_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "discovery_operating_reason" CHECK (length(trim("discovery_operating_approvals"."reason")) between 1 and 2000),
	CONSTRAINT "discovery_operating_expiry" CHECK ("discovery_operating_approvals"."expires_at" > "discovery_operating_approvals"."created_at" and "discovery_operating_approvals"."expires_at" <= "discovery_operating_approvals"."created_at" + interval '7 days')
);
--> statement-breakpoint
CREATE TABLE "discovery_operating_campaigns" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	CONSTRAINT "discovery_operating_campaign_identity" UNIQUE("approval_id","campaign_id")
);
--> statement-breakpoint
ALTER TABLE "discovery_operating_approvals" ADD CONSTRAINT "discovery_operating_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_operating_approvals" ADD CONSTRAINT "discovery_operating_admin_fk" FOREIGN KEY ("organization_id","approved_by") REFERENCES "public"."organization_memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_operating_campaigns" ADD CONSTRAINT "discovery_operating_campaign_fk" FOREIGN KEY ("organization_id","project_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_operating_campaigns" ADD CONSTRAINT "discovery_operating_approval_fk" FOREIGN KEY ("organization_id","approval_id") REFERENCES "public"."discovery_operating_approvals"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_operating_principal" ON "discovery_operating_approvals" USING btree ("organization_id","issuer","subject","created_at");
--> statement-breakpoint
CREATE FUNCTION eruty_discovery_keep_operating_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Preserve operating approval history' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['revoked_at','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['revoked_at','updated_at'])
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'Operating approval is immutable except initial revocation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER discovery_operating_approval_immutable BEFORE UPDATE OR DELETE ON discovery_operating_approvals FOR EACH ROW EXECUTE FUNCTION eruty_discovery_keep_operating_approval();
--> statement-breakpoint
CREATE TRIGGER discovery_operating_campaign_immutable BEFORE UPDATE OR DELETE ON discovery_operating_campaigns FOR EACH ROW EXECUTE FUNCTION eruty_discovery_append_only();

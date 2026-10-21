CREATE TABLE "asset_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"asset_id" uuid,
	"product_id" uuid,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"original_name" text NOT NULL,
	"declared_mime" text NOT NULL,
	"expected_size" bigint NOT NULL,
	"object_path" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"failure_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_uploads_object_path_unique" UNIQUE("object_path"),
	CONSTRAINT "upload_state_valid" CHECK ("asset_uploads"."state" in ('pending','receiving','completed','failed','cancelled')),
	CONSTRAINT "upload_size_valid" CHECK ("asset_uploads"."expected_size" > 0 and "asset_uploads"."expected_size" <= 52428800)
);
--> statement-breakpoint
CREATE TABLE "campaign_asset_references" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"brief_version" integer NOT NULL,
	"asset_version_id" uuid NOT NULL,
	CONSTRAINT "campaign_asset_references_campaign_id_brief_version_asset_version_id_pk" PRIMARY KEY("campaign_id","brief_version","asset_version_id")
);
--> statement-breakpoint
CREATE TABLE "project_asset_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"object_path" text NOT NULL,
	"storage_version_id" text,
	"original_name" text NOT NULL,
	"mime_type" text,
	"byte_size" bigint,
	"sha256" text,
	"verification_status" text NOT NULL,
	"upload_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_asset_versions_upload_id_unique" UNIQUE("upload_id"),
	CONSTRAINT "asset_version_number" UNIQUE("asset_id","version"),
	CONSTRAINT "asset_version_scoped_identity" UNIQUE("organization_id","project_id","id"),
	CONSTRAINT "asset_version_valid" CHECK ("project_asset_versions"."version" > 0 and ("project_asset_versions"."verification_status" = 'legacy_unverified' or ("project_asset_versions"."verification_status" = 'verified' and "project_asset_versions"."sha256" is not null and "project_asset_versions"."sha256" ~ '^[a-f0-9]{64}$' and "project_asset_versions"."byte_size" is not null and "project_asset_versions"."byte_size" > 0 and "project_asset_versions"."mime_type" is not null and "project_asset_versions"."mime_type" in ('application/pdf','image/jpeg','image/png','image/webp','video/mp4'))))
);
--> statement-breakpoint
ALTER TABLE "project_assets" ADD COLUMN "category" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_brief_revisions" ADD CONSTRAINT "campaign_brief_scoped_identity" UNIQUE("organization_id","project_id","campaign_id","version");--> statement-breakpoint
ALTER TABLE "project_assets" ADD CONSTRAINT "asset_scoped_identity" UNIQUE("organization_id","project_id","id");--> statement-breakpoint
ALTER TABLE "asset_uploads" ADD CONSTRAINT "asset_uploads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_uploads" ADD CONSTRAINT "asset_uploads_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_uploads" ADD CONSTRAINT "asset_uploads_organization_id_project_id_asset_id_project_assets_organization_id_project_id_id_fk" FOREIGN KEY ("organization_id","project_id","asset_id") REFERENCES "public"."project_assets"("organization_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_uploads" ADD CONSTRAINT "asset_uploads_organization_id_project_id_product_id_products_organization_id_project_id_id_fk" FOREIGN KEY ("organization_id","project_id","product_id") REFERENCES "public"."products"("organization_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_asset_references" ADD CONSTRAINT "campaign_asset_references_organization_id_project_id_campaign_id_brief_version_campaign_brief_revisions_organization_id_project_id_campaign_id_version_fk" FOREIGN KEY ("organization_id","project_id","campaign_id","brief_version") REFERENCES "public"."campaign_brief_revisions"("organization_id","project_id","campaign_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_asset_references" ADD CONSTRAINT "campaign_asset_references_organization_id_project_id_asset_version_id_project_asset_versions_organization_id_project_id_id_fk" FOREIGN KEY ("organization_id","project_id","asset_version_id") REFERENCES "public"."project_asset_versions"("organization_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_asset_versions" ADD CONSTRAINT "project_asset_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_asset_versions" ADD CONSTRAINT "project_asset_versions_organization_id_project_id_asset_id_project_assets_organization_id_project_id_id_fk" FOREIGN KEY ("organization_id","project_id","asset_id") REFERENCES "public"."project_assets"("organization_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_upload_expiry" ON "asset_uploads" USING btree ("state","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_verified_object" ON "project_asset_versions" USING btree ("object_path") WHERE "project_asset_versions"."verification_status" = 'verified';--> statement-breakpoint
ALTER TABLE "project_assets" ADD CONSTRAINT "asset_category" CHECK ("project_assets"."category" in ('brand_intro', 'product_image', 'advertising_video', 'brand_guide', 'other'));
--> statement-breakpoint
-- Preserve legacy identity/path/version without asserting that bytes exist.
INSERT INTO project_asset_versions (organization_id, project_id, asset_id, version, object_path, original_name, verification_status, created_by, created_at, updated_at)
SELECT organization_id, project_id, id, version, object_path, name, 'legacy_unverified', created_by, created_at, updated_at FROM project_assets;
--> statement-breakpoint
INSERT INTO campaign_asset_references (organization_id, project_id, campaign_id, brief_version, asset_version_id)
SELECT b.organization_id, b.project_id, b.campaign_id, b.version, v.id
FROM campaign_brief_revisions b
CROSS JOIN LATERAL jsonb_array_elements(b.snapshot->'assets') a
JOIN project_asset_versions v ON v.organization_id=b.organization_id AND v.project_id=b.project_id
AND v.asset_id::text=a->>'id' AND v.version::text=a->>'version' AND v.object_path=a->>'objectPath'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION eruty_keep_asset_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Asset versions cannot be updated; upload a new immutable version';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_version_immutable BEFORE UPDATE ON project_asset_versions FOR EACH ROW EXECUTE FUNCTION eruty_keep_asset_version();
--> statement-breakpoint
CREATE FUNCTION eruty_guard_asset_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Asset organization/project identity is immutable';
  END IF;
  IF NEW.version IS DISTINCT FROM OLD.version OR NEW.object_path IS DISTINCT FROM OLD.object_path THEN
    IF NEW.version <= OLD.version OR NOT EXISTS (SELECT 1 FROM project_asset_versions v WHERE v.asset_id=NEW.id AND v.version=NEW.version AND v.object_path=NEW.object_path AND v.verification_status='verified') THEN
      RAISE EXCEPTION 'Asset head must advance to a verified immutable version';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_head_guard BEFORE UPDATE ON project_assets FOR EACH ROW EXECUTE FUNCTION eruty_guard_asset_head();

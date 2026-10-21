CREATE TABLE "campaign_brief_revisions" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_brief_revisions_campaign_id_version_pk" PRIMARY KEY("campaign_id","version"),
	CONSTRAINT "brief_revision_version" CHECK ("campaign_brief_revisions"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "brief_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_brief_revisions" ADD CONSTRAINT "campaign_brief_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_brief_revisions" ADD CONSTRAINT "campaign_brief_revisions_organization_id_project_id_campaign_id_campaigns_organization_id_project_id_id_fk" FOREIGN KEY ("organization_id","project_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaign_brief_version" CHECK ("campaigns"."brief_version" > 0);
--> statement-breakpoint
-- Backfill existing campaigns before enforcing the active immutable revision.
INSERT INTO campaign_brief_revisions (organization_id, project_id, campaign_id, version, snapshot, created_by, created_at, updated_at)
SELECT organization_id, project_id, id, 1, brief_snapshot, created_by, created_at, created_at FROM campaigns;
--> statement-breakpoint
-- Drizzle cannot express DEFERRABLE; keep this reviewed SQL invariant in migrations.
ALTER TABLE campaigns ADD CONSTRAINT campaign_active_brief_fk
FOREIGN KEY (id, brief_version) REFERENCES campaign_brief_revisions(campaign_id, version) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION eruty_keep_initial_brief() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.brief_snapshot IS DISTINCT FROM OLD.brief_snapshot OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'Campaign initial brief and project identity are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER campaign_initial_brief_immutable BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION eruty_keep_initial_brief();
--> statement-breakpoint
CREATE FUNCTION eruty_keep_brief_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Brief revisions cannot be updated; append a new version';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER campaign_brief_revision_immutable BEFORE UPDATE ON campaign_brief_revisions FOR EACH ROW EXECUTE FUNCTION eruty_keep_brief_revision();

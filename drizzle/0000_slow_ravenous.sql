CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_products" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "campaign_products_campaign_id_product_id_pk" PRIMARY KEY("campaign_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"country_codes" text[] NOT NULL,
	"platforms" text[] NOT NULL,
	"categories" text[] NOT NULL,
	"follower_min" integer NOT NULL,
	"follower_max" integer NOT NULL,
	"goal_count" integer NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"exclusions" text DEFAULT '' NOT NULL,
	"budget" integer,
	"currency" text DEFAULT 'KRW' NOT NULL,
	"starts_on" text,
	"ends_on" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"brief_snapshot" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_project_identity" UNIQUE("organization_id","project_id","id"),
	CONSTRAINT "campaign_follower_bounds" CHECK ("campaigns"."follower_min" >= 0 and "campaigns"."follower_max" >= "campaigns"."follower_min"),
	CONSTRAINT "campaign_goal" CHECK ("campaigns"."goal_count" > 0),
	CONSTRAINT "campaign_budget" CHECK ("campaigns"."budget" is null or "campaigns"."budget" >= 0),
	CONSTRAINT "campaign_status" CHECK ("campaigns"."status" in ('draft', 'ready', 'archived')),
	CONSTRAINT "campaign_countries" CHECK (cardinality("campaigns"."country_codes") > 0),
	CONSTRAINT "campaign_platforms" CHECK (cardinality("campaigns"."platforms") > 0 and "campaigns"."platforms" <@ ARRAY['instagram', 'tiktok', 'youtube']::text[])
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"email_key" text PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_memberships_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "membership_role" CHECK ("organization_memberships"."role" in ('admin', 'manager', 'reviewer'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"features" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_project_identity" UNIQUE("organization_id","project_id","id")
);
--> statement-breakpoint
CREATE TABLE "project_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"product_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"object_path" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"provenance" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_positive_version" CHECK ("project_assets"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"usp" text DEFAULT '' NOT NULL,
	"brand_style" text DEFAULT '' NOT NULL,
	"reference_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_org_identity" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_products" ADD CONSTRAINT "campaign_products_organization_id_project_id_campaign_id_campaigns_organization_id_project_id_id_fk" FOREIGN KEY ("organization_id","project_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_products" ADD CONSTRAINT "campaign_products_organization_id_project_id_product_id_products_organization_id_project_id_id_fk" FOREIGN KEY ("organization_id","project_id","product_id") REFERENCES "public"."products"("organization_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_organization_id_project_id_product_id_products_organization_id_project_id_id_fk" FOREIGN KEY ("organization_id","project_id","product_id") REFERENCES "public"."products"("organization_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_user_id_organization_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_memberships"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_org_project" ON "campaigns" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "projects_org" ON "projects" USING btree ("organization_id");
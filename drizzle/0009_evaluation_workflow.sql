CREATE TABLE "creator_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"creator_account_id" uuid NOT NULL,
	"brief_version" integer NOT NULL,
	"input_sha256" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"source" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"total" integer,
	"known_subtotal" integer NOT NULL,
	"unknown_count" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluation_identity" UNIQUE("organization_id","id"),
	CONSTRAINT "evaluation_request_identity" UNIQUE("organization_id","created_by","idempotency_key"),
	CONSTRAINT "evaluation_source" CHECK ("creator_evaluations"."source" in ('work_import','openai_api')),
	CONSTRAINT "evaluation_scores" CHECK ("creator_evaluations"."known_subtotal" between 0 and 100 and "creator_evaluations"."unknown_count" between 0 and 6 and ("creator_evaluations"."total" is null or ("creator_evaluations"."unknown_count"=0 and "creator_evaluations"."total"="creator_evaluations"."known_subtotal"))),
	CONSTRAINT "evaluation_hashes" CHECK ("creator_evaluations"."input_sha256" ~ '^[a-f0-9]{64}$' and "creator_evaluations"."payload_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "evaluation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"creator_account_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"input_sha256" text NOT NULL,
	"model" text NOT NULL,
	"state" text NOT NULL,
	"error_code" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluation_generation_key" UNIQUE("organization_id","created_by","idempotency_key"),
	CONSTRAINT "evaluation_request_state" CHECK ("evaluation_requests"."state" in ('started','succeeded','failed'))
);
--> statement-breakpoint
CREATE TABLE "creator_evaluation_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"reason" text NOT NULL,
	"unknowns_acknowledged" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"payload_sha256" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluation_review_request" UNIQUE("organization_id","created_by","idempotency_key"),
	CONSTRAINT "evaluation_review_verdict" CHECK ("creator_evaluation_reviews"."verdict" in ('approved','hold','rejected')),
	CONSTRAINT "evaluation_review_ack" CHECK ("creator_evaluation_reviews"."unknowns_acknowledged" in ('yes','no')),
	CONSTRAINT "evaluation_review_reason" CHECK (length(trim("creator_evaluation_reviews"."reason")) between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "creator_evaluations" ADD CONSTRAINT "creator_evaluations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_evaluations" ADD CONSTRAINT "evaluation_campaign_fk" FOREIGN KEY ("organization_id","project_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_evaluations" ADD CONSTRAINT "evaluation_creator_fk" FOREIGN KEY ("organization_id","campaign_id","creator_account_id") REFERENCES "public"."campaign_creators"("organization_id","campaign_id","creator_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_evaluations" ADD CONSTRAINT "evaluation_brief_fk" FOREIGN KEY ("organization_id","project_id","campaign_id","brief_version") REFERENCES "public"."campaign_brief_revisions"("organization_id","project_id","campaign_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_requests" ADD CONSTRAINT "evaluation_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_requests" ADD CONSTRAINT "evaluation_request_creator_fk" FOREIGN KEY ("organization_id","campaign_id","creator_account_id") REFERENCES "public"."campaign_creators"("organization_id","campaign_id","creator_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_evaluation_reviews" ADD CONSTRAINT "creator_evaluation_reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_evaluation_reviews" ADD CONSTRAINT "evaluation_review_fk" FOREIGN KEY ("organization_id","evaluation_id") REFERENCES "public"."creator_evaluations"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evaluation_campaign_time" ON "creator_evaluations" USING btree ("organization_id","campaign_id","created_at");
--> statement-breakpoint
CREATE TRIGGER evaluation_immutable BEFORE UPDATE OR DELETE ON creator_evaluations FOR EACH ROW EXECUTE FUNCTION eruty_discovery_append_only();
--> statement-breakpoint
CREATE TRIGGER evaluation_review_immutable BEFORE UPDATE OR DELETE ON creator_evaluation_reviews FOR EACH ROW EXECUTE FUNCTION eruty_discovery_append_only();
--> statement-breakpoint
CREATE FUNCTION eruty_evaluation_request_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Preserve evaluation generation history' USING ERRCODE='23514'; END IF;
 IF OLD.state<>'started' OR NEW.state NOT IN ('succeeded','failed') OR
  (to_jsonb(NEW)-ARRAY['state','error_code','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','error_code','updated_at']) THEN
  RAISE EXCEPTION 'Evaluation request can only finish once' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER evaluation_request_transition BEFORE UPDATE OR DELETE ON evaluation_requests FOR EACH ROW EXECUTE FUNCTION eruty_evaluation_request_transition();

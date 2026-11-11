CREATE TABLE outreach_review_drafts (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL, campaign_id uuid NOT NULL, creator_account_id uuid NOT NULL, source_preview_id uuid NOT NULL,
 context_sha256 text NOT NULL CHECK(context_sha256 ~ '^[a-f0-9]{64}$'), body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 1000), basis text NOT NULL DEFAULT '' CHECK(length(basis)<=2000), evidence_ids uuid[] NOT NULL DEFAULT '{}' CHECK(cardinality(evidence_ids)<=10),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sending','sent','failed','unknown')), sender_account_id uuid, sent_at timestamptz,
 created_by uuid NOT NULL, updated_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,project_id,campaign_id) REFERENCES campaigns(organization_id,project_id,id),
 FOREIGN KEY(organization_id,campaign_id,creator_account_id) REFERENCES campaign_creators(organization_id,campaign_id,creator_account_id),
 FOREIGN KEY(organization_id,source_preview_id) REFERENCES outreach_chat_previews(organization_id,id),
 FOREIGN KEY(organization_id,sender_account_id) REFERENCES outreach_sender_accounts(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES organization_memberships(organization_id,user_id)
);
CREATE UNIQUE INDEX review_one_editable_creator ON outreach_review_drafts(organization_id,campaign_id,creator_account_id) WHERE status='draft';
CREATE INDEX review_project_history ON outreach_review_drafts(organization_id,project_id,updated_at DESC);
CREATE INDEX review_uncertain_creator ON outreach_review_drafts(organization_id,creator_account_id) WHERE status='unknown';
CREATE TABLE outreach_review_batches (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL, account_id uuid NOT NULL, items jsonb NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items) BETWEEN 1 AND 5), input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'), created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),
 FOREIGN KEY(organization_id,account_id) REFERENCES outreach_sender_accounts(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id)
);
ALTER TABLE outreach_browser_sends ADD COLUMN review_draft_id uuid, ADD COLUMN review_draft_revision integer, ADD COLUMN review_batch_id uuid,
 ADD CONSTRAINT browser_review_draft_scope FOREIGN KEY(organization_id,review_draft_id) REFERENCES outreach_review_drafts(organization_id,id),
 ADD CONSTRAINT browser_review_batch_scope FOREIGN KEY(organization_id,review_batch_id) REFERENCES outreach_review_batches(organization_id,id),
 ADD CONSTRAINT browser_review_approval CHECK((review_draft_id IS NULL AND review_draft_revision IS NULL AND review_batch_id IS NULL) OR (review_draft_id IS NOT NULL AND review_draft_revision>0 AND review_batch_id IS NOT NULL AND draft_id IS NULL));
CREATE UNIQUE INDEX browser_review_one_attempt ON outreach_browser_sends(organization_id,review_draft_id) WHERE review_draft_id IS NOT NULL;
ALTER TABLE outreach_browser_executors ADD COLUMN protocol_version integer NOT NULL DEFAULT 1 CHECK(protocol_version IN (1,2));
--> statement-breakpoint
CREATE FUNCTION protect_outreach_review_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Review drafts cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.project_id,NEW.campaign_id,NEW.creator_account_id,NEW.source_preview_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.project_id,OLD.campaign_id,OLD.creator_account_id,OLD.source_preview_id,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Review recipient is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.status='draft' AND NEW.status='draft' THEN
  IF NEW.revision<>OLD.revision+1 OR NEW.sender_account_id IS DISTINCT FROM OLD.sender_account_id THEN RAISE EXCEPTION 'Review revision conflict' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.body,NEW.basis,NEW.evidence_ids,NEW.context_sha256,NEW.revision) IS DISTINCT FROM (OLD.body,OLD.basis,OLD.evidence_ids,OLD.context_sha256,OLD.revision) THEN RAISE EXCEPTION 'Submitted review text is immutable' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='draft' AND NEW.status='sending' AND NEW.sender_account_id IS NOT NULL) OR (OLD.status='sending' AND NEW.status IN ('sent','failed','unknown')) OR (OLD.status='unknown' AND NEW.status='sent')) THEN RAISE EXCEPTION 'Review transition is closed' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'draft' AND NEW.sender_account_id IS DISTINCT FROM OLD.sender_account_id THEN RAISE EXCEPTION 'Review sender is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_outreach_review_draft BEFORE UPDATE OR DELETE ON outreach_review_drafts FOR EACH ROW EXECUTE FUNCTION protect_outreach_review_draft();
CREATE FUNCTION protect_outreach_review_batch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Review batch approval is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER protect_outreach_review_batch BEFORE UPDATE OR DELETE ON outreach_review_batches FOR EACH ROW EXECUTE FUNCTION protect_outreach_review_batch();
--> statement-breakpoint
CREATE FUNCTION protect_browser_review_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.review_draft_id,NEW.review_draft_revision,NEW.review_batch_id) IS DISTINCT FROM (OLD.review_draft_id,OLD.review_draft_revision,OLD.review_batch_id) THEN RAISE EXCEPTION 'Review send approval is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_browser_review_link BEFORE UPDATE ON outreach_browser_sends FOR EACH ROW EXECUTE FUNCTION protect_browser_review_link();

-- Group only an already identified creator within the same campaign. Legacy
-- conversations without a campaign remain separate; message evidence is untouched.
CREATE TABLE contact_workflows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
 campaign_id uuid NOT NULL, creator_account_id uuid NOT NULL,
 progress text NOT NULL DEFAULT 'proposal' CHECK(progress IN ('proposal','negotiating','agreed','declined','hold','closed')),
 owner_id uuid NOT NULL, next_action_on date, notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000), revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by uuid NOT NULL, updated_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,campaign_id,creator_account_id),
 FOREIGN KEY(organization_id,campaign_id,creator_account_id) REFERENCES campaign_creators(organization_id,campaign_id,creator_account_id),
 FOREIGN KEY(organization_id,owner_id) REFERENCES organization_memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES organization_memberships(organization_id,user_id)
);
-- Seed shared management from the latest edited case. Original channel metadata
-- remains on contact_cases and is readable as pre-unification history.
INSERT INTO contact_workflows(organization_id,campaign_id,creator_account_id,progress,owner_id,next_action_on,notes,created_by,updated_by,created_at,updated_at)
 SELECT DISTINCT ON (organization_id,campaign_id,creator_account_id)
 organization_id,campaign_id,creator_account_id,progress,owner_id,next_action_on,notes,created_by,updated_by,created_at,updated_at
 FROM contact_cases WHERE campaign_id IS NOT NULL
 ORDER BY organization_id,campaign_id,creator_account_id,updated_at DESC,id;
ALTER TABLE contact_cases ADD COLUMN workflow_id uuid;
UPDATE contact_cases c SET workflow_id=w.id FROM contact_workflows w WHERE c.organization_id=w.organization_id AND c.campaign_id=w.campaign_id AND c.creator_account_id=w.creator_account_id;
ALTER TABLE contact_workflows ADD CONSTRAINT contact_workflow_identity UNIQUE(organization_id,id,campaign_id,creator_account_id);
ALTER TABLE contact_cases ADD CONSTRAINT contact_case_workflow FOREIGN KEY(organization_id,workflow_id,campaign_id,creator_account_id) REFERENCES contact_workflows(organization_id,id,campaign_id,creator_account_id);
--> statement-breakpoint
-- Keep confirmed-send projection compatible during the short deployment window.
CREATE FUNCTION link_contact_workflow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.campaign_id IS NOT NULL AND NEW.workflow_id IS NULL THEN
  INSERT INTO contact_workflows(organization_id,campaign_id,creator_account_id,progress,owner_id,next_action_on,notes,created_by,updated_by)
   VALUES(NEW.organization_id,NEW.campaign_id,NEW.creator_account_id,NEW.progress,NEW.owner_id,NEW.next_action_on,NEW.notes,NEW.created_by,NEW.updated_by)
   ON CONFLICT(organization_id,campaign_id,creator_account_id) DO NOTHING;
  SELECT id INTO NEW.workflow_id FROM contact_workflows WHERE organization_id=NEW.organization_id AND campaign_id=NEW.campaign_id AND creator_account_id=NEW.creator_account_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER link_contact_workflow BEFORE INSERT OR UPDATE OF workflow_id,campaign_id,creator_account_id ON contact_cases FOR EACH ROW EXECUTE FUNCTION link_contact_workflow();
--> statement-breakpoint
ALTER TABLE contact_cases ADD CONSTRAINT contact_case_workflow_required CHECK((campaign_id IS NULL)=(workflow_id IS NULL));
ALTER TABLE outreach_drafts ADD COLUMN compose_step integer NOT NULL DEFAULT 0 CHECK(compose_step BETWEEN 0 AND 3);
UPDATE outreach_drafts SET compose_step=CASE WHEN status<>'draft' OR (from_address<>'' AND to_address<>'') THEN 3 WHEN body<>'' THEN 1 ELSE 0 END;

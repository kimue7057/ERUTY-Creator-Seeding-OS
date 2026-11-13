CREATE TABLE outreach_ai_settings (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id), credentials_ciphertext text NOT NULL, model text NOT NULL CHECK(length(model) BETWEEN 1 AND 160), enabled boolean NOT NULL DEFAULT true,
 verified_at timestamptz NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_by uuid NOT NULL, updated_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id), FOREIGN KEY(organization_id,updated_by) REFERENCES organization_memberships(organization_id,user_id)
);

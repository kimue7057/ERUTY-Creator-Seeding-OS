CREATE TABLE outreach_review_translations (
 organization_id uuid NOT NULL REFERENCES organizations(id), source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 source_subject text NOT NULL CHECK(length(source_subject)<=200), source_body text NOT NULL CHECK(length(source_body) BETWEEN 1 AND 12000),
 subject text NOT NULL CHECK(length(subject)<=500), body text NOT NULL CHECK(length(body) BETWEEN 1 AND 18000), model text NOT NULL,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,source_sha256), FOREIGN KEY(organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id)
);

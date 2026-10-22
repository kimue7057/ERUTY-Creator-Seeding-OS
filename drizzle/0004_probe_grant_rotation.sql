-- Preserve revoked grants and their audit/receipt references while permitting a new sandbox.
ALTER TABLE "discovery_probe_grants" DROP CONSTRAINT "probe_principal_identity";--> statement-breakpoint
CREATE UNIQUE INDEX "probe_principal_identity" ON "discovery_probe_grants" USING btree ("issuer","subject") WHERE "discovery_probe_grants"."revoked_at" is null;

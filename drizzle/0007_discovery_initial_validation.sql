ALTER TABLE "discovery_capability_receipts" DROP CONSTRAINT "discovery_capability_kind";--> statement-breakpoint
ALTER TABLE "discovery_capability_receipts" ADD CONSTRAINT "discovery_capability_kind" CHECK ("discovery_capability_receipts"."kind" in ('sns_native_search', 'work_mcp_write', 'initial_validation'));
--> statement-breakpoint
ALTER TABLE "discovery_capability_receipts" ADD CONSTRAINT "discovery_initial_validation_unverified" CHECK ("discovery_capability_receipts"."kind" <> 'initial_validation' or "discovery_capability_receipts"."verdict" = 'partial');

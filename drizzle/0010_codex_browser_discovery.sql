-- Add a distinct local browser source; do not reclassify existing Work or test rows.
ALTER TABLE discovery_runs DROP CONSTRAINT discovery_run_source;
ALTER TABLE discovery_runs ADD CONSTRAINT discovery_run_source CHECK (execution_source IN ('work_manual_task','manual_import','codex_test','codex_browser'));
--> statement-breakpoint
ALTER TABLE discovery_evidence ADD COLUMN browser_trace_reference text;
--> statement-breakpoint
ALTER TABLE discovery_runs ADD CONSTRAINT discovery_run_codex_provenance CHECK (
  execution_source <> 'codex_browser' OR (
    work_task_reference IS NULL AND capability_receipt_id IS NULL
    AND COALESCE(environment_snapshot->>'browser_connection','') = 'unverified'
    AND COALESCE(environment_snapshot->>'browser_surface','') IN ('iab','chrome')
    AND environment_snapshot->>'local_authorization_id' IS NOT NULL
    AND environment_snapshot->>'execution_reference' IS NOT NULL
  )
);

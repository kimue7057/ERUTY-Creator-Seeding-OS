import { z } from "zod";
import type { Client } from "pg";
import { canonicalJson } from "./contracts";
const receipt = z.object({ contract_version: z.literal(1), run_id: z.uuid(), campaign_id: z.uuid(), creator_account_id: z.uuid(), campaign_creator_id: z.uuid(), evidence_ids: z.array(z.uuid()).min(1).max(4), actor_id: z.uuid(), principal_id: z.uuid(), request_id: z.uuid(), payload_sha256: z.string().regex(/^[a-f0-9]{64}$/), recorded_at: z.iso.datetime(), verification_state: z.literal("verification_pending") });
export const discoveryProofInput = z.object({ observation: receipt, read: z.object({ run_id: z.uuid(), organization_id: z.uuid(), campaign_id: z.uuid(), execution_source: z.enum(["work_manual_task", "codex_test", "manual_import"]), evidence: z.array(z.object({ id: z.uuid(), payloadSha256: z.string(), creatorAccountId: z.uuid(), createdBy: z.uuid(), sourceUrl: z.string(), profileUrl: z.string(), observedAt: z.iso.datetime(), facts: z.record(z.string(), z.unknown()), observationMethod: z.enum(["sns_browser", "supplemental_web", "manual_import", "codex_test"]) })).max(100) }) });
export async function verifyDiscoveryProof(client: Client, input: unknown, expected: { organizationId: string; closed: boolean }) {
  const { observation: written, read } = discoveryProofInput.parse(input);
  if (read.organization_id !== expected.organizationId || read.run_id !== written.run_id || read.campaign_id !== written.campaign_id) throw new Error("Proof scope mismatch");
  const { rows: [run] } = await client.query("select * from discovery_runs where id=$1 and organization_id=$2", [written.run_id, expected.organizationId]);
  if (!run || run.campaign_id !== written.campaign_id || run.execution_source !== read.execution_source) throw new Error("Run mismatch");
  const { rows: [request] } = await client.query("select * from discovery_requests where organization_id=$1 and request_id=$2 and tool='record_observation'", [expected.organizationId, written.request_id]);
  if (!request || request.actor_id !== written.actor_id || request.payload_sha256 !== written.payload_sha256 || request.receipt.recorded_at !== written.recorded_at) throw new Error("Request receipt mismatch");
  for (const [key, value] of Object.entries(written)) if (JSON.stringify(value) !== JSON.stringify(request.receipt[key])) throw new Error("Response receipt mismatch");
  const { rows } = await client.query("select * from discovery_evidence where organization_id=$1 and run_id=$2 and creator_account_id=$3 and id=any($4::uuid[])", [expected.organizationId, written.run_id, written.creator_account_id, written.evidence_ids]);
  if (rows.length !== written.evidence_ids.length || new Set(written.evidence_ids).size !== rows.length || rows.some(row => row.payload_sha256 !== written.payload_sha256 || row.created_by !== written.actor_id)) throw new Error("Evidence mismatch");
  for (const row of rows) {
    const response = read.evidence.find(value => value.id === row.id);
    if (!response || response.payloadSha256 !== row.payload_sha256 || response.creatorAccountId !== row.creator_account_id || response.createdBy !== row.created_by || response.sourceUrl !== row.source_url || response.profileUrl !== row.profile_url || response.observedAt !== row.observed_at.toISOString() || response.observationMethod !== row.observation_method || canonicalJson(response.facts) !== canonicalJson(row.facts)) throw new Error("MCP read response mismatch");
  }
  const { rows: [link] } = await client.query("select * from campaign_creators where id=$1 and organization_id=$2 and campaign_id=$3 and creator_account_id=$4", [written.campaign_creator_id, expected.organizationId, written.campaign_id, written.creator_account_id]);
  if (!link) throw new Error("Campaign creator missing");
  const { rows: [grant] } = await client.query("select * from discovery_mcp_grants where id=$1 and organization_id=$2 and user_id=$3", [written.principal_id, expected.organizationId, written.actor_id]);
  if (!grant || grant.execution_source !== run.execution_source || grant.environment_sha256 !== run.environment_snapshot.environment_sha256) throw new Error("Grant source/environment mismatch");
  const audit = await client.query("select action from audit_events where organization_id=$1 and actor_id=$2 and entity_id=any($3::uuid[])", [expected.organizationId, written.actor_id, [written.request_id, written.run_id]]);
  if (!["discovery.record_observation", "discovery.run_read"].every(action => audit.rows.some(row => row.action === action))) throw new Error("Audit missing");
  if (expected.closed ? !grant.revoked_at : grant.revoked_at || grant.expires_at <= new Date()) throw new Error("Grant closeout mismatch");
  if (expected.closed) {
    const revoke = await client.query("select 1 from audit_events where organization_id=$1 and entity_id=$2 and action='discovery.mcp_grant_revoked_by_operator'", [expected.organizationId, written.principal_id]);
    if (!revoke.rowCount) throw new Error("Revocation audit missing");
  }
  const permissions = await client.query(`select has_schema_privilege(current_user,'public','CREATE') as can_create,
    exists(select 1 from pg_tables where schemaname='public' and (has_any_column_privilege(current_user, quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE') or has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'DELETE,TRUNCATE'))) as can_mutate,
    (select rolsuper or rolcreaterole or rolcreatedb or rolbypassrls from pg_roles where rolname=current_user) as elevated`);
  if (Object.values(permissions.rows[0]).some(value => value === true)) throw new Error("Independent verifier must be read-only");
  return { run_id: run.id, request_id: written.request_id, creator_account_id: written.creator_account_id, payload_sha256: written.payload_sha256, persisted_readback: true, read_only_verifier: true, audited: true, execution_source: run.execution_source, grant_revoked: !!grant.revoked_at, work_connection: "unverified", operator_work_sns_trace_review: "required" };
}

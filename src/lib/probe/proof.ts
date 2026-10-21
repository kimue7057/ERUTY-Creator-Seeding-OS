import { z } from "zod";
import type { Client } from "pg";
import { probeHash } from "./contracts";
const receipt = z.object({
  contract_version: z.literal(1), probe_id: z.uuid(), nonce: z.uuid(), payload_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  request_id: z.uuid(), organization_id: z.uuid(), project_id: z.uuid(), campaign_id: z.uuid(), principal_id: z.uuid(), actor_id: z.uuid(), recorded_at: z.iso.datetime(),
});
export const proofInput = z.strictObject({
  capabilities: z.object({ contract_version: z.literal(1), organization_id: z.uuid(), project_id: z.uuid(), campaign_id: z.uuid(), principal_id: z.uuid(), sandbox_only: z.literal(true), build: z.string().regex(/^[a-f0-9]{7,40}$/), scopes: z.array(z.string()) }),
  write: receipt, read: receipt,
});
export async function verifyProbeProof(client: Client, evidence: unknown, expected: { organizationId: string; grantId: string; build: string; closed: boolean }) {
  const { capabilities, write, read } = proofInput.parse(evidence);
  if (!/^[a-f0-9]{7,40}$/.test(expected.build) || capabilities.build !== expected.build || !["discovery:read", "discovery:probe"].every(s => capabilities.scopes.includes(s))) throw new Error("Capability build/scopes mismatch");
  for (const value of [capabilities, write, read]) {
    if (value.organization_id !== expected.organizationId || value.principal_id !== expected.grantId || value.project_id !== write.project_id || value.campaign_id !== write.campaign_id) throw new Error("Scope mismatch");
  }
  for (const field of Object.keys(write) as (keyof typeof write)[]) if (write[field] !== read[field]) throw new Error("Write/read receipt mismatch");
  if (write.payload_sha256 !== probeHash(write.nonce)) throw new Error("Invalid receipt hash");
  const result = await client.query(`select p.*, w.purpose, w.disabled_at, g.revoked_at, g.expires_at, g.scopes,
    (select count(*)::int from discovery_probe_grants x where x.organization_id=p.organization_id and x.revoked_at is null and x.expires_at > now()) as active_grants
    from discovery_probes p join discovery_probe_workspaces w on w.organization_id=p.organization_id
    join discovery_probe_grants g on g.id=p.principal_id
    where p.id=$1 and p.organization_id=$2 and p.principal_id=$3`, [write.probe_id, expected.organizationId, expected.grantId]);
  const row = result.rows[0];
  if (!row || row.purpose !== "synthetic_mcp_probe" || row.project_id !== write.project_id || row.campaign_id !== write.campaign_id || row.nonce !== write.nonce || row.payload_sha256 !== write.payload_sha256 || row.request_id !== write.request_id || row.actor_id !== write.actor_id || row.created_at.toISOString() !== write.recorded_at) throw new Error("Independent database receipt mismatch");
  const audits = await client.query("select action from audit_events where organization_id=$1 and actor_id=$2 and entity_id=$3", [write.organization_id, write.actor_id, write.probe_id]);
  const actions = audits.rows.map(r => r.action as string);
  if (!["discovery.probe_written", "discovery.probe_read"].every(a => actions.includes(a))) throw new Error("Write/read audit missing");
  if (expected.closed) {
    const revoked = await client.query("select 1 from audit_events where organization_id=$1 and entity_id=$2 and action='discovery.probe_grant_revoked_by_operator_cli'", [expected.organizationId, expected.grantId]);
    if (!row.revoked_at || row.active_grants !== 0 || !revoked.rowCount) throw new Error("Closeout requires revocation audit and no active sandbox grants");
  } else if (row.revoked_at || row.disabled_at || row.expires_at <= new Date()) throw new Error("Grant/workspace inactive");
  const permissions = await client.query(`select current_user as role,
    has_table_privilege(current_user,'discovery_probes','INSERT') as can_insert,
    has_table_privilege(current_user,'discovery_probes','UPDATE') as can_update,
    has_table_privilege(current_user,'discovery_probes','DELETE') as can_delete,
    has_table_privilege(current_user,'audit_events','INSERT') as can_audit,
    has_table_privilege(current_user,'discovery_probe_grants','UPDATE') as can_grant,
    exists(select 1 from pg_tables where schemaname='public' and (
      has_any_column_privilege(current_user, quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE')
      or has_table_privilege(current_user, quote_ident(schemaname)||'.'||quote_ident(tablename),'DELETE,TRUNCATE')
    )) as can_mutate_public_tables,
    has_schema_privilege(current_user,'public','CREATE') as can_create,
    (select rolsuper or rolcreaterole or rolcreatedb or rolbypassrls from pg_roles where rolname=current_user) as elevated`);
  const permission = permissions.rows[0];
  if (Object.entries(permission).some(([key, value]) => key !== "role" && value === true)) throw new Error("Use an independent read-only database verifier role");
  return { probe_id: write.probe_id, request_id: write.request_id, payload_sha256: write.payload_sha256, build: capabilities.build, persisted_readback: true, write_read_audits: true, grant_revoked: !!row.revoked_at, no_active_grants: row.active_grants === 0, verifier_read_only: true, work_connection: "unverified", operator_work_trace_review: "required", recorded_at: new Date().toISOString() };
}

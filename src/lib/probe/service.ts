import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { auditEvents, discoveryProbeGrants as grants, discoveryProbeWorkspaces as workspaces, discoveryProbes as probes, memberships } from "../db/schema";
import { ProbeError, PROBE_SCOPES, probeHash, type ProbeIdentity, type ProbeScope, writeProbeInput, readProbeInput, capabilitiesInput } from "./contracts";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export function probeService(organizationId: string, build: string, database: Pick<typeof db, "transaction"> = db) {
  const transaction = <T>(run: (tx: Transaction) => Promise<T>) => database.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout = '5s'`);
    await tx.execute(sql`set local lock_timeout = '3s'`);
    return run(tx);
  });
  async function authorize(tx: Transaction, identity: ProbeIdentity, scope: ProbeScope) {
    if (identity.expiresAt <= Date.now() / 1000) throw new ProbeError(401, "invalid_token");
    const [actor] = await tx.select({ principalId: grants.id, userId: grants.userId, organizationId: grants.organizationId, scopes: grants.scopes, role: memberships.role, projectId: workspaces.projectId, campaignId: workspaces.campaignId })
      .from(grants).innerJoin(workspaces, eq(grants.organizationId, workspaces.organizationId))
      .innerJoin(memberships, and(eq(memberships.organizationId, grants.organizationId), eq(memberships.userId, grants.userId)))
      .where(and(eq(grants.organizationId, organizationId), eq(grants.issuer, identity.issuer), eq(grants.subject, identity.subject), isNull(grants.revokedAt), gt(grants.expiresAt, new Date()), isNull(workspaces.disabledAt)))
      .for("share", { of: [grants, workspaces, memberships] });
    if (!actor) throw new ProbeError(403, "principal_not_allowed");
    const scopes = PROBE_SCOPES.filter(s => identity.scopes.includes(s) && actor.scopes.includes(s) && (s !== "discovery:probe" || actor.role !== "reviewer"));
    if (!identity.scopes.includes(scope)) throw new ProbeError(403, "insufficient_scope");
    if (!actor.scopes.includes(scope)) throw new ProbeError(403, "grant_scope_denied");
    if (!scopes.includes(scope)) throw new ProbeError(403, "role_forbidden");
    return { ...actor, scopes };
  }
  const receipt = (row: typeof probes.$inferSelect, replayed: boolean) => ({ contract_version: 1, probe_id: row.id, nonce: row.nonce, payload_sha256: row.payloadSha256, request_id: row.requestId, recorded_at: row.createdAt.toISOString(), organization_id: row.organizationId, project_id: row.projectId, campaign_id: row.campaignId, principal_id: row.principalId, actor_id: row.actorId, replayed });
  return {
    async check(identity: ProbeIdentity) { await transaction(tx => authorize(tx, identity, "discovery:read")); },
    async capabilities(identity: ProbeIdentity, input: unknown) {
      capabilitiesInput.parse(input);
      return transaction(async tx => {
        const actor = await authorize(tx, identity, "discovery:read");
        return { contract_version: 1, server: "eruty-discovery-probe", build, principal_id: actor.principalId, organization_id: actor.organizationId, project_id: actor.projectId, campaign_id: actor.campaignId, scopes: actor.scopes, sandbox_only: true, work_connection: "unverified", sns_discovery: "not_implemented", remote_execution: "not_implemented" };
      });
    },
    async write(identity: ProbeIdentity, input: unknown, requestId: string) {
      const data = writeProbeInput.parse(input); const hash = probeHash(data.nonce);
      return transaction(async tx => {
        const actor = await authorize(tx, identity, "discovery:probe");
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor.principalId}), hashtext(${data.idempotency_key}))`);
        const [existing] = await tx.select().from(probes).where(and(eq(probes.principalId, actor.principalId), eq(probes.idempotencyKey, data.idempotency_key)));
        if (existing && existing.payloadSha256 !== hash) throw new ProbeError(409, "idempotency_conflict");
        // Bound per-principal persisted data; replays still work when the quota is full.
        if (!existing) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor.principalId}))`);
          const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(probes).where(eq(probes.principalId, actor.principalId));
          if (total >= 100) throw new ProbeError(429, "probe_quota_exceeded");
        }
        const row = existing ?? (await tx.insert(probes).values({ organizationId: actor.organizationId, projectId: actor.projectId, campaignId: actor.campaignId, principalId: actor.principalId, actorId: actor.userId, idempotencyKey: data.idempotency_key, nonce: data.nonce, payloadSha256: hash, requestId }).returning())[0];
        await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: row.id, action: existing ? "discovery.probe_replayed" : "discovery.probe_written" });
        return receipt(row, !!existing);
      });
    },
    async read(identity: ProbeIdentity, input: unknown) {
      const data = readProbeInput.parse(input);
      return transaction(async tx => {
        const actor = await authorize(tx, identity, "discovery:read");
        const [row] = await tx.select().from(probes).where(and(eq(probes.id, data.probe_id), eq(probes.organizationId, actor.organizationId), eq(probes.principalId, actor.principalId), eq(probes.actorId, actor.userId)));
        if (!row) throw new ProbeError(404, "not_found_or_forbidden");
        await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: row.id, action: "discovery.probe_read" });
        return receipt(row, false);
      });
    },
  };
}

import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { auditEvents, campaigns, memberships } from "../db/schema";
import { discoveryOperatingApprovals as approvals, discoveryOperatingCampaigns as allowed } from "../db/discovery-schema";
import { DiscoveryError, discoveryHash } from "./contracts";
import { DISCOVERY_SCOPES, discoveryEnvironmentHash, type DiscoveryMcpConfig } from "./mcp-config";
import type { ProbeIdentity } from "../probe/contracts";
import type { DiscoveryScope, DiscoveryTransaction } from "./service";

export const OPERATING_APPROVAL_MAX_MS = 7 * 24 * 3600000;
const approvalInput = z.strictObject({ organization_id: z.uuid(), user_id: z.uuid(), approved_by: z.uuid(),
  issuer: z.url().max(500), subject: z.string().min(1).max(255), resource: z.url().max(1000),
  environment_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  campaign_ids: z.array(z.uuid()).min(1).max(100).refine(ids => new Set(ids).size === ids.length),
  scopes: z.array(z.enum(DISCOVERY_SCOPES)).min(1).max(3).refine(scopes => scopes.includes("discovery:read") && new Set(scopes).size === scopes.length),
  expires_at: z.iso.datetime({ offset: true }), reason: z.string().trim().min(1).max(2000), idempotency_key: z.uuid(),
  confirmation: z.literal("approve-bounded-discovery-operation"),
});
async function requireAdmin(tx: DiscoveryTransaction, organizationId: string, userId: string) {
  const [member] = await tx.select().from(memberships).where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId))).for("share");
  if (member?.role !== "admin") throw new DiscoveryError(403, "approval_admin_required");
}
const receipt = (approval: typeof approvals.$inferSelect, campaignIds: string[], replayed: boolean) => ({
  approval_id: approval.id, organization_id: approval.organizationId, campaign_ids: campaignIds, scopes: approval.scopes,
  expires_at: approval.expiresAt.toISOString(), revoked: !!approval.revokedAt, replayed,
});
// Operator only. No MCP tool, timer or supervisor can enroll or renew an approval.
export async function approveDiscoveryOperation(input: unknown, config: DiscoveryMcpConfig, database: Pick<typeof db, "transaction"> = db) {
  const data = approvalInput.parse(input), hash = discoveryHash(data), expiry = new Date(data.expires_at);
  if (!config.operatingApprovalsEnabled || data.organization_id !== config.organizationId || data.issuer !== config.issuer || data.resource !== config.resource || data.environment_sha256 !== discoveryEnvironmentHash(config)) throw new DiscoveryError(409, "approval_environment_mismatch");
  return database.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout = '10s'`);
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${data.organization_id}), hashtext(${"approval-key:" + data.approved_by + ":" + data.idempotency_key}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${data.organization_id}), hashtext(${data.issuer + ":" + data.subject}))`);
    await requireAdmin(tx, data.organization_id, data.approved_by);
    const [saved] = await tx.select().from(approvals).where(and(eq(approvals.organizationId, data.organization_id), eq(approvals.approvedBy, data.approved_by), eq(approvals.idempotencyKey, data.idempotency_key)));
    if (saved) {
      if (saved.payloadSha256 !== hash) throw new DiscoveryError(409, "idempotency_conflict");
      const bound = await tx.select().from(allowed).where(eq(allowed.approvalId, saved.id));
      return receipt(saved, bound.map(c => c.campaignId), true);
    }
    if (expiry.getTime() <= Date.now() || expiry.getTime() > Date.now() + OPERATING_APPROVAL_MAX_MS) throw new DiscoveryError(400, "approval_invalid_lifetime");
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.organizationId, data.organization_id), eq(memberships.userId, data.user_id))).for("share");
    if (!member || member.role === "reviewer" && data.scopes.some(s => s !== "discovery:read")) throw new DiscoveryError(403, "role_forbidden");
    const selected = await tx.select().from(campaigns).where(eq(campaigns.organizationId, data.organization_id));
    const targets = data.campaign_ids.map(id => selected.find(c => c.id === id && c.status !== "archived"));
    if (targets.some(c => !c)) throw new DiscoveryError(404, "not_found_or_forbidden");
    const current = await tx.select().from(approvals).where(and(eq(approvals.organizationId, data.organization_id), eq(approvals.issuer, data.issuer), eq(approvals.subject, data.subject)));
    if (current.some(a => !a.revokedAt && a.expiresAt.getTime() > Date.now())) throw new DiscoveryError(409, "approval_already_active");
    const [approval] = await tx.insert(approvals).values({ organizationId: data.organization_id, userId: data.user_id, approvedBy: data.approved_by,
      issuer: data.issuer, subject: data.subject, resource: data.resource, environmentSha256: data.environment_sha256,
      scopes: data.scopes, reason: data.reason, idempotencyKey: data.idempotency_key, payloadSha256: hash, expiresAt: expiry }).returning();
    await tx.insert(allowed).values(targets.map(c => ({ organizationId: data.organization_id, projectId: c!.projectId, campaignId: c!.id, approvalId: approval.id })));
    await tx.insert(auditEvents).values({ organizationId: data.organization_id, actorId: data.approved_by, entityId: approval.id, action: "discovery.operating_approval_created" });
    return receipt(approval, data.campaign_ids, false);
  });
}
export async function revokeDiscoveryOperation(input: { organizationId: string; approvalId: string; actorId: string }, database: Pick<typeof db, "transaction"> = db) {
  const data = z.strictObject({ organizationId: z.uuid(), approvalId: z.uuid(), actorId: z.uuid() }).parse(input);
  return database.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout = '10s'`);
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await requireAdmin(tx, data.organizationId, data.actorId);
    const [approval] = await tx.select().from(approvals).where(and(eq(approvals.organizationId, data.organizationId), eq(approvals.id, data.approvalId))).for("update");
    if (!approval) throw new DiscoveryError(404, "not_found_or_forbidden");
    if (!approval.revokedAt) {
      const now = new Date();
      await tx.update(approvals).set({ revokedAt: now, updatedAt: now }).where(eq(approvals.id, approval.id));
      await tx.insert(auditEvents).values({ organizationId: data.organizationId, actorId: data.actorId, entityId: approval.id, action: "discovery.operating_approval_revoked" });
    }
    return { approval_id: approval.id, revoked: true };
  });
}
export async function authorizeDiscoveryOperation(tx: DiscoveryTransaction, config: DiscoveryMcpConfig, identity: ProbeIdentity, scope: DiscoveryScope, campaignId?: string, pinnedId?: string) {
  const candidates = await tx.select({ id: approvals.id, userId: approvals.userId, organizationId: approvals.organizationId, scopes: approvals.scopes,
    role: memberships.role, expiresAt: approvals.expiresAt, revokedAt: approvals.revokedAt, environment: approvals.environmentSha256, resource: approvals.resource })
    .from(approvals).innerJoin(memberships, and(eq(memberships.organizationId, approvals.organizationId), eq(memberships.userId, approvals.userId)))
    .where(and(eq(approvals.organizationId, config.organizationId), eq(approvals.issuer, identity.issuer), eq(approvals.subject, identity.subject)))
    .orderBy(desc(approvals.createdAt)).for("share", { of: [approvals, memberships] });
  if (!candidates.length && !pinnedId) return null;
  const approval = pinnedId ? candidates.find(a => a.id === pinnedId) : candidates[0];
  if (!approval) throw new DiscoveryError(403, "approval_revoked");
  if (approval.revokedAt) throw new DiscoveryError(403, "approval_revoked");
  if (approval.expiresAt.getTime() <= Date.now()) throw new DiscoveryError(403, "approval_expired");
  if (approval.environment !== discoveryEnvironmentHash(config) || approval.resource !== config.resource) throw new DiscoveryError(403, "approval_environment_mismatch");
  if (!["discovery:read", scope].every(s => identity.scopes.includes(s))) throw new DiscoveryError(403, "insufficient_scope", { oauthChallenge: true });
  if (!["discovery:read", scope].every(s => approval.scopes.includes(s))) throw new DiscoveryError(403, "approval_scope_denied");
  if (scope !== "discovery:read" && approval.role === "reviewer") throw new DiscoveryError(403, "role_forbidden");
  const campaigns = await tx.select().from(allowed).where(and(eq(allowed.organizationId, config.organizationId), eq(allowed.approvalId, approval.id)));
  if (!campaigns.length || campaignId && !campaigns.some(c => c.campaignId === campaignId)) throw new DiscoveryError(404, "not_found_or_forbidden");
  return { ...approval, source: "work_manual_task" as const, campaigns, approvalKind: "operating" as const };
}

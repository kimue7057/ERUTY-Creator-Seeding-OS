import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { campaigns, memberships, auditEvents, discoveryProbeWorkspaces } from "../db/schema";
import { discoveryMcpGrants, discoveryGrantCampaigns, discoveryCapabilities } from "../db/discovery-schema";
import { platformSchema } from "./contracts";
import { DISCOVERY_SCOPES } from "./mcp-access";
const grantInput = z.strictObject({ organization_id: z.uuid(), user_id: z.uuid(), issuer: z.url().max(500), subject: z.string().min(1).max(255), environment_sha256: z.string().regex(/^[a-f0-9]{64}$/), execution_source: z.enum(["work_manual_task", "codex_test"]), campaign_ids: z.array(z.uuid()).min(1).max(100).refine(ids => new Set(ids).size === ids.length), scopes: z.array(z.enum(DISCOVERY_SCOPES)).min(1).max(3).refine(scopes => scopes.includes("discovery:read")), expires_at: z.iso.datetime({ offset: true }), confirmation: z.literal("create-explicit-discovery-campaign-grant") });
const initialRunInput = z.strictObject({ organization_id: z.uuid(), user_id: z.uuid(), grant_id: z.uuid(), campaign_id: z.uuid(), platform: platformSchema,
  environment_sha256: z.string().regex(/^[a-f0-9]{64}$/), max_creators: z.number().int().min(1).max(5), expires_at: z.iso.datetime({ offset: true }),
  private_evidence_sha256: z.string().regex(/^[a-f0-9]{64}$/), confirmation: z.literal("authorize-one-unverified-Work-run") });

// An operator's bounded experiment authorization is intentionally NOT a passed
// capability attestation. No MCP tool can call this provisioning path.
export async function authorizeInitialDiscoveryRun(input: unknown, database: Pick<typeof db, "transaction"> = db) {
  const data = initialRunInput.parse(input), expires = new Date(data.expires_at);
  if (expires <= new Date() || expires.getTime() > Date.now() + 4 * 3600000) throw new Error("Initial validation authorization is limited to four hours");
  return database.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${data.organization_id}), hashtext(${data.grant_id}))`);
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.organizationId, data.organization_id), eq(memberships.userId, data.user_id))).for("share");
    const [grant] = await tx.select().from(discoveryMcpGrants).where(and(eq(discoveryMcpGrants.organizationId, data.organization_id), eq(discoveryMcpGrants.id, data.grant_id))).for("share");
    const [campaign] = await tx.select().from(discoveryGrantCampaigns).where(and(eq(discoveryGrantCampaigns.organizationId, data.organization_id), eq(discoveryGrantCampaigns.grantId, data.grant_id), eq(discoveryGrantCampaigns.campaignId, data.campaign_id)));
    if (!member || member.role === "reviewer" || !grant || !campaign || grant.userId !== data.user_id || grant.executionSource !== "work_manual_task" || grant.revokedAt || grant.expiresAt < expires || grant.environmentSha256 !== data.environment_sha256 || !DISCOVERY_SCOPES.every(scope => grant.scopes.includes(scope))) throw new Error("Current allowlisted Work grant and writer required");
    const existing = await tx.select().from(discoveryCapabilities).where(and(eq(discoveryCapabilities.organizationId, data.organization_id), eq(discoveryCapabilities.kind, "initial_validation"), eq(discoveryCapabilities.platform, data.platform)));
    if (existing.some(row => row.facts.initial_validation?.grant_id === grant.id && row.facts.initial_validation.campaign_id === data.campaign_id)) throw new Error("Initial authorization already exists; preserve it and rotate the grant explicitly");
    const [permit] = await tx.insert(discoveryCapabilities).values({ organizationId: data.organization_id, platform: data.platform, kind: "initial_validation", verdict: "partial", environmentSha256: data.environment_sha256,
      privateEvidenceReference: `private-file-sha256:${data.private_evidence_sha256}`, observedAt: new Date(), reviewedBy: data.user_id,
      facts: { native_search: false, direct_profiles: 0, recent_content_profiles: 0, limitations: ["Operator authorized a single experiment; hosted Work, SNS visits and DB read-back in this environment remain unverified"], initial_validation: { grant_id: grant.id, campaign_id: data.campaign_id, max_creators: data.max_creators, expires_at: expires.toISOString() } } }).returning();
    await tx.insert(auditEvents).values({ organizationId: data.organization_id, actorId: data.user_id, entityId: permit.id, action: "discovery.initial_validation_authorized_by_operator" });
    return { authorization_id: permit.id, expires_at: expires.toISOString(), work_connection: "unverified" };
  });
}
// Operator only. No MCP/Next endpoint creates or expands grants.
export async function provisionDiscoveryGrant(input: unknown, database: Pick<typeof db, "transaction"> = db) {
  const data = grantInput.parse(input), issuer = new URL(data.issuer), expires = new Date(data.expires_at);
  if (issuer.username || issuer.password || issuer.search || issuer.hash || !(issuer.protocol === "https:" || process.env.NODE_ENV !== "production" && issuer.protocol === "http:" && issuer.hostname === "127.0.0.1")) throw new Error("Invalid issuer");
  if (expires <= new Date() || expires.getTime() > Date.now() + 86400000 || data.execution_source === "codex_test" && process.env.NODE_ENV === "production") throw new Error("Invalid grant source/lifetime");
  return database.transaction(async tx => {
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.organizationId, data.organization_id), eq(memberships.userId, data.user_id))).for("share");
    if (!member || member.role === "reviewer") throw new Error("Current writer membership required");
    const selected = await tx.select().from(campaigns).where(and(eq(campaigns.organizationId, data.organization_id), inArray(campaigns.id, data.campaign_ids)));
    if (selected.length !== data.campaign_ids.length) throw new Error("Campaign allowlist mismatch");
    if (data.execution_source === "codex_test") {
      const [sandbox] = await tx.select().from(discoveryProbeWorkspaces).where(and(eq(discoveryProbeWorkspaces.organizationId, data.organization_id), eq(discoveryProbeWorkspaces.purpose, "synthetic_mcp_probe")));
      if (!sandbox || selected.some(c => c.id !== sandbox.campaignId) || sandbox.disabledAt) throw new Error("Synthetic source requires an explicitly enrolled probe sandbox campaign");
    }
    const [grant] = await tx.insert(discoveryMcpGrants).values({ organizationId: data.organization_id, userId: data.user_id, issuer: issuer.href, subject: data.subject, environmentSha256: data.environment_sha256, executionSource: data.execution_source, scopes: [...new Set(data.scopes)], expiresAt: expires, createdBy: data.user_id }).returning();
    await tx.insert(discoveryGrantCampaigns).values(selected.map(c => ({ organizationId: data.organization_id, projectId: c.projectId, campaignId: c.id, grantId: grant.id })));
    await tx.insert(auditEvents).values({ organizationId: data.organization_id, actorId: data.user_id, entityId: grant.id, action: "discovery.mcp_grant_provisioned" });
    return { grant_id: grant.id, organization_id: data.organization_id, campaign_ids: data.campaign_ids, expires_at: grant.expiresAt.toISOString(), execution_source: grant.executionSource, work_connection: "unverified" };
  });
}

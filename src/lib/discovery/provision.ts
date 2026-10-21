import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { campaigns, memberships, auditEvents, discoveryProbeWorkspaces } from "../db/schema";
import { discoveryMcpGrants, discoveryGrantCampaigns } from "../db/discovery-schema";
import { DISCOVERY_SCOPES } from "./mcp-access";
const grantInput = z.strictObject({ organization_id: z.uuid(), user_id: z.uuid(), issuer: z.url().max(500), subject: z.string().min(1).max(255), environment_sha256: z.string().regex(/^[a-f0-9]{64}$/), execution_source: z.enum(["work_manual_task", "codex_test"]), campaign_ids: z.array(z.uuid()).min(1).max(100).refine(ids => new Set(ids).size === ids.length), scopes: z.array(z.enum(DISCOVERY_SCOPES)).min(1).max(3).refine(scopes => scopes.includes("discovery:read")), expires_at: z.iso.datetime({ offset: true }), confirmation: z.literal("create-explicit-discovery-campaign-grant") });
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

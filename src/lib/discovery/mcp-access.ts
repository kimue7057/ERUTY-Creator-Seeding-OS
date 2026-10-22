import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db";
import { memberships } from "../db/schema";
import { discoveryMcpGrants as grants, discoveryGrantCampaigns as allowed } from "../db/discovery-schema";
import type { ProbeIdentity } from "../probe/contracts";
import { DiscoveryError } from "./contracts";
import type { DiscoveryActor, DiscoveryScope, DiscoveryTransaction } from "./service";
import { discoveryEnvironmentHash, type DiscoveryMcpConfig } from "./mcp-config";
export { discoveryEnvironmentHash, discoveryMcpConfig, DISCOVERY_SCOPES, type DiscoveryMcpConfig } from "./mcp-config";
export function discoveryAccess(config: DiscoveryMcpConfig, database: Pick<typeof db, "transaction"> = db) {
  async function authorize(tx: DiscoveryTransaction, identity: ProbeIdentity, scope: DiscoveryScope, campaignId?: string) {
    if (identity.expiresAt <= Date.now() / 1000) throw new DiscoveryError(401, "invalid_token");
    const [grant] = await tx.select({ id: grants.id, userId: grants.userId, organizationId: grants.organizationId, scopes: grants.scopes, source: grants.executionSource, role: memberships.role })
      .from(grants).innerJoin(memberships, and(eq(memberships.organizationId, grants.organizationId), eq(memberships.userId, grants.userId)))
      .where(and(eq(grants.organizationId, config.organizationId), eq(grants.issuer, identity.issuer), eq(grants.subject, identity.subject), eq(grants.environmentSha256, discoveryEnvironmentHash(config)), isNull(grants.revokedAt), gt(grants.expiresAt, new Date())))
      .for("share", { of: [grants, memberships] });
    if (!grant || grant.source === "codex_test" && !config.allowSyntheticDiscovery) throw new DiscoveryError(403, "principal_not_allowed");
    if (!["discovery:read", scope].every(s => grant.scopes.includes(s) && identity.scopes.includes(s)) || scope !== "discovery:read" && grant.role === "reviewer") throw new DiscoveryError(403, "insufficient_scope");
    const campaigns = await tx.select().from(allowed).where(and(eq(allowed.organizationId, config.organizationId), eq(allowed.grantId, grant.id)));
    if (campaigns.length === 0 || campaignId && !campaigns.some(c => c.campaignId === campaignId)) throw new DiscoveryError(404, "not_found_or_forbidden");
    return { ...grant, campaigns };
  }
  return {
    async check(identity: ProbeIdentity) { await database.transaction(tx => authorize(tx, identity, "discovery:read")); },
    async actor(identity: ProbeIdentity): Promise<DiscoveryActor> {
      const grant = await database.transaction(tx => authorize(tx, identity, "discovery:read"));
      return { userId: grant.userId, organizationId: grant.organizationId, role: grant.role, principalId: grant.id, executionSource: grant.source, environmentSha256: discoveryEnvironmentHash(config), campaignIds: grant.campaigns.map(c => c.campaignId),
        reauthorize: async (tx, campaignId, scope) => { await authorize(tx, identity, scope, campaignId); },
      };
    },
  };
}

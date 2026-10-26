import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { memberships } from "../db/schema";
import { discoveryMcpGrants as grants, discoveryGrantCampaigns as allowed } from "../db/discovery-schema";
import type { ProbeIdentity } from "../probe/contracts";
import { DiscoveryError } from "./contracts";
import type { DiscoveryActor, DiscoveryScope, DiscoveryTransaction } from "./service";
import { discoveryEnvironmentHash, type DiscoveryMcpConfig } from "./mcp-config";
import { authorizeDiscoveryOperation } from "./operating-approval";
export { discoveryEnvironmentHash, discoveryMcpConfig, DISCOVERY_SCOPES, type DiscoveryMcpConfig } from "./mcp-config";
export function discoveryAccess(config: DiscoveryMcpConfig, database: Pick<typeof db, "transaction"> = db) {
  async function authorize(tx: DiscoveryTransaction, identity: ProbeIdentity, scope: DiscoveryScope, campaignId?: string, operatingId?: string) {
    if (identity.expiresAt <= Date.now() / 1000) throw new DiscoveryError(401, "invalid_token");
    await tx.execute(sql`set local statement_timeout = '8s'`);
    await tx.execute(sql`set local lock_timeout = '5s'`);
    if (config.operatingApprovalsEnabled) {
      const approval = await authorizeDiscoveryOperation(tx, config, identity, scope, campaignId, operatingId);
      if (approval) return approval;
    }
    const candidates = await tx.select({ id: grants.id, userId: grants.userId, organizationId: grants.organizationId, scopes: grants.scopes, source: grants.executionSource, role: memberships.role, expiresAt: grants.expiresAt, revokedAt: grants.revokedAt, environment: grants.environmentSha256 })
      .from(grants).innerJoin(memberships, and(eq(memberships.organizationId, grants.organizationId), eq(memberships.userId, grants.userId)))
      .where(and(eq(grants.organizationId, config.organizationId), eq(grants.issuer, identity.issuer), eq(grants.subject, identity.subject)))
      .orderBy(desc(grants.createdAt))
      .for("share", { of: [grants, memberships] });
    const matching = candidates.filter(grant => grant.environment === discoveryEnvironmentHash(config));
    const grant = matching.find(grant => !grant.revokedAt && grant.expiresAt.getTime() > Date.now());
    if (!grant && candidates.length) {
      const code = matching.some(grant => !grant.revokedAt) ? "grant_expired" : matching.length ? "grant_revoked" : "grant_environment_mismatch";
      throw new DiscoveryError(403, code);
    }
    if (!grant || grant.source === "codex_test" && !config.allowSyntheticDiscovery) throw new DiscoveryError(403, "principal_not_allowed");
    if (!["discovery:read", scope].every(s => identity.scopes.includes(s))) throw new DiscoveryError(403, "insufficient_scope", { oauthChallenge: true });
    if (!["discovery:read", scope].every(s => grant.scopes.includes(s))) throw new DiscoveryError(403, "grant_scope_denied");
    if (scope !== "discovery:read" && grant.role === "reviewer") throw new DiscoveryError(403, "role_forbidden");
    const campaigns = await tx.select().from(allowed).where(and(eq(allowed.organizationId, config.organizationId), eq(allowed.grantId, grant.id)));
    if (campaigns.length === 0 || campaignId && !campaigns.some(c => c.campaignId === campaignId)) throw new DiscoveryError(404, "not_found_or_forbidden");
    return { ...grant, campaigns };
  }
  return {
    async check(identity: ProbeIdentity) { await database.transaction(tx => authorize(tx, identity, "discovery:read")); },
    async actor(identity: ProbeIdentity): Promise<DiscoveryActor> {
      const grant = await database.transaction(tx => authorize(tx, identity, "discovery:read"));
      return { userId: grant.userId, organizationId: grant.organizationId, role: grant.role, principalId: grant.id, executionSource: grant.source, environmentSha256: discoveryEnvironmentHash(config), campaignIds: grant.campaigns.map(c => c.campaignId),
        reauthorize: async (tx, campaignId, scope) => { await authorize(tx, identity, scope, campaignId, "approvalKind" in grant ? grant.id : undefined); },
      };
    },
  };
}

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { organizations, memberships, projects, campaigns, campaignBriefRevisions, discoveryProbeWorkspaces, discoveryProbeGrants, auditEvents, users, type BriefSnapshot } from "../db/schema";
const setupInput = z.strictObject({ userId: z.uuid(), issuer: z.url().max(500), subject: z.string().min(1).max(255), scopes: z.array(z.enum(["discovery:read", "discovery:probe"])).min(1), expiresAt: z.date() });
// Operator/CLI only. Always create a new synthetic organization, never enroll an existing one.
export async function provisionProbeSandbox(input: z.infer<typeof setupInput>) {
  const data = setupInput.parse(input);
  if (data.expiresAt <= new Date() || data.expiresAt.getTime() > Date.now() + 24 * 60 * 60_000) throw new Error("Probe grants must expire within 24 hours");
  const issuer = new URL(data.issuer);
  if (issuer.username || issuer.password || issuer.search || issuer.hash || !(issuer.protocol === "https:" || process.env.NODE_ENV !== "production" && issuer.protocol === "http:" && issuer.hostname === "127.0.0.1")) throw new Error("Invalid issuer");
  return db.transaction(async tx => {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, data.userId));
    if (!user) throw new Error("Existing staff user required");
    const [org] = await tx.insert(organizations).values({ name: `[TEST ONLY] MCP Probe ${randomUUID()}` }).returning();
    await tx.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "manager" });
    const [project] = await tx.insert(projects).values({ organizationId: org.id, name: "[TEST ONLY] Synthetic MCP Sandbox", summary: "Synthetic nonce probe only. No SNS discovery.", createdBy: user.id, updatedBy: user.id }).returning();
    const snapshot: BriefSnapshot = { version: 1, capturedAt: new Date().toISOString(), project: { id: project.id, name: project.name, summary: project.summary, website: "", usp: "", brandStyle: "", referenceUrls: [] }, products: [], assets: [] };
    const [campaign] = await tx.insert(campaigns).values({ organizationId: org.id, projectId: project.id, title: "[TEST ONLY] MCP Probe", countryCodes: ["JP"], platforms: ["tiktok"], categories: ["synthetic-test"], followerMin: 0, followerMax: 1, goalCount: 1, briefSnapshot: snapshot, createdBy: user.id, updatedBy: user.id }).returning();
    await tx.insert(campaignBriefRevisions).values({ organizationId: org.id, projectId: project.id, campaignId: campaign.id, version: 1, snapshot, createdBy: user.id });
    await tx.insert(discoveryProbeWorkspaces).values({ organizationId: org.id, projectId: project.id, campaignId: campaign.id, createdBy: user.id });
    const [grant] = await tx.insert(discoveryProbeGrants).values({ organizationId: org.id, userId: user.id, issuer: issuer.href, subject: data.subject, scopes: [...new Set(data.scopes)], expiresAt: data.expiresAt, createdBy: user.id }).returning();
    await tx.insert(auditEvents).values({ organizationId: org.id, actorId: user.id, entityId: grant.id, action: "discovery.probe_grant_provisioned" });
    return { organization_id: org.id, project_id: project.id, campaign_id: campaign.id, grant_id: grant.id, actor_id: user.id, expires_at: grant.expiresAt.toISOString() };
  });
}

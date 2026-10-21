import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../src/lib/db";
import { organizations, users, memberships, projects, products, projectAssets, projectAssetVersions, assetUploads, campaigns, campaignProducts, auditEvents } from "../../src/lib/db/schema";
import type { ActorScope } from "../../src/lib/auth/permissions";
export async function withWorkspace(run: (actor: ActorScope, other: ActorScope) => Promise<void>) {
  const key = randomUUID();
  const [user] = await db.insert(users).values({ email: `${key}@example.invalid`, name: "Synthetic test operator", passwordHash: "no-login-test-user" }).returning();
  const orgs = await db.insert(organizations).values([{ name: `TEST-A-${key}` }, { name: `TEST-B-${key}` }]).returning();
  await db.insert(memberships).values(orgs.map(org => ({ organizationId: org.id, userId: user.id, role: "admin" as const })));
  try { await run({ userId: user.id, organizationId: orgs[0].id, role: "admin" }, { userId: user.id, organizationId: orgs[1].id, role: "manager" }); }
  finally {
    // Remove only this test's synthetic namespace, never shared development data.
    for (const org of orgs) {
      await db.delete(auditEvents).where(eq(auditEvents.organizationId, org.id));
      await db.delete(campaignProducts).where(eq(campaignProducts.organizationId, org.id));
      await db.delete(campaigns).where(eq(campaigns.organizationId, org.id));
      await db.delete(assetUploads).where(eq(assetUploads.organizationId, org.id));
      await db.delete(projectAssetVersions).where(eq(projectAssetVersions.organizationId, org.id));
      await db.delete(projectAssets).where(eq(projectAssets.organizationId, org.id));
      await db.delete(products).where(eq(products.organizationId, org.id));
      await db.delete(projects).where(eq(projects.organizationId, org.id));
      await db.delete(memberships).where(eq(memberships.organizationId, org.id));
      await db.delete(organizations).where(eq(organizations.id, org.id));
    }
    await db.delete(users).where(eq(users.id, user.id));
  }
}

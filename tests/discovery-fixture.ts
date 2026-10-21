import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "../src/lib/db/schema";
import type { ActorScope } from "../src/lib/auth/permissions";
const createDatabase = (pool: Pool) => drizzle(pool, { schema });

export async function withDiscoveryDatabase<T>(run: (context: Awaited<ReturnType<typeof initializeDiscoveryFixture>>) => Promise<T>) {
  const url = new URL(process.env.DATABASE_URL!);
  const name = `eruty_discovery_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: url.href }); await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const client = new Client({ connectionString: url.href });
  const pool = new Pool({ connectionString: url.href, max: 8 });
  try { await client.connect(); return await run(await initializeDiscoveryFixture(createDatabase(pool), client)); }
  finally {
    await pool.end();
    await client.end();
    if (!/^eruty_discovery_test_[a-f0-9]{32}$/.test(name)) throw new Error("Invalid disposable database name");
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end();
  }
}
export async function initializeDiscoveryFixture(database: ReturnType<typeof createDatabase>, client: Client) {
  await migrate(database, { migrationsFolder: "drizzle" });
  const [user, otherUser, reviewer] = await database.insert(schema.users).values(["operator", "other", "reviewer"].map(name => ({ email: `${randomUUID()}@example.invalid`, name: `Synthetic ${name}`, passwordHash: "disabled-synthetic-fixture" }))).returning();
  const [org, otherOrg] = await database.insert(schema.organizations).values([{ name: "SYNTHETIC discovery A" }, { name: "SYNTHETIC discovery B" }]).returning();
  await database.insert(schema.memberships).values([{ organizationId: org.id, userId: user.id, role: "admin" }, { organizationId: otherOrg.id, userId: otherUser.id, role: "admin" }, { organizationId: org.id, userId: reviewer.id, role: "reviewer" }]);
  const actor: ActorScope = { userId: user.id, organizationId: org.id, role: "admin" };
  const other: ActorScope = { userId: otherUser.id, organizationId: otherOrg.id, role: "admin" };
  const reader: ActorScope = { userId: reviewer.id, organizationId: org.id, role: "reviewer" };
  async function campaign(owner = actor) {
    return database.transaction(async tx => {
    const [project] = await tx.insert(schema.projects).values({ organizationId: owner.organizationId, name: "SYNTHETIC discovery project", createdBy: owner.userId, updatedBy: owner.userId }).returning();
    const snapshot: schema.BriefSnapshot = { version: 1, capturedAt: new Date().toISOString(), project: { id: project.id, name: project.name, summary: "Synthetic fixture. No actual creator.", website: "", usp: "", brandStyle: "", referenceUrls: [] }, products: [], assets: [] };
    const [campaign] = await tx.insert(schema.campaigns).values({ organizationId: owner.organizationId, projectId: project.id, title: "SYNTHETIC discovery campaign", countryCodes: ["JP"], platforms: ["instagram", "tiktok", "youtube"], categories: ["synthetic"], followerMin: 10000, followerMax: 100000, goalCount: 5, briefSnapshot: snapshot, createdBy: owner.userId, updatedBy: owner.userId }).returning();
    await tx.insert(schema.campaignBriefRevisions).values({ organizationId: owner.organizationId, projectId: project.id, campaignId: campaign.id, version: 1, snapshot, createdBy: owner.userId });
    return campaign;
    });
  }
  return { database, client, actor, other, reader, campaign };
}
export const sqlFailure = (code: string) => (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === code) return true;
  return "cause" in error && sqlFailure(code)(error.cause);
};

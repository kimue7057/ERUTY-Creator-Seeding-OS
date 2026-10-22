import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { provisionProbeSandbox } from "./provision";

export const STAGING_ROLES = { runtime: "eruty_probe_runtime", verifier: "eruty_probe_verifier" } as const;
export function assertStagingDatabase(url: string) {
  const parsed = new URL(url);
  if (!/^eruty_probe_[a-z0-9_]+$/.test(parsed.pathname.slice(1))) throw new Error("A dedicated eruty_probe_* database is required");
  return parsed.pathname.slice(1);
}
// Operator only: requires a NEW empty dedicated database and role creation privileges.
// No seed of normal organizations; no writes to an existing application database.
export async function initializeProbeStaging(input: {
  databaseUrl: string; issuer: string; subject: string; runtimePassword: string; verifierPassword: string; confirmation: string;
}) {
  const databaseName = assertStagingDatabase(input.databaseUrl);
  if (input.confirmation !== "initialize-empty-synthetic-probe-database") throw new Error("Explicit staging initialization confirmation required");
  for (const password of [input.runtimePassword, input.verifierPassword]) if (!/^[a-f0-9]{64}$/.test(password)) throw new Error("Generated 256-bit staging passwords required");
  if (input.runtimePassword === input.verifierPassword) throw new Error("Separate database credentials required");
  z.string().min(1).max(255).refine(s => !s.includes("REPLACE_")).parse(input.subject);
  const owner = new Client({ connectionString: input.databaseUrl }); await owner.connect();
  try {
    await owner.query("select pg_advisory_lock(418704, 1)");
    const { rows: tables } = await owner.query("select tablename from pg_tables where schemaname = 'public'");
    if (tables.length) throw new Error("Staging bootstrap refuses an existing public schema");
    const roles = await owner.query("select rolname from pg_roles where rolname = any($1)", [Object.values(STAGING_ROLES)]);
    if (roles.rowCount) throw new Error("Staging roles already exist; use a dedicated cluster and do not replace credentials");
    const database = drizzle(owner, { schema });
    await migrate(database, { migrationsFolder: "drizzle" });
    const result = await database.transaction(async tx => {
      const [user] = await tx.insert(schema.users).values({ email: `${randomUUID()}@example.invalid`, name: "Synthetic staging operator (CLI only)", passwordHash: "disabled-no-password-login" }).returning();
      const sandbox = await provisionProbeSandbox({ userId: user.id, issuer: input.issuer, subject: input.subject, scopes: ["discovery:read", "discovery:probe"], expiresAt: new Date(Date.now() + 3600_000) }, tx);
      // Passwords are constrained to hex; never include SQL or errors in logs.
      for (const [kind, role] of Object.entries(STAGING_ROLES)) {
        const password = kind === "runtime" ? input.runtimePassword : input.verifierPassword;
        await tx.execute(sql.raw(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8`));
        await tx.execute(sql.raw(`GRANT CONNECT ON DATABASE "${databaseName}" TO ${role}`));
        await tx.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${role}`));
        await tx.execute(sql.raw(`ALTER ROLE ${role} IN DATABASE "${databaseName}" SET statement_timeout = '5s'`));
        await tx.execute(sql.raw(`ALTER ROLE ${role} IN DATABASE "${databaseName}" SET lock_timeout = '3s'`));
      }
      await tx.execute(sql.raw(`REVOKE ALL ON DATABASE "${databaseName}" FROM PUBLIC`));
      await tx.execute(sql`REVOKE ALL ON SCHEMA public FROM PUBLIC`);
      await tx.execute(sql`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC`);
      await tx.execute(sql`GRANT SELECT ON discovery_probe_grants, discovery_probe_workspaces, organization_memberships, discovery_probes TO eruty_probe_runtime`);
      // SELECT ... FOR SHARE requires UPDATE on at least one column. Authorization fields stay protected.
      await tx.execute(sql`GRANT UPDATE (updated_at) ON discovery_probe_grants, discovery_probe_workspaces, organization_memberships TO eruty_probe_runtime`);
      await tx.execute(sql`GRANT INSERT ON discovery_probes, audit_events TO eruty_probe_runtime`);
      await tx.execute(sql`GRANT SELECT ON discovery_probes, discovery_probe_grants, discovery_probe_workspaces, organization_memberships, audit_events TO eruty_probe_verifier`);
      return { ...sandbox, operator_email: user.email, database_name: databaseName, grant_lifetime_seconds: 3600, work_connection: "unverified" };
    });
    return result;
  } finally { await owner.end(); }
}

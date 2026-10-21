import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/lib/db";
import { users } from "../src/lib/db/schema";
import { provisionProbeSandbox } from "../src/lib/probe/provision";
try {
  if (process.env.MCP_PROBE_SETUP_CONFIRM !== "create-new-synthetic-organization") throw new Error("Explicit synthetic setup confirmation required");
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, process.env.MCP_PROBE_USER_EMAIL?.toLowerCase() ?? ""));
  if (!user) throw new Error("Existing staff user required");
  const result = await provisionProbeSandbox({ userId: user.id, issuer: process.env.MCP_OAUTH_ISSUER!, subject: process.env.MCP_PROBE_SUBJECT!, scopes: ["discovery:read", "discovery:probe"], expiresAt: new Date(Date.now() + 60 * 60_000) });
  console.log(JSON.stringify(result));
} catch { console.error("Probe sandbox not provisioned. Check synthetic setup inputs; no credentials are printed."); process.exitCode = 1; }
finally { await pool.end(); }

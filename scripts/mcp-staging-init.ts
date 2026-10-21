import "dotenv/config";
import { initializeProbeStaging } from "../src/lib/probe/staging";
import { pool } from "../src/lib/db";
try {
  const result = await initializeProbeStaging({ databaseUrl: process.env.DATABASE_URL!, issuer: process.env.MCP_OAUTH_ISSUER!, subject: process.env.MCP_PROBE_SUBJECT!, runtimePassword: process.env.MCP_RUNTIME_PASSWORD!, verifierPassword: process.env.MCP_VERIFIER_PASSWORD!, confirmation: process.env.MCP_STAGING_INIT_CONFIRM! });
  console.log(JSON.stringify(result));
} catch { console.error("Staging initialization failed. Requires a fresh dedicated eruty_probe_* database, unused roles, synthetic subject and explicit confirmation. Review locally; no credentials are printed."); process.exitCode = 1; }
finally { await pool.end(); }

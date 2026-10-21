import "dotenv/config";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { z } from "zod";
import { verifyProbeProof } from "../src/lib/probe/proof";
const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  const evidence = readFileSync(process.env.MCP_PROOF_FILE!, "utf8");
  if (evidence.length > 32_768) throw new Error("Oversized proof file");
  await client.connect();
  await client.query("begin read only");
  await client.query("set local statement_timeout='5s'");
  const result = await verifyProbeProof(client, JSON.parse(evidence), { organizationId: z.uuid().parse(process.env.MCP_PROBE_ORGANIZATION_ID), grantId: z.uuid().parse(process.env.MCP_PROBE_GRANT_ID), build: process.env.MCP_BUILD_SHA!, closed: process.argv.includes("--closed") });
  await client.query("commit");
  console.log(JSON.stringify(result));
} catch { console.error("Staging proof failed. Check the three real tool outputs, expected scope/build, write/read audits and read-only DB credential; --closed additionally requires audited revocation and no active grants. Work trace must be reviewed independently."); process.exitCode = 1; }
finally { await client.end().catch(() => {}); }

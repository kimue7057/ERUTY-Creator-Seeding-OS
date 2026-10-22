import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";
import { z } from "zod";
const folder = ".local/mcp-staging";
mkdirSync(folder, { recursive: true, mode: 0o700 });
if (process.argv.includes("--sandbox")) {
  const data = z.object({ organization_id: z.uuid(), grant_id: z.uuid(), operator_email: z.email().endsWith("@example.invalid") }).parse(JSON.parse(readFileSync(`${folder}/sandbox.json`, "utf8")));
  const filename = `${folder}/.env`; const current = readFileSync(filename, "utf8");
  const env = parse(current);
  if (env.MCP_PROBE_ORGANIZATION_ID && env.MCP_PROBE_ORGANIZATION_ID !== data.organization_id) throw new Error("Refusing to replace sandbox identity");
  writeFileSync(filename, current.replace(/^MCP_PROBE_ORGANIZATION_ID=.*$/m, `MCP_PROBE_ORGANIZATION_ID=${data.organization_id}`) + `\nMCP_PROBE_GRANT_ID=${data.grant_id}\nMCP_PROBE_USER_EMAIL=${data.operator_email}\n`, { mode: 0o600 });
  console.log("Synthetic sandbox IDs configured locally. No connection or deployment performed.");
} else {
  const content = readFileSync("staging/probe/staging.env.example", "utf8")
    .replace("GENERATE_OWNER_PASSWORD", randomBytes(32).toString("hex"))
    .replace("GENERATE_RUNTIME_PASSWORD", randomBytes(32).toString("hex"))
    .replace("GENERATE_VERIFIER_PASSWORD", randomBytes(32).toString("hex"))
    + `\nMCP_OPERATOR_UID=${process.getuid?.() ?? 1000}\nMCP_OPERATOR_GID=${process.getgid?.() ?? 1000}\n`;
  writeFileSync(`${folder}/.env`, content, { mode: 0o600, flag: "wx" });
  console.log("Created ignored .local/mcp-staging/.env with separate random credentials. Edit approved OAuth/URL/subject/build inputs locally. No services started.");
}

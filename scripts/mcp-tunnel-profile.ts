import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { parse } from "dotenv";
import { persistentOAuthRouting } from "./lib/tunnel-profile";
try {
  const mode = process.argv[2];
  if (mode !== "probe" && mode !== "discovery") throw new Error("Select probe or discovery");
  const directory = mode === "discovery" ? ".local/discovery" : ".local/mcp-local-e2e";
  const connection = JSON.parse(readFileSync(`${directory}/connection.json`, "utf8"));
  const env = parse(readFileSync(mode === "discovery" ? `${directory}/operator.env` : ".local/mcp-staging/.env", "utf8"));
  const path = `${directory}/profiles/${connection.profile}.yaml`;
  // Our generated profiles are JSON (valid YAML). Refuse to rewrite an unfamiliar YAML file.
  const before = readFileSync(path, "utf8");
  const updated = persistentOAuthRouting(JSON.parse(before), connection.tunnel_id, connection.target, env.MCP_OAUTH_ISSUER);
  const after = JSON.stringify(updated, null, 2) + "\n";
  if (JSON.stringify(JSON.parse(before)) !== JSON.stringify(updated)) {
    copyFileSync(path, `${path}.before-routing-${Date.now()}`);
    writeFileSync(path, after, { mode: 0o600 });
  }
  console.log(JSON.stringify({ mode, profile: connection.profile, issuer_origin: new URL(env.MCP_OAUTH_ISSUER).origin, routing: "persisted", credentials_printed: false }));
} catch { console.error("Tunnel profile validation failed. Existing identity, target and secrets must be preserved; inspect the private profile and issuer configuration."); process.exitCode = 1; }

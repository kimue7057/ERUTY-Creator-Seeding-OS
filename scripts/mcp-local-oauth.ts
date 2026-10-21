import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { parse } from "dotenv";
import { LOCAL_WORK_CLIENT, localOAuthOrigin, localProbeRealm, workCallback } from "./lib/local-probe-oauth";

// This directory must first be protected by mcp-local-access.ps1 Collect on Windows.
const folder = ".local/mcp-local-e2e";
const envFile = `${folder}/oauth.env`;
const action = process.argv[2];
async function localAdmin() {
  const env = parse(readFileSync(envFile, "utf8"));
  const response = await fetch("http://127.0.0.1:3380/realms/master/protocol/openid-connect/token", { method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: "eruty-local-bootstrap", password: env.OAUTH_ADMIN_PASSWORD }), signal: AbortSignal.timeout(10000), redirect: "error" });
  if (!response.ok) throw new Error("Local bootstrap admin failed");
  const { access_token: token } = await response.json();
  if (typeof token !== "string" || token.length > 16384) throw new Error("Unexpected admin response");
  return { Authorization: `Bearer ${token}` };
}
async function localClient(headers: Record<string, string>) {
  const endpoint = "http://127.0.0.1:3380/admin/realms/eruty-probe/clients";
  const response = await fetch(`${endpoint}?clientId=${LOCAL_WORK_CLIENT}`, { headers, signal: AbortSignal.timeout(10000), redirect: "error" });
  if (!response.ok) throw new Error("Local client lookup failed");
  const clients = await response.json();
  if (clients.length !== 1 || clients[0].clientId !== LOCAL_WORK_CLIENT || !/^[a-f0-9-]{36}$/.test(clients[0].id)) throw new Error("Unexpected client");
  return { endpoint: `${endpoint}/${clients[0].id}`, client: clients[0] };
}
try {
  if (!existsSync(`${folder}/runtime-key.dpapi`)) throw new Error("Collect private Windows credentials first");
  if (action === "prepare") {
    const origin = localOAuthOrigin(JSON.parse(readFileSync(`${folder}/oauth-origin.json`, "utf8")).origin);
    if (existsSync(envFile)) throw new Error("Refusing to replace an existing IdP identity");
    const subject = randomUUID();
    const userPassword = randomBytes(24).toString("base64url");
    const realm = localProbeRealm(subject, userPassword, "https://eruty-probe.local/mcp");
    mkdirSync(`${folder}/realm-import`, { recursive: true, mode: 0o700 });
    writeFileSync(`${folder}/realm-import/eruty-probe.json`, JSON.stringify(realm), { flag: "wx", mode: 0o600 });
    writeFileSync(envFile, `OAUTH_PUBLIC_ORIGIN=${origin}\nOAUTH_PUBLIC_HOST=${new URL(origin).host}\nOAUTH_DB_PASSWORD=${randomBytes(32).toString("hex")}\nOAUTH_ADMIN_PASSWORD=${randomBytes(32).toString("hex")}\n`, { flag: "wx", mode: 0o600 });
    writeFileSync(`${folder}/oauth-user.json`, JSON.stringify({ subject, username: "eruty-probe-user", password: userPassword }), { flag: "wx", mode: 0o600 });
    const mcpFile = ".local/mcp-staging/.env";
    let mcp = readFileSync(mcpFile, "utf8");
    for (const [key, value] of Object.entries({ MCP_OAUTH_ISSUER: `${origin}/realms/eruty-probe`, MCP_OAUTH_JWKS_URL: `${origin}/realms/eruty-probe/protocol/openid-connect/certs`, MCP_OAUTH_METADATA_URL: `${origin}/realms/eruty-probe/.well-known/openid-configuration`, MCP_PROBE_SUBJECT: subject })) {
      const line = new RegExp(`^${key}=.*$`, "m");
      mcp = line.test(mcp) ? mcp.replace(line, `${key}=${value}`) : `${mcp}\n${key}=${value}\n`;
    }
    writeFileSync(mcpFile, mcp, { mode: 0o600 });
    console.log(JSON.stringify({ prepared: "synthetic_local_idp", client_id: LOCAL_WORK_CLIENT, callback: "not_configured", work_connection: "unverified" }));
  } else if (action === "callback") {
    const callback = workCallback(readFileSync(`${folder}/work-callback.txt`, "utf8"));
    const headers = await localAdmin();
    const { endpoint, client } = await localClient(headers);
    const update = await fetch(endpoint, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ ...client, redirectUris: [callback] }), signal: AbortSignal.timeout(10000), redirect: "error" });
    if (!update.ok) throw new Error("Local callback update failed");
    const checked = await localClient(headers);
    if (checked.client.redirectUris.length !== 1 || checked.client.redirectUris[0] !== callback) throw new Error("Callback read-back mismatch");
    console.log(JSON.stringify({ callback_allowlisted: true, client_id: LOCAL_WORK_CLIENT, work_connection: "unverified" }));
  } else if (action === "inspect") {
    const headers = await localAdmin();
    const { client } = await localClient(headers);
    const expected = JSON.parse(readFileSync(`${folder}/oauth-user.json`, "utf8"));
    const response = await fetch("http://127.0.0.1:3380/admin/realms/eruty-probe/users?username=eruty-probe-user&exact=true", { headers, signal: AbortSignal.timeout(10000), redirect: "error" });
    if (!response.ok) throw new Error("Subject lookup failed");
    const users = await response.json();
    if (users.length !== 1 || users[0].id !== expected.subject || !users[0].enabled) throw new Error("Subject mismatch");
    if (!client.publicClient || !client.standardFlowEnabled || client.implicitFlowEnabled || client.directAccessGrantsEnabled || client.serviceAccountsEnabled || !client.consentRequired || client.attributes["pkce.code.challenge.method"] !== "S256") throw new Error("Unsafe test client");
    console.log(JSON.stringify({ synthetic_subject_read_back: true, public_client: true, required_pkce: "S256", consent: true, callback_count: client.redirectUris.length, work_connection: "unverified" }));
  } else throw new Error("Use prepare, callback or inspect");
} catch {
  console.error("Local OAuth setup failed. Inspect local inputs, private directory permissions and service state; no secrets/provider bodies are printed.");
  process.exitCode = 1;
}

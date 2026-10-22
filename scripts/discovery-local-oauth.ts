import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";
import { workCallback } from "./lib/local-probe-oauth";
const folder = ".local/discovery", base = "http://127.0.0.1:3380/admin/realms/eruty-probe";
const clientId = "eruty-work-discovery", resourceClientId = "eruty-discovery-resource";
async function request(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Keycloak operator request failed");
  return response;
}
try {
  const config = parse(readFileSync(`${folder}/operator.env`, "utf8"));
  const oauth = parse(readFileSync(".local/mcp-local-e2e/oauth.env", "utf8"));
  const token = await (await request("http://127.0.0.1:3380/realms/master/protocol/openid-connect/token", { method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: "eruty-local-bootstrap", password: oauth.OAUTH_ADMIN_PASSWORD }) })).json();
  const headers = { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" };
  const getClients = async (id: string) => (await request(`${base}/clients?clientId=${id}`, { headers })).json() as Promise<{ id: string; clientId: string; redirectUris: string[]; publicClient: boolean; standardFlowEnabled: boolean; consentRequired: boolean; directAccessGrantsEnabled: boolean; implicitFlowEnabled: boolean; serviceAccountsEnabled: boolean; attributes: Record<string, string> }[]>;
  const action = process.argv[2];
  if (action === "prepare") {
    if (existsSync(`${folder}/oauth-client-receipt.json`) || (await getClients(clientId)).length || (await getClients(resourceClientId)).length) throw new Error("Preserve the existing Discovery OAuth client; do not overwrite it");
    const scopes: { id: string; name: string }[] = await (await request(`${base}/client-scopes`, { headers })).json();
    for (const name of ["discovery:observe", "discovery:submit"]) if (!scopes.some(scope => scope.name === name)) await request(`${base}/client-scopes`, { method: "POST", headers, body: JSON.stringify({ name, protocol: "openid-connect", attributes: { "include.in.token.scope": "true", "display.on.consent.screen": "true", "consent.screen.text": name === "discovery:observe" ? "Record campaign-scoped SNS observations for staff review" : "Submit campaign discovery runs for staff review" } }) });
    await request(`${base}/clients`, { method: "POST", headers, body: JSON.stringify({ clientId: resourceClientId, protocol: "openid-connect", bearerOnly: true, attributes: { resource_url: config.MCP_RESOURCE_URL } }) });
    await request(`${base}/clients`, { method: "POST", headers, body: JSON.stringify({ clientId, name: "ERUTY Discovery local validation", protocol: "openid-connect", publicClient: true, standardFlowEnabled: true, implicitFlowEnabled: false, directAccessGrantsEnabled: false, serviceAccountsEnabled: false, consentRequired: true, redirectUris: [], webOrigins: [], fullScopeAllowed: false, defaultClientScopes: [], optionalClientScopes: ["discovery:read", "discovery:observe", "discovery:submit", "offline_access"], attributes: { "pkce.code.challenge.method": "S256", "access.token.lifespan": "300", "client.offline.session.idle.timeout": "3600", "client.offline.session.max.lifespan": "3600" }, protocolMappers: [
      { name: "ERUTY required subject", protocol: "openid-connect", protocolMapper: "oidc-sub-mapper", consentRequired: false, config: { "access.token.claim": "true", "introspection.token.claim": "true", "lightweight.claim": "true" } },
      { name: "Discovery resource audience", protocol: "openid-connect", protocolMapper: "oidc-audience-mapper", consentRequired: false, config: { "included.custom.audience": config.MCP_RESOURCE_URL, "access.token.claim": "true", "id.token.claim": "false", "userinfo.token.claim": "false" } },
    ] }) });
    writeFileSync(`${folder}/oauth-client-receipt.json`, JSON.stringify({ client_id: clientId, resource: config.MCP_RESOURCE_URL, issuer: config.MCP_OAUTH_ISSUER, callback: "not_configured", existing_probe_client_unchanged: true, work_connection: "unverified" }), { flag: "wx", mode: 0o600 });
    console.log("Dedicated public Discovery OAuth client created in the existing test realm. Probe client/user/issuer unchanged; exact ChatGPT callback still required.");
  } else if (action === "callback") {
    const callback = workCallback(readFileSync(`${folder}/work-callback.txt`, "utf8"));
    const clients = await getClients(clientId); if (clients.length !== 1) throw new Error("Unexpected Discovery client");
    const client = clients[0];
    if (client.redirectUris.length && !client.redirectUris.includes(callback)) throw new Error("Existing callback differs; preserve it for explicit operator review");
    await request(`${base}/clients/${client.id}`, { method: "PUT", headers, body: JSON.stringify({ ...client, redirectUris: [callback] }) });
    const checked = (await getClients(clientId))[0];
    if (checked.redirectUris.length !== 1 || checked.redirectUris[0] !== callback) throw new Error("Callback read-back mismatch");
    console.log("Exact Discovery ChatGPT callback registered and re-read. Hosted OAuth login remains pending.");
  } else if (action !== "inspect") throw new Error("Use prepare, callback or inspect");
  const clients = await getClients(clientId); if (clients.length !== 1) throw new Error("Discovery client missing");
  const client = clients[0], discovery = await (await request(`${config.MCP_OAUTH_ISSUER}/.well-known/openid-configuration`)).json();
  const scopes: { name: string }[] = await (await request(`${base}/clients/${client.id}/optional-client-scopes`, { headers })).json();
  if (!client.publicClient || !client.standardFlowEnabled || !client.consentRequired || client.directAccessGrantsEnabled || client.implicitFlowEnabled || client.serviceAccountsEnabled || client.attributes["pkce.code.challenge.method"] !== "S256" || !["discovery:read", "discovery:observe", "discovery:submit", "offline_access"].every(name => scopes.some(scope => scope.name === name)) || discovery.issuer !== config.MCP_OAUTH_ISSUER || !discovery.code_challenge_methods_supported.includes("S256") || !discovery.token_endpoint_auth_methods_supported.includes("none")) throw new Error("Discovery OAuth contract mismatch");
  console.log(JSON.stringify({ client_id: clientId, issuer: discovery.issuer, public_client: true, pkce: "S256", token_endpoint_auth: "none", callback_count: client.redirectUris.length, access_token_seconds: 300, scopes: scopes.map(scope => scope.name), hosted_Work: "unverified" }));
} catch { console.error("Discovery OAuth action failed. Preserve the existing IdP/Probe settings; inspect private inputs and the selected stage locally. No credentials printed."); process.exitCode = 1; }

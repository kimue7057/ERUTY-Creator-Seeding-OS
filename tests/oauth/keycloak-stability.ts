// Dedicated synthetic realm only. Never logs tokens/cookies/provider bodies or changes existing clients/users.
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { probeAuthenticator } from "../../src/lib/probe/auth";
import { privateError } from "../../src/lib/probe/diagnostics";
const base = process.env.KEYCLOAK_STABILITY_BASE ?? "http://127.0.0.1:3380";
const origin = new URL(base);
if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.pathname !== "/" || origin.username || origin.password || origin.search || origin.hash) throw new Error("Use the isolated loopback test IdP");
const realm = `eruty-stability-${randomUUID()}`, name = "synthetic-stability-user", password = randomBytes(24).toString("base64url");
const resource = "https://stability.example.invalid/mcp", redirect = "http://127.0.0.1:3389/callback", clientId = "stability-pkce";
let headers: Record<string, string> = {}, created = false;
async function request(path: string, options: RequestInit = {}) {
  const r = await fetch(base + path, { ...options, redirect: "manual", signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Synthetic IdP setup HTTP ${r.status}`);
  return r;
}
try {
  const admin = await (await request("/realms/master/protocol/openid-connect/token", { method: "POST", body: new URLSearchParams({ client_id: "admin-cli", grant_type: "password", username: process.env.KEYCLOAK_STABILITY_ADMIN ?? "eruty-local-bootstrap", password: process.env.KEYCLOAK_STABILITY_PASSWORD ?? "" }) })).json();
  headers = { Authorization: `Bearer ${admin.access_token}`, "Content-Type": "application/json" };
  await request("/admin/realms", { method: "POST", headers, body: JSON.stringify({ realm, enabled: true, sslRequired: "none", attributes: { frontendUrl: base }, registrationAllowed: false, accessTokenLifespan: 5, revokeRefreshToken: true, refreshTokenMaxReuse: 0, offlineSessionIdleTimeout: 120, offlineSessionMaxLifespanEnabled: true, offlineSessionMaxLifespan: 120 }) }); created = true;
  const api = `/admin/realms/${realm}`;
  await request(api + "/clients", { method: "POST", headers, body: JSON.stringify({ clientId: "synthetic-resource", protocol: "openid-connect", bearerOnly: true, attributes: { resource_url: resource } }) });
  await request(api + "/client-scopes", { method: "POST", headers, body: JSON.stringify({ name: "discovery:read", protocol: "openid-connect", attributes: { "include.in.token.scope": "true" } }) });
  await request(api + "/clients", { method: "POST", headers, body: JSON.stringify({ clientId, protocol: "openid-connect", publicClient: true, standardFlowEnabled: true, directAccessGrantsEnabled: false, implicitFlowEnabled: false, serviceAccountsEnabled: false, consentRequired: false, redirectUris: [redirect], fullScopeAllowed: false, defaultClientScopes: [], optionalClientScopes: ["offline_access", "discovery:read"], attributes: { "pkce.code.challenge.method": "S256", "access.token.lifespan": "5" }, protocolMappers: [
    { name: "subject", protocol: "openid-connect", protocolMapper: "oidc-sub-mapper", config: { "access.token.claim": "true" } },
    { name: "audience", protocol: "openid-connect", protocolMapper: "oidc-audience-mapper", config: { "included.custom.audience": resource, "access.token.claim": "true" } },
  ] }) });
  await request(api + "/users", { method: "POST", headers, body: JSON.stringify({ username: name, enabled: true, email: "synthetic@example.invalid", emailVerified: true, firstName: "Synthetic", lastName: "Fixture", credentials: [{ type: "password", value: password, temporary: false }] }) });
  const users = await (await request(api + `/users?username=${name}&exact=true`, { headers })).json();
  const role = await (await request(api + "/roles/offline_access", { headers })).json();
  await request(api + `/users/${users[0].id}/role-mappings/realm`, { method: "POST", headers, body: JSON.stringify([role]) });
  const issuer = `${base}/realms/${realm}`, endpoint = `/realms/${realm}/protocol/openid-connect`;
  const verifier = randomBytes(32).toString("base64url"), state = randomUUID();
  const params = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirect, scope: "discovery:read offline_access", resource, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state });
  const login = await request(endpoint + "/auth?" + params);
  const html = await login.text();
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html)?.[1] ?? /<form[^>]*action="([^"]+)"[^>]*id="kc-form-login"/.exec(html)?.[1];
  assert.ok(action, "Synthetic login form required");
  const url = new URL(action.replaceAll("&amp;", "&")); assert.equal(url.origin, base);
  const cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const logged = await fetch(url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10000), headers: { Cookie: cookie }, body: new URLSearchParams({ username: name, password, credentialId: "" }) });
  assert.equal(logged.status, 302, "Synthetic PKCE login must redirect");
  const callback = new URL(logged.headers.get("location")!); assert.equal(callback.origin + callback.pathname, redirect); assert.equal(callback.searchParams.get("state"), state); assert.equal(callback.searchParams.get("iss"), issuer);
  const tokens = await (await request(endpoint + "/token", { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code: callback.searchParams.get("code")!, redirect_uri: redirect, code_verifier: verifier, resource }) })).json();
  assert.ok(tokens.refresh_token); assert.ok(tokens.scope.includes("offline_access"));
  const authenticate = probeAuthenticator({ issuer, resource, jwks: issuer + "/protocol/openid-connect/certs" });
  await authenticate(`Bearer ${tokens.access_token}`);
  const offline = await (await request(api + `/users/${users[0].id}/offline-sessions/${(await (await request(api + `/clients?clientId=${clientId}`, { headers })).json())[0].id}`, { headers })).json();
  assert.equal(offline.length, 1);
  await new Promise(resolve => setTimeout(resolve, 6000));
  await assert.rejects(authenticate(`Bearer ${tokens.access_token}`), (e: unknown) => !!e && typeof e === "object" && "code" in e && e.code === "token_expired");
  const refreshed = await (await request(endpoint + "/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token, resource }) })).json();
  assert.notEqual(refreshed.refresh_token, tokens.refresh_token); await authenticate(`Bearer ${refreshed.access_token}`);
  const reused = await fetch(base + endpoint + "/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token, resource }), signal: AbortSignal.timeout(10000) });
  assert.equal(reused.status, 400); assert.equal((await reused.json()).error, "invalid_grant");
  console.log(JSON.stringify({ synthetic_only: true, hosted_work: "not_tested", pkce: "passed", issuer_audience_signature: "passed", offline_session: "passed", expired_access_token: "token_expired", rotated_refresh: "passed", old_refresh_reuse: "invalid_grant", existing_sessions_changed: false }));
} catch (error) { console.error(JSON.stringify({ outcome: "oauth_stability_failed", error: privateError(error) })); process.exitCode = 1; }
finally { if (created) { const r = await fetch(`${base}/admin/realms/${realm}`, { method: "DELETE", headers, signal: AbortSignal.timeout(10000) }); if (!r.ok) { console.error("Synthetic realm cleanup failed; preserve it for inspection."); process.exitCode = 1; } } }

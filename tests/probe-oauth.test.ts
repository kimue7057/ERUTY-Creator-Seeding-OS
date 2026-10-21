import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { probeConfig } from "../src/lib/probe/config";
import { inspectProbeOAuth } from "../src/lib/probe/oauth-preflight";
const config = probeConfig({ NODE_ENV: "production", MCP_RESOURCE_URL: "https://probe.example.invalid/mcp", MCP_OAUTH_ISSUER: "https://auth.example.invalid/", MCP_OAUTH_JWKS_URL: "https://auth.example.invalid/jwks", MCP_PROBE_ORGANIZATION_ID: randomUUID() });
const metadata = { issuer: config.issuer, authorization_endpoint: `${config.issuer}authorize`, token_endpoint: `${config.issuer}token`, jwks_uri: config.jwks, response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["openid"], authorization_response_iss_parameter_supported: true };
const response = (data: unknown): typeof fetch => async (_url, options) => { assert.equal(options?.redirect, "error"); assert.ok(options?.signal); return Response.json(data); };
test("OAuth discovery checks the public PKCE client contract without claiming login, token or Work verification", async () => {
  const result = await inspectProbeOAuth(config, `${config.issuer}.well-known/openid-configuration`, undefined, response(metadata));
  assert.equal(result.metadata_contract, "compatible"); assert.equal(result.token_validation, "not_tested"); assert.equal(result.work_connection, "unverified"); assert.equal(result.login_consent_callback_pkce_exchange, "not_tested");
  // OIDC discovery may list only OIDC scopes, not the custom API's permissions.
  assert.equal(result.api_scopes_advertised, false);
});
test("OAuth preflight rejects issuer/JWKS mismatch, cross-origin endpoints, unsupported PKCE/client mode and oversized metadata", async () => {
  for (const change of [{ issuer: "https://other.invalid/" }, { issuer: config.issuer.slice(0, -1) }, { jwks_uri: `${config.issuer}other` }, { token_endpoint: "https://other.invalid/token" }, { authorization_endpoint: `${config.issuer}authorize?unsafe=1` }, { code_challenge_methods_supported: ["plain"] }, { grant_types_supported: ["client_credentials"] }, { token_endpoint_auth_methods_supported: ["client_secret_post"] }]) {
    await assert.rejects(() => inspectProbeOAuth(config, `${config.issuer}metadata`, undefined, response({ ...metadata, ...change })));
  }
  await assert.rejects(() => inspectProbeOAuth(config, "https://other.invalid/metadata", undefined, response(metadata)));
  await assert.rejects(() => inspectProbeOAuth(config, `${config.issuer}metadata`, undefined, response({ ...metadata, huge: "x".repeat(70_000) })));
});

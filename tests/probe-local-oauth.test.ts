import test from "node:test";
import assert from "node:assert/strict";
import { localOAuthOrigin, localProbeRealm, workCallback } from "../scripts/lib/local-probe-oauth";

test("local IdP restricts the HTTPS origin and exact ChatGPT callback", () => {
  assert.equal(localOAuthOrigin("https://synthetic-test.trycloudflare.com"), "https://synthetic-test.trycloudflare.com");
  for (const value of ["http://synthetic-test.trycloudflare.com", "https://trycloudflare.com.evil.invalid", "https://synthetic-test.trycloudflare.com/path", "https://user:pass@synthetic-test.trycloudflare.com"]) assert.throws(() => localOAuthOrigin(value));
  assert.equal(workCallback("https://chatgpt.com/connector_platform_oauth_redirect"), "https://chatgpt.com/connector_platform_oauth_redirect");
  assert.equal(workCallback("https://chatgpt.com/connector/oauth/callback_123"), "https://chatgpt.com/connector/oauth/callback_123");
  for (const value of ["https://chatgpt.com/connector/oauth/*", "https://chatgpt.com.evil.invalid/connector_platform_oauth_redirect", "https://chatgpt.com/connector/oauth/id?next=evil"]) assert.throws(() => workCallback(value));
});
test("synthetic realm disables alternate login grants and requires S256 with short tokens", () => {
  const realm = localProbeRealm("synthetic-subject", "synthetic-password", "https://eruty-probe.local/mcp");
  const client = realm.clients[1];
  assert.equal(realm.accessTokenLifespan, 300);
  assert.equal(client.directAccessGrantsEnabled, false);
  assert.equal(client.implicitFlowEnabled, false);
  assert.equal(client.serviceAccountsEnabled, false);
  assert.equal(client.consentRequired, true);
  assert.equal(client.attributes["pkce.code.challenge.method"], "S256");
  assert.deepEqual(client.redirectUris, []);
  assert.equal(realm.clients[0].attributes.resource_url, "https://eruty-probe.local/mcp");
});

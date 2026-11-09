import test from "node:test";
import assert from "node:assert/strict";
import { parseInstagramLoginUrl, providerAppInputSchema } from "../src/lib/outreach/app-contracts";
import { authorizationUrl, exchangeCode, fetchIdentity, providerConfig, refreshTokens } from "../src/lib/outreach/providers";
import { OutreachError } from "../src/lib/outreach/contracts";
const uri = "https://example.invalid/api/outreach/oauth/instagram/callback";
const config = providerConfig("instagram", { APP_ORIGIN: "https://example.invalid", OUTREACH_ENCRYPTION_KEY: "a".repeat(64), OUTREACH_INSTAGRAM_CLIENT_ID: "10000", OUTREACH_INSTAGRAM_CLIENT_SECRET: "synthetic-secret", OUTREACH_INSTAGRAM_API_VERSION: "v25.0", OUTREACH_INSTAGRAM_LOGIN_MODE: "unified", OUTREACH_INSTAGRAM_CONFIGURATION_ID: "20000" });
const debug = { app_id: "10000", is_valid: true, type: "SYSTEM_USER", expires_at: 0, scopes: ["instagram_basic", "instagram_manage_messages"] };
function mock(debugData: unknown = debug, accounts: unknown = { data: [{ id: "333", username: "intended_creator" }] }): typeof fetch {
  return async url => {
    const u = new URL(String(url)); assert.equal(u.hostname, "graph.facebook.com");
    if (u.pathname.endsWith("/oauth/access_token")) return Response.json({ access_token: "synthetic-system-token" });
    if (u.pathname.endsWith("/debug_token")) return Response.json({ data: debugData });
    assert.ok(u.pathname.endsWith("/me/assigned_instagram_accounts"));
    return Response.json(accounts);
  };
}
test("Unified URL imports IDs only; generated login uses fresh state and config, never legacy scopes", () => {
  const url = new URL("https://www.facebook.com/dialog/oauth"); url.search = new URLSearchParams({ client_id: "10000", config_id: "20000", redirect_uri: uri, response_type: "code", state: "<STATE>" }).toString();
  assert.deepEqual(parseInstagramLoginUrl(url.href, uri), { clientId: "10000", configurationId: "20000" });
  for (const invalid of [url.href.replace("www.facebook.com", "evil.invalid"), url.href + "&client_id=999", url.href + "&access_token=synthetic", url.href.replace(encodeURIComponent(uri), encodeURIComponent("https://other.invalid"))]) assert.throws(() => parseInstagramLoginUrl(invalid, uri));
  const generated = new URL(authorizationUrl("instagram", "fresh-session-nonce", "verifier", "intended_creator", false, config));
  assert.equal(generated.origin, "https://www.facebook.com"); assert.equal(generated.searchParams.get("config_id"), "20000"); assert.equal(generated.searchParams.get("state"), "fresh-session-nonce"); assert.equal(generated.searchParams.get("override_default_response_type"), "true"); assert.equal(generated.searchParams.has("scope"), false);
  assert.equal(providerAppInputSchema.safeParse({ provider: "instagram", revision: 0, clientId: "10000", clientSecret: "synthetic", version: "v25.0", instagramLoginMode: "unified" }).success, false);
});
test("Unified connection verifies app, token and paginated target; zero expiry is inspected, not inferred", async () => {
  const paths: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const u = new URL(String(url)); paths.push(u.pathname);
    if (!u.pathname.endsWith("assigned_instagram_accounts")) return mock()(url, init);
    assert.match(u.searchParams.get("appsecret_proof")!, /^[a-f0-9]{64}$/);
    if (!u.searchParams.has("after")) return Response.json({ data: [{ id: "111", username: "another_creator" }], paging: { cursors: { after: "second" }, next: "https://evil.invalid/never-follow" } });
    return Response.json({ data: [{ id: "333", username: "intended_creator" }] });
  };
  const account = await exchangeCode("instagram", "synthetic-code", "verifier", fetcher, config, "@intended_creator");
  assert.equal(account.id, "333"); assert.equal(account.tokens.expiresAt, null); assert.equal(account.tokens.tokenKind, "meta_system_user");
  assert.equal(paths.filter(p => p.endsWith("assigned_instagram_accounts")).length, 2);
  assert.equal(await refreshTokens("instagram", account.tokens, fetcher, config), account.tokens);
  assert.equal((await fetchIdentity("instagram", account.tokens, mock(), config)).id, "333");
  await assert.rejects(fetchIdentity("instagram", { ...account.tokens, instagramAccountId: "999" }, mock(), config), (e: unknown) => e instanceof OutreachError && e.code === "instagram_account_not_shared");
});
test("unverified lifetime, wrong app, expired token, missing grants and unshared targets never connect", async () => {
  for (const data of [{ ...debug, expires_at: undefined }, { ...debug, app_id: "999" }, { ...debug, is_valid: false }, { ...debug, type: "USER" }, { ...debug, expires_at: 1 }, { ...debug, data_access_expires_at: 1 }, { ...debug, scopes: [] }]) await assert.rejects(exchangeCode("instagram", "code", "v", mock(data), config, "intended_creator"));
  await assert.rejects(exchangeCode("instagram", "code", "v", mock(debug, { data: [] }), config, "intended_creator"), (e: unknown) => e instanceof OutreachError && e.code === "instagram_no_accounts");
  await assert.rejects(exchangeCode("instagram", "code", "v", mock(debug, { data: [{ id: "1", username: "other" }] }), config, "intended_creator"));
  await assert.rejects(exchangeCode("instagram", "code", "v", mock(debug, { data: [{ id: "333", username: "intended_creator" }], paging: { cursors: { after: "repeated" } } }), config, "intended_creator"));
});

// Loaded only by Playwright's local Next server, never by the application.
// Keep real credentials and requests out of browser tests.
const localHosts = ["127.0.0.1", "localhost"];
if (!localHosts.includes(new URL(process.env.DATABASE_URL).hostname) || !localHosts.includes(new URL(process.env.APP_ORIGIN ?? "http://127.0.0.1:3000").hostname)) {
  throw new Error("Meta browser fixtures require a local test database and app");
}
const originalFetch = globalThis.fetch;
const allowedTokens = new Set(["synthetic-browser-meta-success", "synthetic-browser-meta-other"]);
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname !== "graph.facebook.com") return originalFetch(input, init);
  if (url.pathname.endsWith("/debug_token") && allowedTokens.has(url.searchParams.get("input_token"))) {
    return Response.json({ data: { app_id: "10000", type: "SYSTEM_USER", is_valid: true, expires_at: 0, scopes: ["instagram_basic", "instagram_manage_messages"] } });
  }
  const bearer = new Headers(init?.headers).get("Authorization")?.replace(/^Bearer /, "");
  if (url.pathname.endsWith("/me/assigned_instagram_accounts") && allowedTokens.has(bearer)) {
    return Response.json({ data: [{ id: "333", username: bearer === "synthetic-browser-meta-other" ? "another_company" : "synthetic_company" }] });
  }
  throw new Error("Unexpected Meta request blocked by the browser fixture");
};

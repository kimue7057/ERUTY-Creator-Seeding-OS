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
  if (allowedTokens.has(bearer)) {
    const inbound={id:"synthetic_inbound",created_time:new Date(Date.now()-60000).toISOString(),from:{id:"444",username:"synthetic_recipient"},to:{data:[{id:"333",username:"synthetic_company"}]},message:"SYNTHETIC incoming message"};
    if(url.pathname==="/v27.0/333/conversations")return Response.json({data:[{id:"t_synthetic_browser",updated_time:new Date().toISOString(),messages:{data:[inbound]}}]});
    if(url.pathname==="/v27.0/t_synthetic_browser")return Response.json({id:"t_synthetic_browser",messages:{data:[inbound]}});
    if(url.pathname==="/v27.0/333/messages"&&init?.method==="POST"){
      const data=JSON.parse(init.body);
      if(data.recipient?.id!=="444"||data.message?.text!=="SYNTHETIC browser approved reply")throw new Error("Unexpected recipient or body blocked by fixture");
      return Response.json({recipient_id:"444",message_id:"synthetic_browser_receipt"});
    }
  }
  throw new Error("Unexpected Meta request blocked by the browser fixture");
};

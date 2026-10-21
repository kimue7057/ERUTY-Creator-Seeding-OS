import "dotenv/config";
// Transport-only smoke: no tokens, OAuth login, tool execution or Work success claim.
try {
  const target = new URL(process.env.MCP_SMOKE_URL ?? "http://127.0.0.1:3310/mcp");
  if (target.pathname !== "/mcp" || target.username || target.password || target.search || target.hash || !(target.protocol === "https:" || target.protocol === "http:" && target.hostname === "127.0.0.1")) throw new Error("Unsafe smoke target");
  const options = { redirect: "error" as const, signal: AbortSignal.timeout(5000) };
  const metadata = await fetch(`${target.origin}/.well-known/oauth-protected-resource/mcp`, options);
  if (!metadata.ok) throw new Error("Metadata unreachable");
  const data = await metadata.json();
  if (data.resource !== process.env.MCP_RESOURCE_URL || data.authorization_servers?.[0] !== process.env.MCP_OAUTH_ISSUER) throw new Error("Canonical resource/issuer mismatch");
  const denied = await fetch(target, { ...options, method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  if (denied.status !== 401 || !denied.headers.get("www-authenticate")?.includes(`resource_metadata="${new URL(data.resource).origin}/.well-known/oauth-protected-resource/mcp"`)) throw new Error("Unauthenticated request was not challenged");
  if ((await fetch(`${target.origin}/unconfigured-path`, options)).status !== 404) throw new Error("Unexpected gateway route");
  console.log(JSON.stringify({ metadata: "canonical", unauthenticated_mcp: "denied_401", work_connection: "unverified" }));
} catch { console.error("Staging transport smoke failed. Check private gateway, canonical Host/resource and OAuth challenge."); process.exitCode = 1; }

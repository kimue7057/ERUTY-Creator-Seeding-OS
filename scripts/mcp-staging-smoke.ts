import "dotenv/config";
import { probeOAuthConfig } from "../src/lib/probe/config";
// Transport-only smoke: no tokens, OAuth login, tool execution or Work success claim.
let checkpoint = "configuration";
try {
  const expected = probeOAuthConfig();
  const target = new URL(process.env.MCP_SMOKE_URL ?? "http://127.0.0.1:3310/mcp");
  if (target.pathname !== "/mcp" || target.username || target.password || target.search || target.hash || !(target.protocol === "https:" || target.protocol === "http:" && target.hostname === "127.0.0.1")) throw new Error("Unsafe smoke target");
  const options = { redirect: "error" as const, signal: AbortSignal.timeout(5000) };
  checkpoint = "metadata_fetch";
  const metadata = await fetch(`${target.origin}/.well-known/oauth-protected-resource/mcp`, options);
  if (!metadata.ok) throw new Error("Metadata unreachable");
  const data = await metadata.json();
  checkpoint = "metadata_contract";
  if (data.resource !== expected.resource || data.authorization_servers?.[0] !== expected.issuer) throw new Error("Canonical resource/issuer mismatch");
  checkpoint = "unauthenticated_challenge";
  const denied = await fetch(target, { ...options, method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  if (denied.status !== 401 || !denied.headers.get("www-authenticate")?.includes(`resource_metadata="${new URL(data.resource).origin}/.well-known/oauth-protected-resource/mcp"`)) throw new Error("Unauthenticated request was not challenged");
  checkpoint = "gateway_routing";
  if ((await fetch(`${target.origin}/unconfigured-path`, options)).status !== 404) throw new Error("Unexpected gateway route");
  console.log(JSON.stringify({ metadata: "canonical", unauthenticated_mcp: "denied_401", work_connection: "unverified" }));
} catch { console.error(JSON.stringify({ error: "staging_transport_smoke_failed", checkpoint })); process.exitCode = 1; }

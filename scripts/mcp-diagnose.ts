import "dotenv/config";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { probeConfig } from "../src/lib/probe/config";
import { discoveryMcpConfig, discoveryEnvironmentHash, DISCOVERY_SCOPES } from "../src/lib/discovery/mcp-config";
import { PROBE_SCOPES } from "../src/lib/probe/contracts";
import { inspectProbeOAuth } from "../src/lib/probe/oauth-preflight";
import { privateError } from "../src/lib/probe/diagnostics";
const mode = process.argv[2] ?? "discovery";
if (mode !== "probe" && mode !== "discovery") throw new Error("Select discovery or probe");
const report: Record<string, unknown> = { at: new Date().toISOString(), mode, hosted_work: "not_verified", browser: "not_inspected" };
let failed = false;
async function stage(name: string, action: () => Promise<unknown>) { try { report[name] = { ok: true, result: await action() }; } catch (error) { failed = true; report[name] = { ok: false, error: privateError(error) }; } }
const config = mode === "discovery" ? discoveryMcpConfig() : probeConfig();
await stage("gateway_resource_metadata", async () => {
  const port = mode === "discovery" ? 3311 : 3310;
  const response = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource/mcp`, { signal: AbortSignal.timeout(5000), redirect: "error" });
  const metadata = await response.json();
  if (!response.ok || metadata.resource !== config.resource || metadata.authorization_servers?.[0] !== config.issuer) throw new Error("Resource/issuer metadata mismatch");
  return { resource: config.resource, issuer: config.issuer, scopes: metadata.scopes_supported, build: config.build };
});
await stage("oauth_metadata", () => inspectProbeOAuth(config, `${config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, undefined, fetch, mode === "discovery" ? DISCOVERY_SCOPES : PROBE_SCOPES));
await stage("jwks", async () => {
  const response = await fetch(config.jwks, { signal: AbortSignal.timeout(5000), redirect: "error" });
  const body = await response.json(); if (!response.ok || !Array.isArray(body.keys) || !body.keys.length) throw new Error("JWKS unavailable");
  return { keys: body.keys.length, algorithms: body.keys.map((k: { alg: string }) => k.alg), provider_clock_offset_ms: response.headers.get("date") ? Date.parse(response.headers.get("date")!) - Date.now() : null, signature_validation: "requires_a_valid_user_token" };
});
await stage("tunnel", async () => {
  const alias = mode === "discovery" ? "eruty-discovery-local" : "eruty-probe-local";
  const base = new URL(readFileSync(`${process.env.USERPROFILE ?? process.env.HOME}/.local/state/tunnel-client/health/${alias}.url`, "utf8").trim());
  if (base.protocol !== "http:" || base.hostname !== "127.0.0.1") throw new Error("Expected loopback runtime health");
  const response = await fetch(new URL("/health?details=true", base), { signal: AbortSignal.timeout(3000) });
  const state = await response.json(), c = state.components;
  return { live: state.live, ready: state.ready, snapshot_at: state.snapshot_at, version: state.runtime?.version, dispatcher: c?.dispatcher, oauth: c?.oauth, mcp: c?.mcp, control_plane: { state: c?.["control-plane"]?.state, failures: c?.["control-plane"]?.details?.consecutive_failures }, note: "Readiness and auth_required startup do not prove a hosted tool call reached the server." };
});
if (mode === "discovery" && process.env.MCP_DISCOVERY_VERIFIER_DATABASE_URL) await stage("database_and_grants", async () => {
  const client = new Client({ connectionString: process.env.MCP_DISCOVERY_VERIFIER_DATABASE_URL, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    const time = (await client.query("select now() as utc")).rows[0].utc;
    const rows = (await client.query("select expires_at,revoked_at,environment_sha256,scopes from discovery_mcp_grants where organization_id=$1", [config.organizationId])).rows;
    return { clock_offset_ms: new Date(time).getTime() - Date.now(), environment_sha256: discoveryEnvironmentHash(config), grants: rows.map(r => ({ expired: new Date(r.expires_at).getTime() <= Date.now(), revoked: !!r.revoked_at, environment_matches: r.environment_sha256 === discoveryEnvironmentHash(config), scopes: r.scopes, expires_at: r.expires_at })) };
  } finally { await client.end(); }
});
console.log(JSON.stringify(report, null, 2)); process.exitCode = failed ? 1 : 0;

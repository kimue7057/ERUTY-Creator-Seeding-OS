import "dotenv/config";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { generateKeyPair, exportJWK, SignJWT, type JWTPayload } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import pg from "pg";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../../src/lib/db";
import { users, organizations, projects, campaigns, campaignBriefRevisions, memberships, discoveryProbeWorkspaces as workspaces, discoveryProbeGrants as grants, discoveryProbes as probes, auditEvents } from "../../src/lib/db/schema";
import { provisionProbeSandbox } from "../../src/lib/probe/provision";
import { createProbeHttpServer } from "../../src/lib/probe/server";
import { probeConfig } from "../../src/lib/probe/config";
import { probeHash } from "../../src/lib/probe/contracts";
let issuer: string; let resource: string; let resourceB: string;
let userId: string; let sandbox: Awaited<ReturnType<typeof provisionProbeSandbox>>; let other: typeof sandbox;
let keys: Awaited<ReturnType<typeof generateKeyPair>>; let wrongKeys: typeof keys;
const servers: HttpServer[] = []; const events: { request_id: string; outcome: string }[] = [];
const clients: Client[] = [];
const nonce = randomUUID(), idempotencyKey = randomUUID(); let storedId: string;
async function listen(server: HttpServer) { server.listen(0, "127.0.0.1"); await once(server, "listening"); return `http://127.0.0.1:${(server.address() as { port: number }).port}`; }
async function token(options: { payload?: JWTPayload; wrongKey?: boolean; scope?: string; subject?: string; expired?: boolean } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scope: options.scope ?? "discovery:read discovery:probe", ...options.payload }).setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: "probe-test" }).setIssuer(issuer).setSubject(options.subject ?? "synthetic-subject-a").setAudience(resource).setIssuedAt(now).setExpirationTime(options.expired ? now - 10 : now + 300).sign((options.wrongKey ? wrongKeys : keys).privateKey);
}
async function signedClaims(changes: JWTPayload) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scope: "discovery:read discovery:probe", iss: issuer, aud: resource, sub: "synthetic-subject-a", iat: now, exp: now + 300, ...changes }).setProtectedHeader({ alg: "ES256", kid: "probe-test" }).sign(keys.privateKey);
}
async function connect(accessToken?: string, url = resource) {
  accessToken ??= await token();
  const client = new Client({ name: "eruty-local-probe-test-not-work", version: "1.0.0" }); clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${accessToken}` } } })); return client;
}
const readResult = (result: Awaited<ReturnType<Client["callTool"]>>) => { assert.equal(result.isError, undefined, JSON.stringify(result)); return result.structuredContent as Record<string, unknown>; };
async function callWrite(client: Client, input: Record<string, unknown> = {}) { return client.callTool({ name: "write_discovery_probe", arguments: { contract_version: 1, nonce, idempotency_key: idempotencyKey, ...input } }); }
async function count() { return (await db.select({ n: sql<number>`count(*)::int` }).from(probes).where(eq(probes.organizationId, sandbox.organization_id)))[0].n; }
before(async () => {
  keys = await generateKeyPair("ES256"); wrongKeys = await generateKeyPair("ES256");
  const jwk = { ...await exportJWK(keys.publicKey), kid: "probe-test", alg: "ES256", use: "sig" };
  const idp = createServer((req, res) => { if (req.url !== "/jwks") { res.writeHead(404).end(); return; } res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ keys: [jwk] })); }); servers.push(idp);
  issuer = `${await listen(idp)}/`;
  [ { id: userId } ] = await db.insert(users).values({ email: `${randomUUID()}@example.invalid`, name: "Synthetic MCP operator", passwordHash: "no-login-test-user" }).returning();
  sandbox = await provisionProbeSandbox({ userId, issuer, subject: "synthetic-subject-a", scopes: ["discovery:read", "discovery:probe"], expiresAt: new Date(Date.now() + 3600_000) });
  other = await provisionProbeSandbox({ userId, issuer, subject: "synthetic-subject-b", scopes: ["discovery:read", "discovery:probe"], expiresAt: new Date(Date.now() + 3600_000) });
  for (const workspace of [sandbox, other]) {
    // Config object is private to this server; fill the actual ephemeral port before requests begin.
    const config = probeConfig({ NODE_ENV: "test", MCP_RESOURCE_URL: "http://127.0.0.1:3100/mcp", MCP_OAUTH_ISSUER: issuer, MCP_OAUTH_JWKS_URL: `${issuer}jwks`, MCP_PROBE_ORGANIZATION_ID: workspace.organization_id, MCP_BUILD_SHA: "c3b3c44" });
    const server = createProbeHttpServer(config, event => events.push(event)); servers.push(server);
    const origin = await listen(server); config.resource = `${origin}/mcp`; config.allowedHost = new URL(origin).host; config.metadataUrl = `${origin}/.well-known/oauth-protected-resource/mcp`; config.allowedOrigins.clear(); config.allowedOrigins.add(origin);
    if (workspace === sandbox) resource = config.resource; else resourceB = config.resource;
  }
});
after(async () => {
  for (const client of clients) await client.close().catch(() => {});
  for (const server of servers) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  for (const ws of [sandbox, other].filter(Boolean)) {
    await db.delete(auditEvents).where(eq(auditEvents.organizationId, ws.organization_id));
    await db.delete(probes).where(eq(probes.organizationId, ws.organization_id));
    await db.delete(grants).where(eq(grants.organizationId, ws.organization_id));
    await db.delete(workspaces).where(eq(workspaces.organizationId, ws.organization_id));
    await db.delete(campaigns).where(eq(campaigns.organizationId, ws.organization_id));
    await db.delete(projects).where(eq(projects.organizationId, ws.organization_id));
    await db.delete(memberships).where(eq(memberships.organizationId, ws.organization_id));
    await db.delete(organizations).where(eq(organizations.id, ws.organization_id));
  }
  if (userId) await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});
test("remote MCP discovers exactly three authenticated tools and writes/reads immutable PostgreSQL data with independent connection and audits", async () => {
  const metadata = await fetch(`${new URL(resource).origin}/.well-known/oauth-protected-resource/mcp`); assert.equal(metadata.status, 200); assert.equal((await metadata.json()).resource, resource);
  const client = await connect();
  const listed = await client.listTools(); assert.deepEqual(listed.tools.map(t => t.name), ["eruty_capabilities", "write_discovery_probe", "read_discovery_probe"]);
  for (const tool of listed.tools) { assert.equal(tool.inputSchema.additionalProperties, false); assert.ok(tool._meta?.securitySchemes); }
  const wireTools = await fetch(resource, { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 77, method: "tools/list" }) });
  assert.ok((await wireTools.json()).result.tools.every((t: { securitySchemes?: unknown }) => t.securitySchemes));
  const capability = readResult(await client.callTool({ name: "eruty_capabilities", arguments: { contract_version: 1 } }));
  assert.equal(capability.work_connection, "unverified"); assert.equal(capability.organization_id, sandbox.organization_id); assert.equal(capability.sns_discovery, "not_implemented");
  const result = readResult(await callWrite(client)); storedId = String(result.probe_id);
  assert.equal(result.payload_sha256, probeHash(nonce)); assert.equal(result.replayed, false); assert.equal(result.actor_id, userId);
  const read = readResult(await client.callTool({ name: "read_discovery_probe", arguments: { contract_version: 1, probe_id: storedId } })); assert.equal(read.nonce, nonce);
  const independent = new pg.Client({ connectionString: process.env.DATABASE_URL }); await independent.connect();
  try {
    const persisted = await independent.query("select nonce, payload_sha256, actor_id, request_id from discovery_probes where id=$1 and organization_id=$2", [storedId, sandbox.organization_id]);
    assert.equal(persisted.rowCount, 1); assert.equal(persisted.rows[0].nonce, nonce); assert.equal(persisted.rows[0].payload_sha256, result.payload_sha256); assert.equal(persisted.rows[0].request_id, result.request_id); assert.equal(persisted.rows[0].actor_id, userId);
    const audit = await independent.query("select action from audit_events where entity_id=$1", [storedId]); assert.deepEqual(audit.rows.map(r => r.action).sort(), ["discovery.probe_read", "discovery.probe_written"]);
  } finally { await independent.end(); }
  await assert.rejects(() => db.update(probes).set({ nonce: randomUUID() }).where(eq(probes.id, storedId)));
  const snapshot = await db.select().from(campaignBriefRevisions).where(eq(campaignBriefRevisions.campaignId, sandbox.campaign_id)); assert.equal(snapshot.length, 1); assert.deepEqual(snapshot[0].snapshot.assets, []);
});
test("concurrent HTTP retries and lost-response retries persist one receipt; changed payloads conflict and untrusted fields create no rows", async () => {
  const client = await connect(); const beforeCount = await count();
  const input = { nonce: randomUUID(), idempotency_key: randomUUID() };
  const responses = await Promise.all(Array.from({ length: 6 }, () => callWrite(client, input)));
  const ids = responses.map(r => readResult(r).probe_id); assert.equal(new Set(ids).size, 1); assert.equal(await count(), beforeCount + 1);
  // Discard the first receipt, then retry with a new HTTP MCP client as after a lost acknowledgement.
  const retry = readResult(await callWrite(await connect(), input)); assert.equal(retry.probe_id, ids[0]); assert.equal(retry.replayed, true);
  const caseRetry = readResult(await callWrite(client, { nonce: input.nonce.toUpperCase(), idempotency_key: input.idempotency_key.toUpperCase() })); assert.equal(caseRetry.probe_id, ids[0]); assert.equal(caseRetry.payload_sha256, probeHash(String(caseRetry.nonce)));
  assert.equal((await callWrite(client, { ...input, nonce: randomUUID() })).isError, true);
  for (const field of ["organization_id", "actor_id", "status", "note"]) assert.equal((await callWrite(client, { idempotency_key: randomUUID(), [field]: "bad" })).isError, true);
  assert.equal((await callWrite(client, { nonce: "not-a-synthetic-uuid", idempotency_key: randomUUID() })).isError, true);
  assert.equal(await count(), beforeCount + 1);
});
test("tokens require valid signature, issuer, exact audience, expiry and scope; cookie or query tokens are never accepted", async () => {
  const beforeCount = await count();
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "write_discovery_probe", arguments: { contract_version: 1, nonce, idempotency_key: randomUUID() } } });
  const missing = await fetch(resource, { method: "POST", headers, body: payload }); assert.equal(missing.status, 401); assert.match(missing.headers.get("www-authenticate")!, /resource_metadata=.*oauth-protected-resource\/mcp/);
  for (const access of [await token({ wrongKey: true }), await token({ expired: true }), await signedClaims({ aud: "oauth-client-id" }), await signedClaims({ iss: "https://wrong.invalid/" }), await signedClaims({ iat: Math.floor(Date.now() / 1000) + 30 }), await signedClaims({ scope: undefined }), await signedClaims({ exp: undefined }), "invalid.jwt.token"]) assert.equal((await fetch(resource, { method: "POST", headers: { ...headers, Authorization: `Bearer ${access}` }, body: payload })).status, 401);
  assert.equal((await fetch(resource, { method: "POST", headers: { ...headers, Authorization: `Bearer ${await token({ scope: "unrelated" })}` }, body: payload })).status, 403);
  assert.equal((await fetch(resource, { method: "POST", headers: { ...headers, Cookie: `eruty_session=${randomUUID()}` }, body: payload })).status, 401);
  assert.equal((await fetch(`${resource}?access_token=${await token()}`, { method: "POST", headers, body: payload })).status, 404);
  assert.equal(await count(), beforeCount);
  assert.ok(events.length); assert.ok(events.every(e => Object.keys(e).sort().join() === "outcome,request_id"));
});
test("organization, principal, live membership, scope, expiry and revocation constrain every request", async () => {
  const beforeCount = await count();
  const wrongOrganization = await token({ subject: "synthetic-subject-b" });
  await assert.rejects(() => connect(wrongOrganization));
  const otherToken = await signedClaims({ sub: "synthetic-subject-b", aud: resourceB }); const otherClient = await connect(otherToken, resourceB);
  assert.equal((await otherClient.callTool({ name: "read_discovery_probe", arguments: { contract_version: 1, probe_id: storedId } })).isError, true);
  const client = await connect();
  await db.update(memberships).set({ role: "reviewer" }).where(and(eq(memberships.organizationId, sandbox.organization_id), eq(memberships.userId, userId)));
  assert.equal((await callWrite(client, { idempotency_key: randomUUID() })).isError, true);
  assert.equal(readResult(await client.callTool({ name: "read_discovery_probe", arguments: { contract_version: 1, probe_id: storedId } })).probe_id, storedId);
  await db.update(memberships).set({ role: "manager" }).where(and(eq(memberships.organizationId, sandbox.organization_id), eq(memberships.userId, userId)));
  assert.equal((await callWrite(await connect(await token({ scope: "discovery:read" })), { idempotency_key: randomUUID() })).isError, true);
  await db.update(grants).set({ scopes: ["discovery:read"] }).where(eq(grants.id, sandbox.grant_id));
  assert.equal((await callWrite(client, { idempotency_key: randomUUID() })).isError, true);
  await db.update(grants).set({ scopes: ["discovery:read", "discovery:probe"], expiresAt: new Date(Date.now() - 1) }).where(eq(grants.id, sandbox.grant_id));
  await assert.rejects(() => client.callTool({ name: "eruty_capabilities", arguments: { contract_version: 1 } }));
  await db.update(grants).set({ expiresAt: new Date(Date.now() + 60000), revokedAt: new Date() }).where(eq(grants.id, sandbox.grant_id));
  await assert.rejects(() => connect()); assert.equal(await count(), beforeCount);
  await db.update(grants).set({ revokedAt: null }).where(eq(grants.id, sandbox.grant_id));
  await db.update(workspaces).set({ disabledAt: new Date() }).where(eq(workspaces.organizationId, sandbox.organization_id));
  await assert.rejects(() => connect());
  await db.update(workspaces).set({ disabledAt: null }).where(eq(workspaces.organizationId, sandbox.organization_id));
});
test("HTTP rejects hostile origins/hosts, oversized requests, batches and non-JSON input without leaking data", async () => {
  const headers = { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  const beforeCount = await count();
  assert.equal((await fetch(resource, { method: "POST", headers: { ...headers, Origin: "https://evil.invalid" }, body: "{}" })).status, 403);
  // Undici forbids overriding Host in some runtimes; use the native HTTP client below.
  const { request } = await import("node:http");
  const hostStatus = await new Promise<number>(resolve => { const req = request(resource, { method: "POST", headers: { ...headers, Host: "evil.invalid" } }, res => { res.resume(); resolve(res.statusCode!); }); req.end("{}"); }); assert.equal(hostStatus, 403);
  assert.equal((await fetch(resource, { method: "POST", headers, body: JSON.stringify({ padding: "x".repeat(5000) }) })).status, 413);
  assert.equal((await fetch(resource, { method: "POST", headers, body: "[]" })).status, 400);
  assert.equal((await fetch(resource, { method: "POST", headers, body: "{" })).status, 400);
  assert.equal((await fetch(resource, { method: "POST", headers: { ...headers, "Content-Type": "text/plain" }, body: "{}" })).status, 415);
  assert.equal((await fetch(resource, { method: "GET", headers })).status, 405);
  const chunkedStatus = await new Promise<number>((resolve, reject) => {
    const req = request(resource, { method: "POST", headers: { ...headers, "Transfer-Encoding": "chunked" } }, res => { res.resume(); resolve(res.statusCode!); });
    req.on("error", reject); req.write("x".repeat(3000)); req.end("x".repeat(3000));
  }); assert.equal(chunkedStatus, 413);
  assert.equal(await count(), beforeCount);
});

test("another principal in the same organization cannot read a receipt, and scoped DB foreign keys reject a different workspace", async () => {
  const [second] = await db.insert(grants).values({ organizationId: sandbox.organization_id, userId, issuer, subject: "synthetic-subject-a2", scopes: ["discovery:read", "discovery:probe"], expiresAt: new Date(Date.now() + 60000), createdBy: userId }).returning();
  const otherPrincipal = await connect(await token({ subject: "synthetic-subject-a2" }));
  assert.equal((await otherPrincipal.callTool({ name: "read_discovery_probe", arguments: { contract_version: 1, probe_id: storedId } })).isError, true);
  await assert.rejects(() => db.insert(probes).values({ organizationId: sandbox.organization_id, projectId: other.project_id, campaignId: other.campaign_id, principalId: second.id, actorId: userId, idempotencyKey: randomUUID(), nonce, payloadSha256: probeHash(nonce), requestId: randomUUID() }));
});

test("built Node server entry runs as a separate local process and performs authenticated MCP write/read", async () => {
  const reservation = createServer(); const origin = await listen(reservation); await new Promise<void>(resolve => reservation.close(() => resolve()));
  const childResource = `${origin}/mcp`;
  const child = spawn(process.execPath, [resolve(".local/build/mcp-server.mjs")], { cwd: process.cwd(), windowsHide: true, env: { ...process.env, NODE_ENV: "test", MCP_BIND_HOST: "127.0.0.1", MCP_PORT: new URL(origin).port, MCP_RESOURCE_URL: childResource, MCP_OAUTH_ISSUER: issuer, MCP_OAUTH_JWKS_URL: `${issuer}jwks`, MCP_PROBE_ORGANIZATION_ID: sandbox.organization_id }, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Built MCP server did not start")), 10000);
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.once("exit", () => { clearTimeout(timeout); reject(new Error("Built MCP server exited early")); });
      child.stdout.on("data", data => { if (String(data).includes("MCP listening")) { clearTimeout(timeout); resolve(); } });
    });
    const client = await connect(await signedClaims({ aud: childResource }), childResource);
    const result = readResult(await callWrite(client, { nonce: randomUUID(), idempotency_key: randomUUID() }));
    assert.equal(readResult(await client.callTool({ name: "read_discovery_probe", arguments: { contract_version: 1, probe_id: result.probe_id } })).payload_sha256, result.payload_sha256);
    await client.close();
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
  }
});

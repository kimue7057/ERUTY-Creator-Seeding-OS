import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import { Client } from "pg";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { initializeProbeStaging, assertStagingDatabase, STAGING_ROLES } from "../../src/lib/probe/staging";
import { verifyProbeProof } from "../../src/lib/probe/proof";
import { inspectProbeOAuth } from "../../src/lib/probe/oauth-preflight";
import { probeConfig } from "../../src/lib/probe/config";
import { createProbeHttpServer } from "../../src/lib/probe/server";
import { pool } from "../../src/lib/db";
import * as schema from "../../src/lib/db/schema";
import { probeService } from "../../src/lib/probe/service";

test("fresh staging PostgreSQL: least-privilege MCP write/read, independent proof, audited revocation and preserved receipt", async () => {
  assert.throws(() => assertStagingDatabase(process.env.DATABASE_URL!));
  const databaseName = `eruty_probe_test_${randomBytes(6).toString("hex")}`;
  const ownerUrl = new URL(process.env.DATABASE_URL!); ownerUrl.pathname = `/${databaseName}`;
  const runtimePassword = randomBytes(32).toString("hex"), verifierPassword = randomBytes(32).toString("hex");
  const admin = new Client({ connectionString: process.env.DATABASE_URL }); await admin.connect();
  const keys = await generateKeyPair("ES256");
  const jwk = { ...await exportJWK(keys.publicKey), kid: "staging-test", alg: "ES256", use: "sig" };
  let issuer = "";
  const provider = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/jwks") res.end(JSON.stringify({ keys: [jwk] }));
    else if (req.url === "/metadata") res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}jwks`, authorization_endpoint: `${issuer}authorize`, token_endpoint: `${issuer}token`, response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["discovery:read", "discovery:probe"] }));
    else res.writeHead(404).end();
  });
  provider.listen(0, "127.0.0.1"); await once(provider, "listening"); issuer = `http://127.0.0.1:${(provider.address() as { port: number }).port}/`;
  let owner: Client | undefined; let verifier: Client | undefined; let runtime: Client | undefined;
  let server: ReturnType<typeof createProbeHttpServer> | undefined;
  let rolesCreated = false;
  const proofFile = resolve(`.local/staging-proof-${randomUUID()}.json`);
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const input = { databaseUrl: ownerUrl.href, issuer, subject: "synthetic-staging-subject", runtimePassword, verifierPassword, confirmation: "initialize-empty-synthetic-probe-database" };
    await assert.rejects(() => initializeProbeStaging({ ...input, confirmation: "" }));
    await assert.rejects(() => initializeProbeStaging({ ...input, databaseUrl: process.env.DATABASE_URL! }));
    const { stdout } = await promisify(execFile)(process.execPath, [".local/build/mcp-staging-init.mjs"], { env: { ...process.env, DATABASE_URL: ownerUrl.href, MCP_OAUTH_ISSUER: issuer, MCP_PROBE_SUBJECT: input.subject, MCP_RUNTIME_PASSWORD: runtimePassword, MCP_VERIFIER_PASSWORD: verifierPassword, MCP_STAGING_INIT_CONFIRM: input.confirmation } });
    const sandbox = JSON.parse(stdout) as { organization_id: string; grant_id: string; actor_id: string; operator_email: string }; rolesCreated = true;
    await assert.rejects(() => initializeProbeStaging(input));
    const runtimeUrl = new URL(ownerUrl); runtimeUrl.username = STAGING_ROLES.runtime; runtimeUrl.password = runtimePassword;
    const verifierUrl = new URL(ownerUrl); verifierUrl.username = STAGING_ROLES.verifier; verifierUrl.password = verifierPassword;
    runtime = new Client({ connectionString: runtimeUrl.href }); await runtime.connect();
    verifier = new Client({ connectionString: verifierUrl.href }); await verifier.connect();
    owner = new Client({ connectionString: ownerUrl.href }); await owner.connect();
    assert.equal((await owner.query("select count(*)::int as n from organizations")).rows[0].n, 1);
    for (const query of ["select * from users", "select * from project_assets", "update discovery_probe_grants set scopes=ARRAY['discovery:read']", "update discovery_probe_workspaces set disabled_at=now()", "delete from discovery_probes", "create table unauthorized(id int)"]) await assert.rejects(() => runtime!.query(query));
    await assert.rejects(() => verifier!.query("insert into audit_events default values"));
    // Run the real HTTP server against the restricted runtime pool, not the owner pool.
    const { Pool } = await import("pg"); const scopedPool = new Pool({ connectionString: runtimeUrl.href });
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const scoped = drizzle(scopedPool, { schema });
    try {
      const config = probeConfig({ NODE_ENV: "test", MCP_RESOURCE_URL: "http://127.0.0.1:3100/mcp", MCP_OAUTH_ISSUER: issuer, MCP_OAUTH_JWKS_URL: `${issuer}jwks`, MCP_PROBE_ORGANIZATION_ID: sandbox.organization_id, MCP_BUILD_SHA: "a3f69a2" });
      server = createProbeHttpServer(config, undefined, probeService(sandbox.organization_id, config.build, scoped)); server.listen(0, "127.0.0.1"); await once(server, "listening");
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      config.resource = `${origin}/v1/mcp/tunnel_00000000000000000000000000000000`;
      config.allowedHost = new URL(origin).host;
      config.metadataUrl = `${origin}/.well-known/oauth-protected-resource/v1/mcp/tunnel_00000000000000000000000000000000`;
      const metadataResponse = await fetch(config.metadataUrl);
      assert.equal(metadataResponse.status, 200);
      assert.equal((await metadataResponse.json()).resource, config.resource);
      const challengeResponse = await fetch(`${origin}/mcp`, { method: "POST" });
      assert.equal(challengeResponse.status, 401);
      assert.ok(challengeResponse.headers.get("www-authenticate")?.includes(config.metadataUrl));
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({ scope: "discovery:read discovery:probe" }).setProtectedHeader({ alg: "ES256", kid: "staging-test" }).setSubject(input.subject).setIssuer(issuer).setAudience(config.resource).setIssuedAt(now).setExpirationTime(now + 300).sign(keys.privateKey);
      const wrongAudience = await new SignJWT({ scope: "discovery:read discovery:probe" }).setProtectedHeader({ alg: "ES256", kid: "staging-test" }).setSubject(input.subject).setIssuer(issuer).setAudience(`${origin}/mcp`).setIssuedAt(now).setExpirationTime(now + 300).sign(keys.privateKey);
      assert.equal((await fetch(`${origin}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${wrongAudience}` } })).status, 401);
      assert.equal((await inspectProbeOAuth(config, `${issuer}metadata`, token)).token_validation, "signature_issuer_audience_lifetime_scopes_verified");
      const call = async (name: string, args: object) => {
        const response = await fetch(`${origin}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } }) });
        return { status: response.status, body: await response.json() };
      };
      const capabilities = (await call("eruty_capabilities", { contract_version: 1 })).body.result.structuredContent;
      const nonce = randomUUID(); const key = randomUUID();
      const write = (await call("write_discovery_probe", { contract_version: 1, nonce, idempotency_key: key })).body.result.structuredContent;
      assert.ok(write, "restricted runtime must be able to SELECT FOR SHARE and insert probe/audit");
      await assert.rejects(() => verifyProbeProof(verifier!, { capabilities, write, read: write }, { organizationId: sandbox.organization_id, grantId: sandbox.grant_id, build: "a3f69a2", closed: false }));
      const read = (await call("read_discovery_probe", { contract_version: 1, probe_id: write.probe_id })).body.result.structuredContent;
      const evidence = { capabilities, write, read };
      const expected = { organizationId: sandbox.organization_id, grantId: sandbox.grant_id, build: "a3f69a2", closed: false };
      assert.equal((await verifyProbeProof(verifier, evidence, expected)).persisted_readback, true);
      mkdirSync(".local", { recursive: true }); writeFileSync(proofFile, JSON.stringify(evidence), { mode: 0o600 });
      const verifyEnv = { ...process.env, DATABASE_URL: verifierUrl.href, MCP_PROOF_FILE: proofFile, MCP_PROBE_ORGANIZATION_ID: sandbox.organization_id, MCP_PROBE_GRANT_ID: sandbox.grant_id, MCP_BUILD_SHA: config.build };
      assert.equal(JSON.parse((await promisify(execFile)(process.execPath, [".local/build/mcp-staging-verify.mjs"], { env: verifyEnv })).stdout).verifier_read_only, true);
      await assert.rejects(() => verifyProbeProof(owner!, evidence, expected));
      for (const altered of [{ ...evidence, read: { ...read, nonce: randomUUID() } }, { ...evidence, capabilities: { ...capabilities, build: "b3e5ea2" } }]) await assert.rejects(() => verifyProbeProof(verifier!, altered, expected));
      await assert.rejects(() => verifyProbeProof(verifier!, evidence, { ...expected, closed: true }));
      await runtime.query("begin");
      await assert.rejects(() => runtime!.query("update discovery_probes set nonce=$1 where id=$2", [randomUUID(), write.probe_id]));
      await runtime.query("rollback");
      await promisify(execFile)(process.execPath, [".local/build/mcp-revoke.mjs"], { env: { ...process.env, DATABASE_URL: ownerUrl.href, MCP_PROBE_ORGANIZATION_ID: sandbox.organization_id, MCP_PROBE_GRANT_ID: sandbox.grant_id, MCP_PROBE_USER_EMAIL: sandbox.operator_email } });
      for (const denial of [await call("write_discovery_probe", { contract_version: 1, nonce: randomUUID(), idempotency_key: randomUUID() }), await call("read_discovery_probe", { contract_version: 1, probe_id: write.probe_id })]) {
        assert.equal(denial.status, 200); assert.equal(denial.body.result.isError, true);
        assert.equal(denial.body.result.structuredContent.status, 403); assert.equal(denial.body.result._meta["mcp/www_authenticate"], undefined);
      }
      const closed = await verifyProbeProof(verifier, evidence, { ...expected, closed: true });
      assert.equal(JSON.parse((await promisify(execFile)(process.execPath, [".local/build/mcp-staging-verify.mjs", "--closed"], { env: verifyEnv })).stdout).grant_revoked, true);
      assert.equal(closed.grant_revoked, true); assert.equal(closed.no_active_grants, true); assert.equal(closed.work_connection, "unverified");
      assert.equal((await verifier.query("select count(*)::int as n from discovery_probes")).rows[0].n, 1);
    } finally { await scopedPool.end(); }
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()));
    for (const client of [runtime, verifier, owner]) await client?.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    if (rolesCreated) for (const role of Object.values(STAGING_ROLES)) await admin.query(`DROP ROLE ${role}`);
    await admin.end(); await pool.end();
    try { unlinkSync(proofFile); } catch { /* No proof file when initialization fails. */ }
  }
});

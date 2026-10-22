import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import pg from "pg";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import * as baseSchema from "../../src/lib/db/schema";
import { withDiscoveryDatabase } from "../discovery-fixture";
import { logSample, observationSample, prepareSample } from "../discovery-samples";
import { discoveryProbeWorkspaces, memberships, auditEvents } from "../../src/lib/db/schema";
import { discoveryMcpGrants } from "../../src/lib/db/discovery-schema";
import { createDiscoveryHttpServer } from "../../src/lib/discovery/mcp";
import { discoveryMcpConfig, discoveryEnvironmentHash } from "../../src/lib/discovery/mcp-access";
import { provisionDiscoveryGrant } from "../../src/lib/discovery/provision";
import { verifyDiscoveryProof } from "../../src/lib/discovery/proof";
import { assertDiscoveryRuntimeRole } from "../../src/lib/discovery/runtime-role";
import type { DiscoveryTransaction } from "../../src/lib/discovery/service";

test("six authenticated discovery MCP tools: synthetic SDK flow, independent read-only DB proof and live revocation (not hosted Work)", async () => {
  await withDiscoveryDatabase(async ({ database, client: owner, actor, campaign }) => {
    const keys = await generateKeyPair("ES256"), jwk = { ...await exportJWK(keys.publicKey), kid: "discovery-local-fixture", alg: "ES256", use: "sig" };
    const idp = createServer((_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ keys: [jwk] })); });
    idp.listen(0, "127.0.0.1"); await once(idp, "listening");
    const issuer = `http://127.0.0.1:${(idp.address() as { port: number }).port}/`;
    const config = discoveryMcpConfig({ NODE_ENV: "test", MCP_RESOURCE_URL: "http://127.0.0.1:3100/mcp", MCP_OAUTH_ISSUER: issuer, MCP_OAUTH_JWKS_URL: `${issuer}jwks`, MCP_DISCOVERY_ORGANIZATION_ID: actor.organizationId, MCP_DISCOVERY_ALLOW_SYNTHETIC: "true", MCP_BUILD_SHA: "d15c0a1" });
    const events: { request_id: string; outcome: string }[] = [];
    let selectedDatabase = database;
    const databaseAdapter = { transaction<T>(run: (tx: DiscoveryTransaction) => Promise<T>, options?: PgTransactionConfig) { return selectedDatabase.transaction(run, options); } };
    const server = createDiscoveryHttpServer(config, event => events.push(event), databaseAdapter);
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    config.resource = `${origin}/mcp`; config.allowedHost = new URL(origin).host; config.metadataUrl = `${origin}/.well-known/oauth-protected-resource/mcp`; config.allowedOrigins.clear(); config.allowedOrigins.add(origin);
    const clients: Client[] = []; let verifier: pg.Client | undefined; let role: string | undefined; let runtimeRole: string | undefined; let runtimePool: pg.Pool | undefined;
    async function token(subject = "synthetic-discovery-subject", scopes = "discovery:read discovery:observe discovery:submit", audience = config.resource) {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({ scope: scopes }).setProtectedHeader({ alg: "ES256", kid: jwk.kid }).setIssuer(issuer).setSubject(subject).setAudience(audience).setIssuedAt(now).setExpirationTime(now + 300).sign(keys.privateKey);
    }
    async function connect(subject?: string, scopes?: string) {
      const sdk = new Client({ name: "synthetic-codex-sdk-not-gpt-work", version: "1.0.0" }); clients.push(sdk);
      await sdk.connect(new StreamableHTTPClientTransport(new URL(config.resource), { requestInit: { headers: { Authorization: `Bearer ${await token(subject, scopes)}` } } })); return sdk;
    }
    const structured = (value: Awaited<ReturnType<Client["callTool"]>>) => { assert.equal(value.isError, undefined); return value.structuredContent as Record<string, unknown>; };
    try {
      const a = await campaign(), forbidden = await campaign();
      await database.insert(discoveryProbeWorkspaces).values({ organizationId: actor.organizationId, projectId: a.projectId, campaignId: a.id, createdBy: actor.userId });
      const grantData = { organization_id: actor.organizationId, user_id: actor.userId, issuer, subject: "synthetic-discovery-subject", environment_sha256: discoveryEnvironmentHash(config), execution_source: "codex_test", campaign_ids: [a.id], scopes: ["discovery:read", "discovery:observe", "discovery:submit"], expires_at: new Date(Date.now() + 3600000).toISOString(), confirmation: "create-explicit-discovery-campaign-grant" };
      const grant = await provisionDiscoveryGrant(grantData, database);
      runtimeRole = `discovery_runtime_${randomUUID().replaceAll("-", "")}`; const runtimePassword = randomBytes(32).toString("hex");
      assert.match(runtimeRole, /^discovery_runtime_[a-f0-9]{32}$/);
      await owner.query(`CREATE ROLE "${runtimeRole}" LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
      await owner.query((await readFile("staging/discovery/runtime-grants.sql", "utf8")).replaceAll("eruty_discovery_runtime", runtimeRole));
      const runtimeUrl = new URL(process.env.DATABASE_URL!); runtimeUrl.pathname = `/${(await owner.query("select current_database() name")).rows[0].name}`; runtimeUrl.username = runtimeRole; runtimeUrl.password = runtimePassword;
      runtimePool = new pg.Pool({ connectionString: runtimeUrl.href, max: 4 });
      await assertDiscoveryRuntimeRole(runtimePool); await assert.rejects(assertDiscoveryRuntimeRole({ query: owner.query.bind(owner) }), /least-privilege/);
      selectedDatabase = drizzle(runtimePool, { schema: baseSchema });
      const anonymous = await fetch(config.resource, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }); assert.equal(anonymous.status, 401);
      const wrongAudience = await fetch(config.resource, { method: "POST", body: "{}", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(undefined, undefined, "https://wrong.invalid/mcp")}` } }); assert.equal(wrongAudience.status, 401);
      const sdk = await connect(); const tools = await sdk.listTools();
      assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ["get_campaign_discovery_context", "prepare_discovery_run", "append_discovery_log", "record_discovery_observation", "submit_discovery_run", "get_discovery_run"].sort());
      assert.ok(tools.tools.every(tool => tool.inputSchema.additionalProperties === false));
      const oversized = await fetch(config.resource, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ extra: "x".repeat(65536) }) }); assert.equal(oversized.status, 413);
      const context = structured(await sdk.callTool({ name: "get_campaign_discovery_context", arguments: { contract_version: 1, campaign_id: a.id } })); assert.equal(context.work_connection, "unverified");
      assert.equal((await sdk.callTool({ name: "get_campaign_discovery_context", arguments: { contract_version: 1, campaign_id: forbidden.id } })).isError, true);
      const prepare = structured(await sdk.callTool({ name: "prepare_discovery_run", arguments: prepareSample(a.id) }));
      const log = structured(await sdk.callTool({ name: "append_discovery_log", arguments: logSample(prepare.run_id as string) }));
      const recordInput = observationSample(prepare.run_id as string, prepare.context_sha256 as string, log.log_id as string);
      const observation = structured(await sdk.callTool({ name: "record_discovery_observation", arguments: recordInput }));
      const replay = structured(await sdk.callTool({ name: "record_discovery_observation", arguments: recordInput })); assert.equal(replay.request_id, observation.request_id); assert.equal(replay.replayed, true);
      const read = structured(await sdk.callTool({ name: "get_discovery_run", arguments: { contract_version: 1, run_id: prepare.run_id } }));
      const submit = structured(await sdk.callTool({ name: "submit_discovery_run", arguments: { contract_version: 1, run_id: prepare.run_id, expected_lock_version: observation.lock_version, outcome: "submitted", limitations: ["SYNTHETIC — not actual Work"], idempotency_key: randomUUID() } })); assert.equal(submit.status, "awaiting_review");
      assert.ok(events.some(event => event.request_id === observation.request_id));
      role = `discovery_verify_${randomUUID().replaceAll("-", "")}`; const password = randomBytes(32).toString("hex");
      assert.match(role, /^discovery_verify_[a-f0-9]{32}$/);
      await owner.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
      await owner.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
      await owner.query(`GRANT SELECT ON discovery_runs,discovery_requests,discovery_evidence,campaign_creators,discovery_mcp_grants,audit_events TO "${role}"`);
      const verifierUrl = new URL(process.env.DATABASE_URL!); verifierUrl.pathname = `/${(await owner.query("select current_database() name")).rows[0].name}`; verifierUrl.username = role; verifierUrl.password = password;
      verifier = new pg.Client({ connectionString: verifierUrl.href }); await verifier.connect();
      const proof = await verifyDiscoveryProof(verifier, { observation, read }, { organizationId: actor.organizationId, closed: false });
      assert.equal(proof.persisted_readback, true); assert.equal(proof.work_connection, "unverified"); assert.equal(proof.execution_source, "codex_test");
      await assert.rejects(verifyDiscoveryProof(owner, { observation, read }, { organizationId: actor.organizationId, closed: false }), /read-only/);
      await assert.rejects(verifyDiscoveryProof(verifier, { observation: { ...observation, payload_sha256: "0".repeat(64) }, read }, { organizationId: actor.organizationId, closed: false }), /mismatch/);
      await provisionDiscoveryGrant({ ...grantData, subject: "synthetic-read-only", scopes: ["discovery:read"] }, database);
      const readonly = await connect("synthetic-read-only", "discovery:read");
      assert.equal((await readonly.callTool({ name: "prepare_discovery_run", arguments: prepareSample(a.id) })).isError, true);
      await database.update(memberships).set({ role: "reviewer" }).where(eq(memberships.userId, actor.userId));
      assert.equal((await sdk.callTool({ name: "prepare_discovery_run", arguments: prepareSample(a.id) })).isError, true);
      await database.update(discoveryMcpGrants).set({ revokedAt: new Date(), updatedAt: new Date() }).where(eq(discoveryMcpGrants.id, grant.grant_id));
      await database.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: grant.grant_id, action: "discovery.mcp_grant_revoked_by_operator" });
      await assert.rejects(sdk.callTool({ name: "get_discovery_run", arguments: { contract_version: 1, run_id: prepare.run_id } }));
      await assert.rejects(sdk.callTool({ name: "prepare_discovery_run", arguments: prepareSample(a.id) }));
      assert.equal((await owner.query("select count(*)::int n from discovery_runs")).rows[0].n, 1);
      assert.equal((await verifyDiscoveryProof(verifier, { observation, read }, { organizationId: actor.organizationId, closed: true })).grant_revoked, true);
    } finally {
      for (const sdk of clients) await sdk.close().catch(() => {});
      await verifier?.end();
      await runtimePool?.end();
      if (role) { await owner.query(`DROP OWNED BY "${role}"`); await owner.query(`DROP ROLE "${role}"`); }
      if (runtimeRole) { await owner.query(`DROP OWNED BY "${runtimeRole}"`); await owner.query(`DROP ROLE "${runtimeRole}"`); }
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
      idp.closeAllConnections(); await new Promise<void>(resolve => idp.close(() => resolve()));
    }
  });
});

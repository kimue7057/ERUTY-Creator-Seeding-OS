import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request as proxyRequest } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, existsSync, openSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { withDiscoveryDatabase } from "../discovery-fixture";
import { prepareSample, logSample, observationSample } from "../discovery-samples";
import { createDiscoveryHttpServer, discoveryMcpAdapter } from "../../src/lib/discovery/mcp";
import { createAuthorizedMcpHttpServer } from "../../src/lib/probe/server";
import { discoveryMcpConfig, discoveryEnvironmentHash } from "../../src/lib/discovery/mcp-config";
import { provisionDiscoveryGrant } from "../../src/lib/discovery/provision";
import { discoveryProbeWorkspaces } from "../../src/lib/db/schema";
import { discoveryMcpGrants } from "../../src/lib/db/discovery-schema";
import type { McpLogEvent } from "../../src/lib/probe/diagnostics";

test("Discovery stability: 20 real DB calls, gateway, idempotency, failures, bounded concurrency and restart (synthetic, not hosted Work)", { timeout: 60000 }, async () => {
  await withDiscoveryDatabase(async ({ database, client: owner, actor, other, campaign }) => {
    const keys = await generateKeyPair("ES256"), jwk = { ...await exportJWK(keys.publicKey), kid: "stability-test", alg: "ES256" };
    let issuer = "";
    const idp = createServer((req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(req.url?.includes(".well-known") ? { issuer, authorization_endpoint: issuer + "authorize", token_endpoint: issuer + "token", jwks_uri: issuer + "jwks", response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] } : { keys: [jwk] })); });
    idp.listen(0, "127.0.0.1"); await once(idp, "listening");
    issuer = `http://127.0.0.1:${(idp.address() as { port: number }).port}/`;
    const config = discoveryMcpConfig({ NODE_ENV: "test", MCP_RESOURCE_URL: "http://127.0.0.1:3100/mcp", MCP_OAUTH_ISSUER: issuer, MCP_OAUTH_JWKS_URL: `${issuer}jwks`, MCP_DISCOVERY_ORGANIZATION_ID: actor.organizationId, MCP_DISCOVERY_ALLOW_SYNTHETIC: "true", MCP_BUILD_SHA: "1234567" });
    let selected = database;
    const db = { transaction: ((...args: Parameters<typeof database.transaction>) => selected.transaction(...args)) as typeof database.transaction };
    const events: McpLogEvent[] = [];
    let http = createDiscoveryHttpServer(config, e => events.push(e), db);
    http.listen(0, "127.0.0.1"); await once(http, "listening");
    const port = (http.address() as { port: number }).port;
    const resource = `http://127.0.0.1:${port}/mcp`;
    config.resource = resource; config.allowedHost = new URL(resource).host; config.metadataUrl = new URL("/.well-known/oauth-protected-resource/mcp", resource).href;
    config.allowedOrigins.add("https://chatgpt.com");
    const a = await campaign(), sameOrgForbidden = await campaign(), otherOrg = await campaign(other);
    await database.insert(discoveryProbeWorkspaces).values({ organizationId: actor.organizationId, projectId: a.projectId, campaignId: a.id, createdBy: actor.userId });
    const grantInput = { organization_id: actor.organizationId, user_id: actor.userId, issuer, subject: "synthetic-stability", environment_sha256: discoveryEnvironmentHash(config), execution_source: "codex_test", campaign_ids: [a.id], scopes: ["discovery:read", "discovery:observe", "discovery:submit"], expires_at: new Date(Date.now() + 3600000).toISOString(), confirmation: "create-explicit-discovery-campaign-grant" };
    const grant = await provisionDiscoveryGrant(grantInput, database);
    const token = async (subject = grantInput.subject, scope = grantInput.scopes.join(" "), expired = false) => {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({ scope }).setProtectedHeader({ alg: "ES256", kid: jwk.kid }).setIssuer(issuer).setSubject(subject).setAudience(resource).setIssuedAt(now - (expired ? 600 : 0)).setExpirationTime(now + (expired ? -1 : 300)).sign(keys.privateKey);
    };
    const bearer = await token(), clients: Client[] = [];
    let dropNextResponse = false;
    const gateway = createServer(async (req, res) => {
      if (req.url !== "/mcp" && !req.url?.startsWith("/.well-known/oauth-protected-resource")) { res.writeHead(404).end(); return; }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks), rpc = body.length ? JSON.parse(body.toString()) : {};
      const drop = dropNextResponse && rpc.method === "tools/call";
      if (drop) dropNextResponse = false;
      const upstream = proxyRequest({ hostname: "127.0.0.1", port, path: req.url, method: req.method, headers: { ...req.headers, host: config.allowedHost } }, incoming => {
        if (drop) { incoming.resume(); incoming.once("end", () => res.destroy()); }
        else { res.writeHead(incoming.statusCode!, incoming.headers); incoming.pipe(res); }
      });
      upstream.on("error", () => { res.writeHead(502).end(); }); upstream.end(body);
    });
    gateway.listen(0, "127.0.0.1"); await once(gateway, "listening");
    const gatewayUrl = `http://127.0.0.1:${(gateway.address() as { port: number }).port}/mcp`;
    const connect = async (access = bearer, url = gatewayUrl) => {
      const sdk = new Client({ name: "synthetic-reliability-not-hosted-work", version: "1" }); clients.push(sdk);
      await sdk.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${access}`, Origin: "https://chatgpt.com" } } })); return sdk;
    };
    const good = (r: Awaited<ReturnType<Client["callTool"]>>) => { assert.notEqual(r.isError, true, JSON.stringify(r)); assert.ok(r.structuredContent); assert.deepEqual(JSON.parse((r.content as { text: string }[])[0].text), r.structuredContent); return r.structuredContent as Record<string, unknown>; };
    const call = (sdk: Client, name: string, args: Record<string, unknown>) => sdk.callTool({ name, arguments: args });
    const raw = async (access = bearer, extra: Record<string, string> = {}) => fetch(resource, { method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...extra }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_campaign_discovery_context", arguments: { contract_version: 1, campaign_id: a.id } } }) });
    const failingPool = new pg.Pool({ connectionString: "postgresql://synthetic:synthetic@127.0.0.1:1/unavailable", connectionTimeoutMillis: 300 }); failingPool.on("error", () => {});
    try {
      const sdk = await connect(); assert.equal((await sdk.listTools()).tools.length, 6);
      for (let i = 0; i < 20; i++) assert.equal(good(await call(sdk, "get_campaign_discovery_context", { contract_version: 1, campaign_id: a.id })).campaign_id, a.id);
      if (process.env.MCP_VENDOR_TUNNEL_BIN) {
        const directory = resolve(".local/discovery", "vendor-test-" + randomUUID()); mkdirSync(directory, { recursive: true });
        const output = openSync(directory + "/runtime.private.log", "a", 0o600), file = directory + "/connection.json";
        const proxy = spawn(resolve(process.env.MCP_VENDOR_TUNNEL_BIN), ["dev", "proxy", "--backend", "go", "--listen", "127.0.0.1:0", "--mcp-server-url", gatewayUrl, "--url-file", file, "--duration", "60s", "--readiness-timeout", "10s", "--response-timeout", "10s"], { stdio: ["ignore", output, output], windowsHide: true, env: { ...process.env, HARPOON_ALLOW_PLAINTEXT_HTTP: "true", LOG_HTTP_RAW_UNSAFE: "false" } });
        try {
          for (let i = 0; i < 100 && !existsSync(file) && proxy.exitCode === null; i++) await new Promise(resolve => setTimeout(resolve, 100));
          assert.ok(existsSync(file), "Official tunnel-client dev proxy must become ready; inspect private log");
          const connection = JSON.parse(readFileSync(file, "utf8"));
          const url = connection.mcp_url ?? connection.url;
          assert.equal(typeof url, "string", "Connection JSON keys: " + Object.keys(connection).join(","));
          const tunneled = await connect(bearer, url);
          assert.equal((await tunneled.listTools()).tools.length, 6);
          for (let i = 0; i < 20; i++) assert.equal(good(await call(tunneled, "get_campaign_discovery_context", { contract_version: 1, campaign_id: a.id })).campaign_id, a.id);
          await tunneled.close();
          console.log("Official tunnel-client 0.0.16 local control-plane → runtime → gateway → Discovery → isolated PostgreSQL: 20/20; not hosted Work.");
        } finally { proxy.kill(); closeSync(output); }
      }
      for (const id of [sameOrgForbidden.id, otherOrg.id]) {
        const denied = await call(sdk, "get_campaign_discovery_context", { contract_version: 1, campaign_id: id });
        assert.equal(denied.isError, true); assert.equal((denied.structuredContent as Record<string, unknown>)?.error, "not_found_or_forbidden"); assert.equal(denied._meta?.["mcp/www_authenticate"], undefined);
      }
      const invalid = await call(sdk, "get_campaign_discovery_context", { contract_version: 1, campaign_id: "invalid" });
      assert.equal((invalid.structuredContent as Record<string, unknown>)?.error, "invalid_input"); assert.ok((invalid.structuredContent as Record<string, unknown>)?.request_id);
      const input = prepareSample(a.id);
      const prepared = good(await call(sdk, "prepare_discovery_run", input));
      assert.equal(good(await call(sdk, "prepare_discovery_run", input)).run_id, prepared.run_id);
      const logInput = logSample(prepared.run_id as string);
      const [one, two] = await Promise.all([call(sdk, "append_discovery_log", logInput), call(sdk, "append_discovery_log", logInput)]);
      const log = good(one); assert.equal(good(two).log_id, log.log_id);
      const observationInput = observationSample(prepared.run_id as string, prepared.context_sha256 as string, log.log_id as string);
      dropNextResponse = true;
      await assert.rejects(call(sdk, "record_discovery_observation", observationInput));
      const observation = good(await call(sdk, "record_discovery_observation", observationInput)); assert.equal(observation.replayed, true);
      assert.equal((await owner.query("select count(*)::int n from creator_accounts")).rows[0].n, 1);
      assert.equal((await owner.query("select count(*)::int n from discovery_requests where tool='record_observation'")).rows[0].n, 1);
      const conflict = await call(sdk, "record_discovery_observation", { ...observationInput, profile: { ...observationInput.profile, match_notes: "changed synthetic payload" } }); assert.equal((conflict.structuredContent as Record<string, unknown>)?.error, "idempotency_conflict");
      const read = good(await call(sdk, "get_discovery_run", { contract_version: 1, run_id: prepared.run_id })); assert.ok(JSON.stringify(read).includes((observation.evidence_ids as string[])[0]));
      assert.equal(good(await call(sdk, "submit_discovery_run", { contract_version: 1, run_id: prepared.run_id, expected_lock_version: observation.lock_version, outcome: "partial", limitations: ["Synthetic reliability test"], idempotency_key: randomUUID() })).status, "awaiting_review");
      const correlation = randomUUID(), correlated = await raw(bearer, { "X-Correlation-Id": correlation }); assert.equal(correlated.headers.get("x-correlation-id"), correlation); await correlated.text();
      const deniedOrigin = await raw(bearer, { Origin: "https://evil.invalid" }); assert.equal(deniedOrigin.status, 403); assert.equal((await deniedOrigin.json()).error, "invalid_origin");
      const expired = await raw(await token(undefined, undefined, true)); assert.equal(expired.status, 401); assert.equal((await expired.json()).error, "token_expired"); assert.ok(expired.headers.has("www-authenticate"));
      const renewed = await connect(await token()); good(await call(renewed, "get_campaign_discovery_context", { contract_version: 1, campaign_id: a.id }));
      selected = drizzle(failingPool);
      const offline = await raw(); assert.equal(offline.status, 200); const dbFailure = (await offline.json()).result; assert.equal(dbFailure.isError, true); assert.equal(dbFailure.structuredContent.error, "database_unavailable"); assert.equal(dbFailure.structuredContent.status, 503);
      selected = database; good(await call(sdk, "get_campaign_discovery_context", { contract_version: 1, campaign_id: a.id }));
      http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve()));
      http = createDiscoveryHttpServer(config, e => events.push(e), db); http.listen(port, "127.0.0.1"); await once(http, "listening");
      const afterRestart = await connect(); assert.equal((await afterRestart.listTools()).tools.length, 6); good(await call(afterRestart, "get_campaign_discovery_context", { contract_version: 1, campaign_id: a.id }));
      // Exact DB grant errors are terminal and never ask the user to reauthenticate.
      await provisionDiscoveryGrant({ ...grantInput, subject: "expiring-synthetic", expires_at: new Date(Date.now() + 500).toISOString() }, database);
      await new Promise(resolve => setTimeout(resolve, 550));
      const expiredGrant = await raw(await token("expiring-synthetic")); assert.equal(expiredGrant.status, 200); const expiredResult = (await expiredGrant.json()).result; assert.equal(expiredResult.structuredContent.error, "grant_expired"); assert.equal(expiredResult.isError, true); assert.equal(expiredResult._meta["mcp/www_authenticate"], undefined);
      await provisionDiscoveryGrant({ ...grantInput, subject: "read-only-grant", scopes: ["discovery:read"] }, database);
      const readonly = await connect(await token("read-only-grant"));
      const missingScope = await call(readonly, "prepare_discovery_run", prepareSample(a.id)); assert.equal((missingScope.structuredContent as Record<string, unknown>).error, "grant_scope_denied"); assert.equal(missingScope._meta?.["mcp/www_authenticate"], undefined);
      await database.update(discoveryMcpGrants).set({ revokedAt: new Date() }).where(eq(discoveryMcpGrants.id, grant.grant_id));
      const revoked = await raw(); assert.equal(revoked.status, 200); const revokedResult = (await revoked.json()).result; assert.equal(revokedResult.structuredContent.error, "grant_revoked"); assert.equal(revokedResult.isError, true); assert.equal(revokedResult._meta["mcp/www_authenticate"], undefined);
      await assert.rejects(connect(), (e: unknown) => !!e && typeof e === "object" && "code" in e && e.code === 403);
      assert.ok(events.some(e => e.correlation_id === correlation)); assert.ok(events.some(e => e.outcome === "database_unavailable" && (e.error?.code || e.error?.cause)));
      // Admission control tested against the real SDK transport, with a deliberately slow check.
      config.maxInFlight = 2;
      const adapter = discoveryMcpAdapter(config, database); adapter.check = async () => { await new Promise(resolve => setTimeout(resolve, 60)); };
      const limited = createAuthorizedMcpHttpServer(config, adapter); limited.listen(0, "127.0.0.1"); await once(limited, "listening");
      try {
        const url = `http://127.0.0.1:${(limited.address() as { port: number }).port}/mcp`;
        config.allowedHost = new URL(url).host;
        const responses = await Promise.all(Array.from({ length: 8 }, () => fetch(url, { method: "POST", headers: { Host: config.allowedHost, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: "{}" })));
        assert.ok(responses.some(r => r.status === 503), JSON.stringify(responses.map(r => r.status)));
        for (const response of responses) if (response.status === 503) { assert.equal((await response.json()).error, "server_busy"); assert.equal(response.headers.get("retry-after"), "1"); }
      } finally { limited.closeAllConnections(); await new Promise<void>(resolve => limited.close(() => resolve())); }
    } finally {
      for (const sdk of clients) await sdk.close().catch(() => {});
      await failingPool.end(); gateway.closeAllConnections(); await new Promise<void>(resolve => gateway.close(() => resolve()));
      http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve()));
      idp.closeAllConnections(); await new Promise<void>(resolve => idp.close(() => resolve()));
    }
  });
});

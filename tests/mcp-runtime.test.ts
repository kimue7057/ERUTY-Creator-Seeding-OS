import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createAuthorizedMcpHttpServer } from "../src/lib/probe/server";
import { probeConfig } from "../src/lib/probe/config";
import type { McpLogEvent } from "../src/lib/probe/diagnostics";

test("SDK tool failures include safe structured diagnostics; serialization and unexpected exceptions retain private stacks", async () => {
  const keys = await generateKeyPair("ES256"), jwk = { ...await exportJWK(keys.publicKey), kid: "runtime-fixture", alg: "ES256" };
  const idp = createServer((_req, res) => res.end(JSON.stringify({ keys: [jwk] })));
  idp.listen(0, "127.0.0.1"); await once(idp, "listening");
  const issuer = `http://127.0.0.1:${(idp.address() as { port: number }).port}/`;
  const config = probeConfig({ NODE_ENV: "test", MCP_RESOURCE_URL: "http://127.0.0.1:3100/mcp", MCP_OAUTH_ISSUER: issuer, MCP_OAUTH_JWKS_URL: `${issuer}jwks`, MCP_PROBE_ORGANIZATION_ID: randomUUID() });
  const events: McpLogEvent[] = [];
  const http = createAuthorizedMcpHttpServer(config, { name: "synthetic-runtime-test", scopes: ["discovery:read"], bodyLimit: 1024,
    tools: [{ name: "test_read", description: "Synthetic test", schema: z.strictObject({ mode: z.string() }), scopes: ["discovery:read"], readOnly: true }],
    check: async () => {}, call: async (_identity, _name, args) => {
      const mode = (args as { mode: string }).mode;
      if (mode === "serialize") return { invalid: BigInt(1) };
      if (mode === "exception") throw new Error("private-person@example.invalid password=NEVER_LOG_ME");
      if (mode === "database") throw new Error("Failed query: PRIVATE_PARAMETERS", { cause: Object.assign(new Error("private row"), { code: "23505" }) });
      return { success: true };
    },
  }, event => events.push(event));
  http.listen(0, "127.0.0.1"); await once(http, "listening");
  config.resource = `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`; config.allowedHost = new URL(config.resource).host;
  const token = await new SignJWT({ scope: "discovery:read" }).setProtectedHeader({ alg: "ES256", kid: jwk.kid }).setSubject("synthetic").setIssuer(issuer).setAudience(config.resource).setIssuedAt().setExpirationTime("5m").sign(keys.privateKey);
  const sdk = new Client({ name: "local-not-hosted-work", version: "1" });
  try {
    await sdk.connect(new StreamableHTTPClientTransport(new URL(config.resource), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    assert.equal((await sdk.listTools()).tools[0].outputSchema?.type, "object");
    for (const [mode, code, layer] of [["serialize", "internal_error", "serialization"], ["exception", "internal_error", "tool"], ["database", "database_error", "database"]]) {
      const result = await sdk.callTool({ name: "test_read", arguments: { mode } });
      const data = result.structuredContent as Record<string, unknown>;
      assert.equal(result.isError, true); assert.equal(data.error, code); assert.equal(data.layer, layer); assert.ok(z.uuid().safeParse(data.request_id).success);
      assert.equal(data.request_id, result._meta?.request_id);
    }
    const log = JSON.stringify(events); assert.ok(log.includes("mcp-runtime.test.ts"));
    for (const secret of ["private-person", "NEVER_LOG_ME", "PRIVATE_PARAMETERS", "private row"]) assert.equal(log.includes(secret), false);
    assert.equal((await sdk.callTool({ name: "test_read", arguments: { mode: "normal" } })).isError, undefined);
  } finally { await sdk.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); idp.closeAllConnections(); await new Promise<void>(resolve => idp.close(() => resolve())); }
});

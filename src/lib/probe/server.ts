import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema, SUPPORTED_PROTOCOL_VERSIONS, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ProbeConfig } from "./config";
import { probeAuthenticator } from "./auth";
import { probeService } from "./service";
import { capabilitiesInput, writeProbeInput, readProbeInput, ProbeError, PROBE_SCOPES, type ProbeIdentity } from "./contracts";
import { DiscoveryError } from "../discovery/contracts";

export function createProbeHttpServer(config: ProbeConfig, log: (event: { request_id: string; outcome: string }) => void = () => {}, service = probeService(config.organizationId, config.build)) {
  return createAuthorizedMcpHttpServer(config, {
    name: "eruty-discovery-probe", scopes: PROBE_SCOPES, bodyLimit: 4096, check: service.check,
    tools: [
      { name: "eruty_capabilities", description: "Read the authorized synthetic sandbox scope and server build. Work connectivity remains unverified.", schema: capabilitiesInput, scopes: ["discovery:read"], readOnly: true },
      { name: "write_discovery_probe", description: "Persist one synthetic UUID nonce with an idempotency UUID and an audit receipt in the authorized test sandbox. Does not discover creators or start Work.", schema: writeProbeInput, scopes: ["discovery:read", "discovery:probe"], readOnly: false },
      { name: "read_discovery_probe", description: "Read back a persisted probe owned by the current authorized principal and audit the read.", schema: readProbeInput, scopes: ["discovery:read"], readOnly: true },
    ],
    async call(identity, name, args, requestId) {
      if (name === "eruty_capabilities") return { ...await service.capabilities(identity, args), transport: "streamable-http-stateless-json", protocol_versions: SUPPORTED_PROTOCOL_VERSIONS, authentication: "oauth-resource-jwt" };
      if (name === "write_discovery_probe") return service.write(identity, args, requestId);
      if (name === "read_discovery_probe") return service.read(identity, args);
      throw new ProbeError(404, "unknown_tool");
    },
  }, log);
}
export type McpAdapter = {
  name: string; scopes: readonly string[]; bodyLimit: number;
  tools: { name: string; description: string; schema: z.ZodType; scopes: readonly string[]; readOnly: boolean }[];
  check: (identity: ProbeIdentity) => Promise<void>;
  call: (identity: ProbeIdentity, name: string, args: unknown, requestId: string) => Promise<Record<string, unknown>>;
};
export function createAuthorizedMcpHttpServer(config: ProbeConfig, adapter: McpAdapter, log: (event: { request_id: string; outcome: string }) => void = () => {}) {
  const authenticate = probeAuthenticator(config);
  const challenge = (error = "invalid_token") => `Bearer resource_metadata="${config.metadataUrl}", scope="${adapter.scopes.join(" ")}", error="${error}", error_description="ERUTY authorization required"`;
  const domainError = (error: unknown) => error instanceof ProbeError || error instanceof DiscoveryError ? error : null;
  function mcp(identity: ProbeIdentity, requestId: string) {
    const server = new Server({ name: adapter.name, version: "0.1.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      await adapter.check(identity);
      return { tools: adapter.tools.map(tool => ({
        name: tool.name, description: tool.description,
        inputSchema: z.toJSONSchema(tool.schema, { io: "input" }) as { type: "object" },
        annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        securitySchemes: [{ type: "oauth2", scopes: [...tool.scopes] }],
        _meta: { securitySchemes: [{ type: "oauth2", scopes: [...tool.scopes] }] },
      })) };
    });
    server.setRequestHandler(CallToolRequestSchema, async ({ params }): Promise<CallToolResult> => {
      try {
        if (!adapter.tools.some(tool => tool.name === params.name)) throw new ProbeError(404, "unknown_tool");
        const result = await adapter.call(identity, params.name, params.arguments, requestId);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        const exposed = domainError(error);
        const code = exposed?.code ?? (error instanceof z.ZodError ? "invalid_input" : "request_failed");
        log({ request_id: requestId, outcome: code });
        return { isError: true, content: [{ type: "text", text: code }],
          ...(exposed && [401, 403].includes(exposed.status) ? { _meta: { "mcp/www_authenticate": [challenge(code === "insufficient_scope" ? code : "invalid_token")] } } : {}),
        };
      }
    });
    return server;
  }
  function json(res: ServerResponse, status: number, body: unknown) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); }
  async function body(req: IncomingMessage) {
    const bytes: Buffer[] = []; let length = 0;
    await new Promise<void>((resolve, reject) => {
      let failed = false;
      req.on("data", (chunk: Buffer) => {
        if (failed) return;
        length += chunk.length;
        if (length > adapter.bodyLimit) { failed = true; reject(new ProbeError(413, "body_too_large")); return; }
        bytes.push(chunk);
      });
      req.on("end", resolve); req.on("error", () => reject(new ProbeError(400, "incomplete_request"))); req.on("aborted", () => reject(new ProbeError(400, "incomplete_request")));
    });
    try { return JSON.parse(Buffer.concat(bytes).toString("utf8")); } catch { throw new ProbeError(400, "invalid_json"); }
  }
  let inFlight = 0;
  const http = createServer({ maxHeaderSize: 16_384, requestTimeout: 10_000, headersTimeout: 10_000, keepAliveTimeout: 5000 }, async (req, res) => {
    const requestId = randomUUID();
    res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("X-Request-Id", requestId);
    res.on("close", () => { inFlight--; }); inFlight++;
    try {
      if (inFlight > 32) throw new ProbeError(503, "server_busy");
      if (req.headers.host !== config.allowedHost) throw new ProbeError(403, "invalid_host");
      const origin = req.headers.origin;
      if (origin && !config.allowedOrigins.has(origin)) throw new ProbeError(403, "invalid_origin");
      if (origin) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
      const path = req.url;
      if (path === "/.well-known/oauth-protected-resource/mcp" || path === "/.well-known/oauth-protected-resource") {
        if (req.method !== "GET") throw new ProbeError(405, "method_not_allowed");
        json(res, 200, { resource: config.resource, authorization_servers: [config.issuer], scopes_supported: adapter.scopes, bearer_methods_supported: ["header"] }); return;
      }
      if (path !== "/mcp") throw new ProbeError(404, "not_found");
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, MCP-Protocol-Version"); res.writeHead(204); res.end(); return;
      }
      const identity = await authenticate(req.headers.authorization);
      await adapter.check(identity);
      if (req.method !== "POST") { res.setHeader("Allow", "POST, OPTIONS"); throw new ProbeError(405, "method_not_allowed"); }
      if ((req.headers["content-type"] ?? "").split(";")[0].trim() !== "application/json") throw new ProbeError(415, "json_required");
      if (Number(req.headers["content-length"] ?? 0) > adapter.bodyLimit) throw new ProbeError(413, "body_too_large");
      const parsed = await body(req);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ProbeError(400, "single_request_required");
      const server = mcp(identity, requestId);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, enableDnsRebindingProtection: true, allowedHosts: [config.allowedHost], allowedOrigins: [...config.allowedOrigins] });
      res.on("close", () => { void server.close().catch(() => {}); });
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
      log({ request_id: requestId, outcome: "handled" });
    } catch (error) {
      const code = domainError(error)?.code ?? "request_failed";
      const status = domainError(error)?.status ?? 503;
      log({ request_id: requestId, outcome: code });
      if (!res.headersSent && !res.destroyed) {
        if (status === 401 || status === 403 && code === "insufficient_scope") res.setHeader("WWW-Authenticate", challenge(code === "insufficient_scope" ? code : "invalid_token"));
        json(res, status, { error: code, request_id: requestId });
      } else if (!res.writableEnded) res.end();
    }
  });
  http.maxConnections = 64;
  http.setTimeout(15_000, socket => socket.destroy());
  return http;
}

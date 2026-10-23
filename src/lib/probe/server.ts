import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema, SUPPORTED_PROTOCOL_VERSIONS, McpError, ErrorCode, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ProbeConfig } from "./config";
import { probeAuthenticator } from "./auth";
import { probeService } from "./service";
import { capabilitiesInput, writeProbeInput, readProbeInput, ProbeError, PROBE_SCOPES, type ProbeIdentity } from "./contracts";
import { diagnosticProtocolVersion, privateError, safeFailure, type McpLayer, type McpLogger } from "./diagnostics";

export function createProbeHttpServer(config: ProbeConfig, log: McpLogger = () => {}, service = probeService(config.organizationId, config.build)) {
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
export function createAuthorizedMcpHttpServer(config: ProbeConfig, adapter: McpAdapter, log: McpLogger = () => {}) {
  const authenticate = probeAuthenticator(config);
  const challenge = (error = "invalid_token") => `Bearer resource_metadata="${config.metadataUrl}", scope="${adapter.scopes.join(" ")}", error="${error}", error_description="ERUTY authorization required"`;
  const emit: McpLogger = event => { try { log(event); } catch { /* Logging cannot roll back or duplicate a committed write. */ } };
  function mcp(identity: ProbeIdentity, requestId: string, correlationId: string) {
    const server = new Server({ name: adapter.name, version: "0.1.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      try {
        await adapter.check(identity);
        return { tools: adapter.tools.map(tool => ({
        name: tool.name, description: tool.description,
        inputSchema: z.toJSONSchema(tool.schema, { io: "input" }) as { type: "object" },
        outputSchema: { type: "object" as const, additionalProperties: true },
        annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        securitySchemes: [{ type: "oauth2", scopes: [...tool.scopes] }],
        _meta: { securitySchemes: [{ type: "oauth2", scopes: [...tool.scopes] }] },
        })) };
      } catch (error) {
        const failure = safeFailure(error);
        emit({ at: new Date().toISOString(), request_id: requestId, correlation_id: correlationId, layer: failure.layer, outcome: failure.code, error: privateError(error) });
        throw new McpError(ErrorCode.InternalError, failure.code, { request_id: requestId, correlation_id: correlationId, retryable: failure.retryable, layer: failure.layer, recovery: failure.recovery });
      }
    });
    server.setRequestHandler(CallToolRequestSchema, async ({ params }): Promise<CallToolResult> => {
      const started = performance.now(); let layer: McpLayer = "tool";
      const tool = adapter.tools.find(tool => tool.name === params.name);
      try {
        if (!tool) throw new ProbeError(404, "unknown_tool");
        emit({ at: new Date().toISOString(), request_id: requestId, correlation_id: correlationId, layer, tool: tool.name, outcome: "started" });
        await adapter.check(identity);
        const result = await adapter.call(identity, params.name, params.arguments, requestId);
        layer = "serialization";
        // Check serialization here, before the SDK writes the response. Replays retain the original receipt request_id.
        const text = JSON.stringify(result);
        if (!text || !result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid structured result");
        const wire = JSON.parse(text) as Record<string, unknown>;
        emit({ at: new Date().toISOString(), request_id: requestId, correlation_id: correlationId, layer: "tool", tool: tool.name, outcome: "success", duration_ms: Math.round(performance.now() - started) });
        return { content: [{ type: "text", text }], structuredContent: wire, _meta: { request_id: requestId, correlation_id: correlationId } };
      } catch (error) {
        const failure = safeFailure(error);
        const failedLayer = layer === "serialization" ? layer : failure.layer;
        const result = { error: failure.code, status: failure.status, request_id: requestId, correlation_id: correlationId, layer: failedLayer, retryable: failure.retryable, recovery: failure.recovery };
        emit({ at: new Date().toISOString(), request_id: requestId, correlation_id: correlationId, layer: failedLayer, tool: tool?.name, outcome: failure.code, error: privateError(error), duration_ms: Math.round(performance.now() - started) });
        return { isError: true, content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result,
          _meta: { request_id: requestId, correlation_id: correlationId, ...(failure.reauthenticate ? { "mcp/www_authenticate": [challenge(failure.code === "insufficient_scope" ? failure.code : "invalid_token")] } : {}) } };
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
    const incoming = req.headers["x-correlation-id"] ?? req.headers["x-request-id"];
    const correlationId = typeof incoming === "string" && z.uuid().safeParse(incoming).success ? incoming : requestId;
    const started = performance.now(); let layer: McpLayer = "http"; let rpcMethod: string | undefined;
    res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("X-Request-Id", requestId);
    res.setHeader("X-Correlation-Id", correlationId);
    emit({ at: new Date().toISOString(), request_id: requestId, correlation_id: correlationId, layer, outcome: "received" });
    res.on("close", () => { inFlight--; }); inFlight++;
    try {
      if (inFlight > config.maxInFlight) throw new ProbeError(503, "server_busy");
      if (req.headers.host !== config.allowedHost) throw new ProbeError(403, "invalid_host");
      const origin = req.headers.origin;
      if (origin && !config.allowedOrigins.has(origin)) throw new ProbeError(403, "invalid_origin");
      if (origin) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
      const path = req.url;
      // Private gateways intentionally do not forward this process-only liveness endpoint.
      if (path === "/healthz" && req.method === "GET") { json(res, 200, { status: "live", service: adapter.name, build: config.build }); return; }
      if (path === new URL(config.metadataUrl).pathname || path === "/.well-known/oauth-protected-resource/mcp" || path === "/.well-known/oauth-protected-resource") {
        if (req.method !== "GET") throw new ProbeError(405, "method_not_allowed");
        json(res, 200, { resource: config.resource, authorization_servers: [config.issuer], scopes_supported: adapter.scopes, bearer_methods_supported: ["header"] }); return;
      }
      if (path !== "/mcp") throw new ProbeError(404, "not_found");
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, MCP-Protocol-Version, X-Correlation-Id"); res.writeHead(204); res.end(); return;
      }
      layer = "authentication";
      const identity = await authenticate(req.headers.authorization);
      layer = "http";
      if (req.method !== "POST") { res.setHeader("Allow", "POST, OPTIONS"); throw new ProbeError(405, "method_not_allowed"); }
      if ((req.headers["content-type"] ?? "").split(";")[0].trim() !== "application/json") throw new ProbeError(415, "json_required");
      if (Number(req.headers["content-length"] ?? 0) > adapter.bodyLimit) throw new ProbeError(413, "body_too_large");
      const parsed = await body(req);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ProbeError(400, "single_request_required");
      rpcMethod = typeof parsed.method === "string" && ["initialize", "notifications/initialized", "tools/list", "tools/call", "ping", "server/discover"].includes(parsed.method) ? parsed.method : undefined;
      // A valid tools/call gets a protocol-level isError result for grant/DB/domain failures.
      // Initialize and discovery still require a current grant before revealing the tool list.
      if (rpcMethod !== "tools/call") { layer = "authorization"; await adapter.check(identity); }
      layer = "transport";
      const server = mcp(identity, requestId, correlationId);
      const protocolVersion = diagnosticProtocolVersion(req.headers["mcp-protocol-version"]);
      // Modern clients may probe before selecting our supported legacy handshake.
      // Keep the SDK's HTTP/version validation intact; this is not support for MCP 2.0.
      const legacyProbe = parsed.jsonrpc === "2.0" && ["string", "number"].includes(typeof parsed.id) && rpcMethod === "server/discover" && protocolVersion !== undefined && protocolVersion !== "invalid" && !SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion);
      let rejectedProbe = false;
      server.onerror = error => emit({ at: new Date().toISOString(), request_id: requestId, correlation_id: correlationId, layer: "transport", rpc_method: rpcMethod, protocol_version: protocolVersion,
        outcome: (rejectedProbe = legacyProbe && error.message.startsWith("Bad Request: Unsupported protocol version:")) ? "protocol_probe_rejected" : "sdk_error", error: privateError(error) });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, enableDnsRebindingProtection: true, allowedHosts: [config.allowedHost], allowedOrigins: [...config.allowedOrigins] });
      res.on("close", () => { void server.close().catch(() => {}); });
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
      emit({ at: new Date().toISOString(), request_id: requestId, correlation_id: correlationId, layer, rpc_method: rpcMethod, protocol_version: protocolVersion, outcome: rejectedProbe && res.statusCode === 400 ? "protocol_probe_rejected" : "handled", status: res.statusCode, duration_ms: Math.round(performance.now() - started) });
    } catch (error) {
      const failure = safeFailure(error), { code, status } = failure;
      if (failure.layer === "database") layer = "database";
      emit({ at: new Date().toISOString(), request_id: requestId, correlation_id: correlationId, layer, rpc_method: rpcMethod, outcome: code, status, error: privateError(error), duration_ms: Math.round(performance.now() - started) });
      if (!res.headersSent && !res.destroyed) {
        if (failure.reauthenticate) res.setHeader("WWW-Authenticate", challenge(code === "insufficient_scope" ? code : "invalid_token"));
        if (failure.retryable) res.setHeader("Retry-After", "1");
        json(res, status, { error: code, request_id: requestId, correlation_id: correlationId, layer, retryable: failure.retryable, recovery: failure.recovery });
      } else if (!res.writableEnded) res.end();
    }
  });
  http.maxConnections = 64;
  http.setTimeout(15_000, socket => socket.destroy());
  return http;
}

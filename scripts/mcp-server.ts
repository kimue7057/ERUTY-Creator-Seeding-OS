import "dotenv/config";
import { createProbeHttpServer } from "../src/lib/probe/server";
import { probeConfig } from "../src/lib/probe/config";
import { pool } from "../src/lib/db";
import { createDiscoveryHttpServer } from "../src/lib/discovery/mcp";
import { discoveryMcpConfig } from "../src/lib/discovery/mcp-access";
import { assertDiscoveryRuntimeRole } from "../src/lib/discovery/runtime-role";
import { privateError, type McpLogger } from "../src/lib/probe/diagnostics";
try {
  const mode = process.env.MCP_SERVER_MODE ?? "probe";
  if (!["probe", "discovery"].includes(mode)) throw new Error("Invalid MCP mode");
  const config = mode === "discovery" ? discoveryMcpConfig() : probeConfig();
  if (mode === "discovery" && process.env.NODE_ENV === "production") await assertDiscoveryRuntimeRole(pool);
  const log: McpLogger = event => console.log(JSON.stringify(event));
  const server = mode === "discovery" ? createDiscoveryHttpServer(discoveryMcpConfig(), log) : createProbeHttpServer(config, log);
  server.listen(config.port, config.bindHost, () => console.log(`ERUTY ${mode} MCP listening; hosted Work/SNS connection remains unverified.`));
  server.on("error", error => { console.error(JSON.stringify({ at: new Date().toISOString(), layer: "lifecycle", outcome: "listen_failed", error: privateError(error) })); process.exitCode = 1; void pool.end(); });
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
    if (stopping) return; stopping = true;
    server.close(() => { void pool.end().then(() => process.exit(0)); });
    server.closeIdleConnections();
    setTimeout(() => { server.closeAllConnections(); }, 10_000).unref();
  });
} catch (error) { console.error(JSON.stringify({ at: new Date().toISOString(), layer: "lifecycle", outcome: "startup_failed", error: privateError(error) })); await pool.end(); process.exitCode = 1; }

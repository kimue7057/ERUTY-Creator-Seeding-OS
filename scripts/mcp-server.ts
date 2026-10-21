import "dotenv/config";
import { createProbeHttpServer } from "../src/lib/probe/server";
import { probeConfig } from "../src/lib/probe/config";
import { pool } from "../src/lib/db";
try {
  const config = probeConfig();
  const server = createProbeHttpServer(config, event => console.log(JSON.stringify(event)));
  server.listen(config.port, config.bindHost, () => console.log("ERUTY synthetic probe MCP listening; hosted Work connection remains unverified."));
  server.on("error", () => { console.error("Probe server could not listen."); process.exitCode = 1; void pool.end(); });
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
    if (stopping) return; stopping = true;
    server.close(() => { void pool.end().then(() => process.exit(0)); });
    server.closeIdleConnections();
    setTimeout(() => { server.closeAllConnections(); }, 10_000).unref();
  });
} catch { console.error("Probe configuration is missing or invalid. See DISCOVERY-PROBE-01.md. No service started."); await pool.end(); process.exitCode = 1; }

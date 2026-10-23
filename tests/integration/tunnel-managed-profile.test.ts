import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import { managedOAuthEnvironment, persistentOAuthRouting } from "../../scripts/lib/tunnel-profile";

test("official managed Connect regenerates YAML; durable launch inputs survive two fresh managed processes (not hosted Work)", { skip: !process.env.MCP_VENDOR_TUNNEL_BIN, timeout: 60000 }, async () => {
  const binary = resolve(process.env.MCP_VENDOR_TUNNEL_BIN!);
  const directory = resolve(".local/discovery", "managed-test-" + randomUUID());
  mkdirSync(directory, { recursive: true });
  const backend = createServer((req, res) => { req.resume(); res.writeHead(req.url === "/mcp" ? 401 : 404).end(); });
  backend.listen(0, "127.0.0.1"); await once(backend, "listening");
  const target = `http://127.0.0.1:${(backend.address() as { port: number }).port}/mcp`;
  const log = openSync(directory + "/proxy.private.log", "a", 0o600), file = directory + "/proxy.json";
  // Public fixture key defined by the vendor's loopback-only dev proxy.
  const env = { ...process.env, TUNNEL_CLIENT_STATE_DIR: directory + "/state", CONTROL_PLANE_API_KEY: "local-tunnel-client-dev-proxy", LOG_HTTP_RAW_UNSAFE: "false", HARPOON_ALLOW_PLAINTEXT_HTTP: "true" };
  const proxy = spawn(binary, ["dev", "proxy", "--backend", "go", "--listen", "127.0.0.1:0", "--mcp-server-url", target, "--url-file", file, "--duration", "60s", "--readiness-timeout", "10s"], { env, stdio: ["ignore", log, log], windowsHide: true });
  const execute = promisify(execFile), alias = "synthetic-managed-profile";
  const run = async (args: string[], launchEnv = env) => {
    try { const result = await execute(binary, args, { env: launchEnv, windowsHide: true, timeout: 15000 }); return JSON.parse(result.stdout); }
    catch (error) {
      const result = error as { stdout?: string; stderr?: string };
      writeFileSync(directory + "/command.private.log", (result.stdout ?? "") + (result.stderr ?? ""), { mode: 0o600 });
      throw new Error("Managed command failed; inspect private synthetic test report", { cause: error });
    }
  };
  try {
    let connection;
    for (let i = 0; i < 100 && !connection && proxy.exitCode === null; i++) {
      if (existsSync(file)) { try { connection = JSON.parse(readFileSync(file, "utf8")); } catch {} }
      if (!connection) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(connection, "Official local dev proxy must become ready");
    const profileDir = directory + "/profiles"; mkdirSync(profileDir);
    let priorInstance = "";
    for (let iteration = 0; iteration < 2; iteration++) {
      const profile = persistentOAuthRouting({ control_plane: { tunnel_id: connection.tunnel_id, api_key: "env:CONTROL_PLANE_API_KEY" }, mcp: { server_urls: [{ channel: "main", url: target }] } }, connection.tunnel_id, target, "https://issuer.example.invalid/realms/test");
      writeFileSync(`${profileDir}/${alias}.yaml`, JSON.stringify(profile), { mode: 0o600 });
      const launchEnv = { ...env, ...managedOAuthEnvironment(profile) };
      if (iteration) await run(["runtimes", "--json", "stop", alias], launchEnv);
      await run(["runtimes", "--json", "--control-plane-base-url", connection.control_plane_base_url, "connect", "--alias", alias, "--profile", alias, "--profile-dir", profileDir, "--tunnel-id", connection.tunnel_id, "--mcp-server-url", target, "--runtime-api-key", "env:CONTROL_PLANE_API_KEY"], launchEnv);
      const generated = JSON.parse(readFileSync(`${profileDir}/${alias}.yaml`, "utf8"));
      assert.equal(generated.control_plane.tunnel_id, connection.tunnel_id);
      assert.equal(generated.mcp.oauth_trusted_origins, undefined, "Regression exercises the real vendor profile replacement");
      const base = readFileSync(`${directory}/state/health/${alias}.url`, "utf8").trim();
      let health;
      for (let i = 0; i < 50; i++) {
        health = await (await fetch(base + "/health?details=true")).json();
        if (health.ready) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      writeFileSync(`${directory}/health-${iteration}.json`, JSON.stringify(health), { mode: 0o600 });
      assert.equal(health.live, true); assert.equal(health.ready, true);
      assert.notEqual(health.runtime.instance_id, priorInstance); priorInstance = health.runtime.instance_id;
      const targets = await (await fetch(base + "/api/harpoon/targets")).json();
      assert.ok(targets.targets.some((t: { label: string; url: string; source: string }) => t.label === "eruty-oauth" && t.url === "https://issuer.example.invalid" && t.source === "config"));
      const status = await (await fetch(base + "/api/harpoon/status")).json();
      assert.equal(status.capture_payloads, false);
    }
  } finally {
    await run(["runtimes", "--json", "stop", alias]).catch(() => {});
    proxy.kill(); closeSync(log); backend.closeAllConnections(); await new Promise<void>(done => backend.close(() => done()));
  }
});

import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { parse } from "dotenv";
import { managedOAuthEnvironment, persistentOAuthRouting } from "./lib/tunnel-profile";
try {
  const mode = process.argv[2];
  if (mode !== "probe" && mode !== "discovery") throw new Error("Select probe or discovery");
  const directory = mode === "discovery" ? ".local/discovery" : ".local/mcp-local-e2e";
  const connection = JSON.parse(readFileSync(`${directory}/connection.json`, "utf8"));
  const env = parse(readFileSync(mode === "discovery" ? `${directory}/operator.env` : ".local/mcp-staging/.env", "utf8"));
  const path = `${directory}/profiles/${connection.profile}.yaml`;
  // Our generated profiles are JSON (valid YAML). Refuse to rewrite an unfamiliar YAML file.
  const before = readFileSync(path, "utf8");
  const updated = persistentOAuthRouting(JSON.parse(before), connection.tunnel_id, connection.target, env.MCP_OAUTH_ISSUER);
  const after = JSON.stringify(updated, null, 2) + "\n";
  if (JSON.stringify(JSON.parse(before)) !== JSON.stringify(updated)) {
    copyFileSync(path, `${path}.before-routing-${Date.now()}`);
    writeFileSync(path, after, { mode: 0o600 });
  }
  const runtimeEnvironment = managedOAuthEnvironment(updated);
  writeFileSync(`${directory}/profiles/${connection.profile}.routing.json`, JSON.stringify(runtimeEnvironment, null, 2) + "\n", { mode: 0o600 });
  if (process.argv[3] === "--verify-runtime") {
    const urlFile = (updated.health as { url_file?: string } | undefined)?.url_file;
    if (!urlFile) throw new Error("Missing managed health URL file");
    const base = new URL(readFileSync(urlFile, "utf8").trim());
    if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new Error("Invalid loopback health URL");
    const get = async (path: string) => {
      const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(2000), redirect: "error" });
      if (!response.ok) throw new Error("Managed health unavailable");
      return response.json();
    };
    let verified = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const [health, oauth, targets, capture, status] = await Promise.all([get("/health?details=true"), get("/api/oauth"), get("/api/harpoon/targets"), get("/api/harpoon/status"), get("/api/status")]);
      verified = health.live === true && health.ready === true && status.control_plane_tunnel_id === connection.tunnel_id && status.mcp_server_url === connection.target && status.raw_http_logging_enabled === false && !oauth.error && oauth.selected_authorization_server === env.MCP_OAUTH_ISSUER && capture.capture_payloads === false && targets.targets.some((t: { label: string; url: string; source: string }) => t.label === "eruty-oauth" && t.url === new URL(env.MCP_OAUTH_ISSUER).origin && t.source === "config");
      if (verified) {
        const receipt = { at: new Date().toISOString(), mode, tunnel_id: connection.tunnel_id, instance_id: health.runtime.instance_id, started_at: health.runtime.started_at, live: true, ready: true, issuer: oauth.selected_authorization_server, metadata_source: oauth.metadata_source, configured_issuer_route: true, capture_payloads: false, hosted_work_verified: false };
        writeFileSync(`${directory}/tunnel-routing-verification.json`, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
        console.log(JSON.stringify(receipt)); break;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!verified) throw new Error("Managed OAuth readiness or effective routing mismatch");
  } else console.log(JSON.stringify(process.argv[3] === "--runtime-environment" ? runtimeEnvironment : { mode, profile: connection.profile, issuer_origin: new URL(env.MCP_OAUTH_ISSUER).origin, routing: "prepared_for_managed_launch", credentials_printed: false }));
} catch { console.error("Tunnel profile validation failed. Existing identity, target and secrets must be preserved; inspect the private profile and issuer configuration."); process.exitCode = 1; }

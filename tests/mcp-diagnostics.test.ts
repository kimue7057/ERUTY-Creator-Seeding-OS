import { test } from "node:test";
import assert from "node:assert/strict";
import { privateError, redactDiagnostic, safeFailure } from "../src/lib/probe/diagnostics";
import { DiscoveryError } from "../src/lib/discovery/contracts";
import { persistentOAuthRouting } from "../scripts/lib/tunnel-profile";

test("private diagnostics retain actual frames and driver causes without SQL, parameters, credentials or PII", () => {
  const secrets = ["private-query-value", "person@example.invalid", "Bearer TOPSECRET", "postgres://u:password@db/private", "sk-SECRETKEYVALUE"];
  const cause = Object.assign(new Error(secrets.join(" ")), { code: "ECONNREFUSED", query: secrets, params: secrets });
  const error = new Error("Failed query: " + secrets.join(" "), { cause });
  const output = JSON.stringify(privateError(error));
  assert.ok(output.includes("mcp-diagnostics.test.ts")); assert.ok(output.includes("ECONNREFUSED"));
  for (const secret of secrets) assert.equal(output.includes(secret), false);
  assert.equal(redactDiagnostic(secrets.join(" ")).includes("TOPSECRET"), false);
  assert.equal(safeFailure(error).code, "database_unavailable");
  for (const [code, expected] of [["57014", "database_timeout"], ["40001", "transaction_retry_required"], ["23505", "database_error"]]) assert.equal(safeFailure({ cause: { code } }).code, expected);
  assert.equal(safeFailure(new DiscoveryError(403, "grant_expired")).retryable, false);
});
test("managed tunnel restart reads durable issuer routing and never changes tunnel identity or secrets", () => {
  const profile = { control_plane: { tunnel_id: "tunnel_fixture", api_key: "env:RUNTIME_KEY" }, mcp: { server_urls: [{ channel: "main", url: "http://127.0.0.1:3311/mcp" }] } };
  const result = persistentOAuthRouting(profile, "tunnel_fixture", "http://127.0.0.1:3311/mcp", "https://auth.example.invalid/realms/test");
  assert.deepEqual(result.mcp.oauth_trusted_origins, ["https://auth.example.invalid"]);
  assert.equal(result.control_plane, profile.control_plane); assert.equal(result.harpoon.capture_payloads, false);
  assert.deepEqual(persistentOAuthRouting(result, "tunnel_fixture", "http://127.0.0.1:3311/mcp", "https://auth.example.invalid/realms/test"), result);
  assert.throws(() => persistentOAuthRouting(profile, "wrong-tunnel", "http://127.0.0.1:3311/mcp", "https://auth.example.invalid/"));
});

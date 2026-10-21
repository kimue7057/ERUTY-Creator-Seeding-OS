import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { capabilitiesInput, writeProbeInput, readProbeInput, probeHash } from "../src/lib/probe/contracts";
import { probeConfig } from "../src/lib/probe/config";
const env = { NODE_ENV: "test", MCP_RESOURCE_URL: "http://127.0.0.1:3100/mcp", MCP_OAUTH_ISSUER: "http://127.0.0.1:3200/", MCP_OAUTH_JWKS_URL: "http://127.0.0.1:3200/jwks", MCP_PROBE_ORGANIZATION_ID: randomUUID() };
test("probe inputs accept only synthetic UUIDs and reject client-controlled tenant, actor, status and extra data", () => {
  const valid = { contract_version: 1, nonce: randomUUID(), idempotency_key: randomUUID() };
  assert.ok(writeProbeInput.safeParse(valid).success);
  for (const field of ["organization_id", "actor_id", "project_id", "work_verified", "note"]) assert.equal(writeProbeInput.safeParse({ ...valid, [field]: "untrusted" }).success, false);
  assert.equal(writeProbeInput.safeParse({ ...valid, nonce: "real-profile-or-secret" }).success, false);
  assert.equal(writeProbeInput.safeParse({ ...valid, contract_version: 2 }).success, false);
  assert.ok(capabilitiesInput.safeParse({ contract_version: 1 }).success);
  assert.equal(readProbeInput.safeParse({ contract_version: 1, probe_id: "bad" }).success, false);
});
test("probe hash is deterministic, nonce-specific and excludes retry/request metadata", () => {
  const nonce = randomUUID(); assert.equal(probeHash(nonce), probeHash(nonce));
  assert.equal(probeHash(nonce.toUpperCase()), probeHash(nonce));
  assert.match(probeHash(nonce), /^[a-f0-9]{64}$/); assert.notEqual(probeHash(nonce), probeHash(randomUUID()));
});
test("probe deployment configuration fails closed for public HTTP, remote development bind, JWKS redirect origins and credentials", () => {
  assert.equal(probeConfig(env).bindHost, "127.0.0.1");
  for (const change of [{ NODE_ENV: "production" }, { MCP_RESOURCE_URL: "http://example.invalid/mcp" }, { MCP_RESOURCE_URL: "https://user:pass@example.invalid/mcp" }, { MCP_BIND_HOST: "0.0.0.0" }, { MCP_OAUTH_JWKS_URL: "https://other.invalid/keys" }, { MCP_RESOURCE_URL: "http://127.0.0.1:3100/mcp?token=bad" }, { MCP_ALLOWED_ORIGINS: "https://chatgpt.com/some/path" }]) assert.throws(() => probeConfig({ ...env, ...change }));
  const production = probeConfig({ ...env, NODE_ENV: "production", MCP_RESOURCE_URL: "https://probe.example.invalid/mcp", MCP_OAUTH_ISSUER: "https://auth.example.invalid/", MCP_OAUTH_JWKS_URL: "https://auth.example.invalid/keys", MCP_BIND_HOST: "0.0.0.0", MCP_ALLOW_REMOTE_BIND: "true" });
  assert.equal(production.bindHost, "0.0.0.0");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { discoveryMcpConfig, discoveryEnvironmentHash } from "../src/lib/discovery/mcp-config";
const env = { NODE_ENV: "production", MCP_RESOURCE_URL: "https://discovery.example.invalid/mcp", MCP_OAUTH_ISSUER: "https://auth.example.invalid/", MCP_OAUTH_JWKS_URL: "https://auth.example.invalid/jwks", MCP_DISCOVERY_ORGANIZATION_ID: randomUUID(), MCP_DISCOVERY_ALLOW_SYNTHETIC: "true", MCP_BUILD_SHA: "d15c0a1" };
test("discovery mode needs a dedicated organization and reviewed build; production never accepts synthetic source", () => {
  const config = discoveryMcpConfig(env);
  assert.equal(config.allowSyntheticDiscovery, false);
  assert.equal(config.operatingApprovalsEnabled, false);
  assert.notEqual(discoveryEnvironmentHash(config), discoveryEnvironmentHash(discoveryMcpConfig({ ...env, MCP_DISCOVERY_OPERATING_APPROVALS: "true" })));
  assert.throws(() => discoveryMcpConfig({ ...env, MCP_DISCOVERY_ORGANIZATION_ID: undefined }));
  assert.throws(() => discoveryMcpConfig({ ...env, MCP_BUILD_SHA: undefined }));
  assert.notEqual(discoveryEnvironmentHash(config), discoveryEnvironmentHash({ ...config, build: "d15c0a2" }));
  assert.notEqual(discoveryEnvironmentHash(config), discoveryEnvironmentHash({ ...config, resource: "https://other.example.invalid/mcp" }));
});

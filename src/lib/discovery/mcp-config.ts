import { z } from "zod";
import { probeConfig, type ProbeConfig } from "../probe/config";
import { discoveryHash } from "./contracts";
export const DISCOVERY_SCOPES = ["discovery:read", "discovery:observe", "discovery:submit"] as const;
export type DiscoveryMcpConfig = ProbeConfig & { allowSyntheticDiscovery: boolean; operatingApprovalsEnabled: boolean };
export function discoveryMcpConfig(env: Record<string, string | undefined> = process.env): DiscoveryMcpConfig {
  const organizationId = z.uuid().parse(env.MCP_DISCOVERY_ORGANIZATION_ID);
  z.string().regex(/^[a-f0-9]{7,40}$/).parse(env.MCP_BUILD_SHA);
  return { ...probeConfig({ ...env, MCP_PROBE_ORGANIZATION_ID: organizationId }), allowSyntheticDiscovery: env.NODE_ENV !== "production" && env.MCP_DISCOVERY_ALLOW_SYNTHETIC === "true", operatingApprovalsEnabled: env.MCP_DISCOVERY_OPERATING_APPROVALS === "true" };
}
export const discoveryEnvironmentHash = (config: ProbeConfig) => discoveryHash({ schema_version: 1, resource: config.resource, issuer: config.issuer, jwks: config.jwks, build: config.build, transport: "streamable-http-stateless-json", ...("operatingApprovalsEnabled" in config && config.operatingApprovalsEnabled ? { authorization_policy: "bounded-operating-approval-v1" } : {}) });

import { z } from "zod";
export type ProbeConfig = ReturnType<typeof probeConfig>;
export function probeConfig(env: Record<string, string | undefined> = process.env) {
  const mode = z.enum(["development", "test", "production"]).parse(env.NODE_ENV ?? "development");
  const development = mode !== "production";
  function endpoint(value: string | undefined, label: string) {
    if (!value) throw new Error(`${label} is required`);
    const url = new URL(value);
    const local = development && url.protocol === "http:" && url.hostname === "127.0.0.1";
    if ((!local && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) throw new Error(`${label} must be a clean HTTPS URL (development: loopback HTTP allowed)`);
    return url;
  }
  const resource = endpoint(env.MCP_RESOURCE_URL, "MCP_RESOURCE_URL");
  if (resource.pathname !== "/mcp") throw new Error("MCP_RESOURCE_URL must end with /mcp");
  const issuer = endpoint(env.MCP_OAUTH_ISSUER, "MCP_OAUTH_ISSUER");
  const jwks = endpoint(env.MCP_OAUTH_JWKS_URL, "MCP_OAUTH_JWKS_URL");
  // A configured URL is trusted operator configuration, never token-controlled discovery.
  if (jwks.origin !== issuer.origin) throw new Error("JWKS and issuer must share an origin");
  const allowedOrigins = new Set([resource.origin]);
  for (const value of (env.MCP_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean)) {
    const origin = endpoint(value.trim(), "MCP_ALLOWED_ORIGINS");
    if (origin.href !== `${origin.origin}/`) throw new Error("Allowed origins cannot contain a path");
    allowedOrigins.add(origin.origin);
  }
  const bindHost = env.MCP_BIND_HOST ?? "127.0.0.1";
  if (bindHost !== "127.0.0.1" && !(env.NODE_ENV === "production" && env.MCP_ALLOW_REMOTE_BIND === "true" && bindHost === "0.0.0.0")) throw new Error("Remote binding requires explicit production opt-in");
  return {
    resource: resource.href, issuer: issuer.href, jwks: jwks.href,
    organizationId: z.uuid().parse(env.MCP_PROBE_ORGANIZATION_ID),
    allowedHost: resource.host, allowedOrigins, bindHost,
    port: z.coerce.number().int().min(1).max(65535).parse(env.MCP_PORT ?? "3100"),
    build: env.MCP_BUILD_SHA && /^[a-f0-9]{7,40}$/.test(env.MCP_BUILD_SHA) ? env.MCP_BUILD_SHA : "local-unreleased",
    metadataUrl: `${resource.origin}/.well-known/oauth-protected-resource/mcp`,
  };
}

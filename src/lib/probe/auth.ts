import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import type { ProbeConfig } from "./config";
import { ProbeError, type ProbeIdentity } from "./contracts";
export function probeAuthenticator(config: ProbeConfig) {
  const keys = createRemoteJWKSet(new URL(config.jwks), {
    timeoutDuration: 3000, cooldownDuration: 30_000, cacheMaxAge: 60_000,
    // Do not follow redirects to a different endpoint or internal network.
    [customFetch]: (url, options) => fetch(url, { ...options, redirect: "error" }),
  });
  return async (authorization: string | undefined): Promise<ProbeIdentity> => {
    if (!authorization || authorization.length > 8192 || !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization)) throw new ProbeError(401, "invalid_token");
    try {
      const { payload } = await jwtVerify(authorization.slice(7), keys, {
        issuer: config.issuer, audience: config.resource, algorithms: ["RS256", "ES256"],
        requiredClaims: ["sub", "iat", "exp", "scope"], maxTokenAge: "15 minutes", clockTolerance: 0,
      });
      if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255 || typeof payload.scope !== "string" || payload.scope.length > 512 || !payload.exp || !payload.iat || payload.exp - payload.iat > 900 || payload.iat > Date.now() / 1000) throw new Error("Invalid access claims");
      return { issuer: config.issuer, subject: payload.sub, scopes: payload.scope.split(" ").filter(Boolean), expiresAt: payload.exp };
    } catch { throw new ProbeError(401, "invalid_token"); }
  };
}

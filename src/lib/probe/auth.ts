import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import type { ProbeConfig } from "./config";
import { ProbeError, type ProbeIdentity } from "./contracts";
export function probeAuthenticator(config: Pick<ProbeConfig, "issuer" | "resource" | "jwks">) {
  const keys = createRemoteJWKSet(new URL(config.jwks), {
    timeoutDuration: 3000, cooldownDuration: 30_000, cacheMaxAge: 60_000,
    // Do not follow redirects to a different endpoint or internal network.
    [customFetch]: async (url, options) => {
      try {
        const response = await fetch(url, { ...options, redirect: "error" });
        if (!response.ok) throw new ProbeError(503, "jwks_unavailable");
        return response;
      } catch (error) { throw new ProbeError(503, "jwks_unavailable", { cause: error }); }
    },
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
    } catch (error) {
      if (error instanceof ProbeError) throw error;
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "ERR_JWT_EXPIRED") throw new ProbeError(401, "token_expired", { cause: error });
      if (["ERR_JWKS_TIMEOUT", "ERR_JWKS_INVALID", "ERR_JOSE_GENERIC"].includes(String(code))) throw new ProbeError(503, "jwks_unavailable", { cause: error });
      throw new ProbeError(401, "invalid_token", { cause: error });
    }
  };
}

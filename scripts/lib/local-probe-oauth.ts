import { PROBE_SCOPES } from "../../src/lib/probe/contracts";

export const LOCAL_WORK_CLIENT = "eruty-work-probe";
export function localOAuthOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname) || url.port || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("Invalid development OAuth origin");
  return url.origin;
}
export function workCallback(value: string) {
  const url = new URL(value.trim());
  if (url.origin !== "https://chatgpt.com" || url.username || url.password || url.search || url.hash || !/^\/(connector_platform_oauth_redirect|connector\/oauth\/[A-Za-z0-9_-]+)$/.test(url.pathname)) throw new Error("Copy the exact ChatGPT management callback; wildcards are forbidden");
  return url.href;
}
export function localProbeRealm(subject: string, password: string, resource: string) {
  const resourceClient = "eruty-probe-resource";
  return {
    realm: "eruty-probe", enabled: true, displayName: "ERUTY synthetic MCP test",
    registrationAllowed: false, resetPasswordAllowed: false, rememberMe: false,
    bruteForceProtected: true, failureFactor: 5, waitIncrementSeconds: 60,
    accessTokenLifespan: 300, ssoSessionIdleTimeout: 900, ssoSessionMaxLifespan: 1800,
    revokeRefreshToken: true, refreshTokenMaxReuse: 0,
    defaultSignatureAlgorithm: "RS256",
    eventsEnabled: true, eventsExpiration: 3600, adminEventsEnabled: true, adminEventsDetailsEnabled: false,
    clientScopes: PROBE_SCOPES.map(name => ({ name, protocol: "openid-connect", attributes: { "include.in.token.scope": "true", "display.on.consent.screen": "true", "consent.screen.text": name === "discovery:probe" ? "Write synthetic test probes only" : "Read synthetic test probes only" } })),
    clients: [
      { clientId: resourceClient, protocol: "openid-connect", bearerOnly: true, attributes: { resource_url: resource } },
      { clientId: LOCAL_WORK_CLIENT, name: "ERUTY Work MCP synthetic test", protocol: "openid-connect", publicClient: true,
        standardFlowEnabled: true, implicitFlowEnabled: false, directAccessGrantsEnabled: false, serviceAccountsEnabled: false,
        consentRequired: true, redirectUris: [], webOrigins: [], fullScopeAllowed: false,
        optionalClientScopes: [...PROBE_SCOPES], defaultClientScopes: [],
        attributes: { "pkce.code.challenge.method": "S256", "access.token.lifespan": "300" },
        protocolMappers: [{ name: "MCP resource audience", protocol: "openid-connect", protocolMapper: "oidc-audience-mapper", consentRequired: false,
          config: { "included.client.audience": resourceClient, "access.token.claim": "true", "id.token.claim": "false" } }],
      },
    ],
    users: [{ id: subject, username: "eruty-probe-user", enabled: true, email: "eruty-probe@example.invalid", emailVerified: true,
      firstName: "Synthetic", lastName: "Probe", requiredActions: [], credentials: [{ type: "password", value: password, temporary: false }] }],
  };
}

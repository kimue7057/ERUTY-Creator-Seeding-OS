import { z } from "zod";
import { DiscoveryError, discoveryHash, platformSchema, privateReference } from "./contracts";
import type { DiscoveryActor } from "./service";

export const localBrowserAuthorization = z.strictObject({
  authorization_id: z.uuid(), organization_id: z.uuid(), user_id: z.uuid(), campaign_id: z.uuid(),
  platform: platformSchema, browser_surface: z.enum(["iab", "chrome"]), execution_reference: privateReference,
  issued_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
  max_creators: z.literal(1), confirmation: z.literal("authorize-one-codex-browser-run"),
}).superRefine((value, ctx) => {
  const issued = Date.parse(value.issued_at), expires = Date.parse(value.expires_at);
  if (issued > Date.now() + 300000 || expires <= issued || expires - issued > 4 * 3600000) ctx.addIssue({ code: "custom", message: "Local browser authorization must be issued for at most four hours" });
});

// Local process adapter, never exported as an HTTP/MCP tool. Live membership is
// independently checked by discoveryService on every request and transaction.
export function codexBrowserActor(input: unknown, enabled: boolean): DiscoveryActor {
  if (!enabled) throw new DiscoveryError(403, "local_browser_disabled");
  const auth = localBrowserAuthorization.parse(input);
  const check = () => { if (Date.parse(auth.expires_at) <= Date.now()) throw new DiscoveryError(403, "local_browser_authorization_expired"); };
  check();
  return { userId: auth.user_id, organizationId: auth.organization_id, role: "manager", principalId: auth.authorization_id,
    executionSource: "codex_browser", environmentSha256: discoveryHash({ adapter: "codex-local-browser-v1", authorization: auth }), campaignIds: [auth.campaign_id],
    localBrowser: { platform: auth.platform, surface: auth.browser_surface, executionReference: auth.execution_reference },
    reauthorize: async (_tx, campaignId) => { check(); if (campaignId !== auth.campaign_id) throw new DiscoveryError(403, "local_browser_scope_denied"); },
  };
}

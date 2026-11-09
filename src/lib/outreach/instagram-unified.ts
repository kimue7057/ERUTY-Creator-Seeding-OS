import { createHmac } from "node:crypto";
import { z } from "zod";
import { normalizeIdentity, OutreachError } from "./contracts";
import { providerJson } from "./provider-http";
import { InstagramConnectionError, instagramStageError, type InstagramStage } from "./instagram-errors";
import type { ConnectedIdentity, ProviderTokens } from "./providers";

type Config = { id?: string; secret?: string; version?: string; redirectUri: string; configurationId: string };
const idSchema = z.string().regex(/^\d+$/);
const accountSchema = z.object({ id: idSchema, username: z.string().regex(/^[\w.]{1,30}$/) });
const timestamp = z.number().int().nonnegative().max(8640000000000);
const debugSchema = z.object({ data: z.object({
  app_id: z.string(), is_valid: z.boolean(), type: z.string(),
  expires_at: timestamp, data_access_expires_at: timestamp.optional(), scopes: z.array(z.string()),
}) });
function graphBase(config: Config) {
  if (!config.id || !config.secret || !/^v\d+\.0$/.test(config.version ?? "") || !/^\d+$/.test(config.configurationId)) throw new OutreachError("not_configured");
  return `https://graph.facebook.com/${config.version}`;
}
async function graphJson<T>(url: URL, authorization: string | undefined, fetcher: typeof fetch, signal: AbortSignal, stage: InstagramStage, schema: z.ZodType<T>): Promise<T> {
  try {
    const raw = await providerJson(url.href, { headers: authorization ? { Authorization: `Bearer ${authorization}` } : undefined, signal }, fetcher);
    if (raw && typeof raw === "object" && "error" in raw) throw new OutreachError("provider_invalid");
    return schema.parse(raw);
  } catch (error) { throw instagramStageError(stage, error); }
}
export async function checkUnifiedAppCredentials(config: Config, fetcher: typeof fetch = fetch) {
  const url = new URL(`${graphBase(config)}/oauth/access_token`);
  url.search = new URLSearchParams({ client_id: config.id!, client_secret: config.secret!, grant_type: "client_credentials" }).toString();
  // This checks the saved app credentials only. The app token is discarded,
  // never returned, persisted, or used as an Instagram sender identity.
  await graphJson(url, undefined, fetcher, AbortSignal.timeout(15000), "app_credentials", z.object({ access_token: z.string().min(1).max(16384) }));
  return { credentialsVerified: true as const };
}
async function inspectToken(accessToken: string, config: Config, fetcher: typeof fetch, signal: AbortSignal): Promise<ProviderTokens> {
  const url = new URL(`${graphBase(config)}/debug_token`); url.searchParams.set("input_token", accessToken);
  const { data } = await graphJson(url, `${config.id}|${config.secret}`, fetcher, signal, "token_inspection", debugSchema);
  if (!data.is_valid) throw new InstagramConnectionError("reconnect", { stage: "token_inspection", reason: "token_invalid" });
  if (data.app_id !== config.id) throw new InstagramConnectionError("instagram_app_mismatch", { stage: "token_inspection", reason: "app_mismatch" });
  if (data.type !== "SYSTEM_USER") throw new InstagramConnectionError("instagram_token_type", { stage: "token_inspection", reason: "token_type" });
  if (!data.scopes.includes("instagram_basic")) throw new InstagramConnectionError("permission_missing", { stage: "token_inspection", reason: "permission_missing" });
  const expirations = [data.expires_at, data.data_access_expires_at].filter((v): v is number => v !== undefined && v > 0).map(v => v * 1000);
  const expiresAt = expirations.length ? Math.min(...expirations) : null;
  if (expiresAt !== null && expiresAt <= Date.now() + 120000) throw new InstagramConnectionError("reconnect", { stage: "token_inspection", reason: "token_expired" });
  // Only an inspected SYSTEM_USER token with explicit expires_at=0 may be
  // non-expiring. Missing expiry in the code-exchange response proves nothing.
  return { accessToken, expiresAt, scopes: data.scopes, tokenKind: "meta_system_user" };
}
async function sharedAccounts(token: ProviderTokens, config: Config, fetcher: typeof fetch, signal: AbortSignal) {
  const accounts = new Map<string, z.infer<typeof accountSchema>>(), cursors = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    if (signal.aborted) throw new OutreachError("provider_unavailable");
    const url = new URL(`${graphBase(config)}/me/assigned_instagram_accounts`);
    url.searchParams.set("fields", "id,username"); url.searchParams.set("limit", "100");
    url.searchParams.set("appsecret_proof", createHmac("sha256", config.secret!).update(token.accessToken).digest("hex"));
    if (after) url.searchParams.set("after", after);
    const result = await graphJson(url, token.accessToken, fetcher, signal, "account_lookup", z.object({ data: z.array(accountSchema), paging: z.object({ cursors: z.object({ after: z.string().min(1).max(4096).optional() }).optional(), next: z.string().optional() }).optional() }));
    for (const account of result.data) accounts.set(account.id, account);
    const cursor = result.paging?.cursors?.after;
    if (!result.data.length || !cursor && !result.paging?.next) return [...accounts.values()];
    // Rebuild a fixed-origin URL from the cursor; never follow a provider-supplied URL.
    if (!cursor || cursors.has(cursor)) throw new OutreachError("provider_invalid");
    cursors.add(cursor); after = cursor;
  }
  throw new OutreachError("instagram_accounts_incomplete");
}
async function identity(token: ProviderTokens, config: Config, expectedIdentity: string | undefined, fetcher: typeof fetch, signal: AbortSignal): Promise<ConnectedIdentity> {
  const verified = await inspectToken(token.accessToken, config, fetcher, signal);
  const accounts = await sharedAccounts(verified, config, fetcher, signal);
  if (!accounts.length) throw new OutreachError("instagram_no_accounts");
  const matches = accounts.filter(a => token.instagramAccountId ? a.id === token.instagramAccountId : expectedIdentity && normalizeIdentity(a.username) === normalizeIdentity(expectedIdentity));
  if (matches.length !== 1) throw new OutreachError("instagram_account_not_shared");
  const selected = matches[0];
  return { id: selected.id, identity: selected.username, addresses: [{ address: `@${selected.username}`, label: "Meta에서 확인한 Instagram 계정", primary: true }], tokens: { ...verified, instagramAccountId: selected.id } };
}
export async function exchangeUnifiedCode(code: string, config: Config, expectedIdentity: string | undefined, fetcher: typeof fetch): Promise<ConnectedIdentity> {
  if (!expectedIdentity) throw new OutreachError("instagram_account_not_shared");
  const signal = AbortSignal.timeout(45000), url = new URL(`${graphBase(config)}/oauth/access_token`);
  url.search = new URLSearchParams({ client_id: config.id!, client_secret: config.secret!, redirect_uri: config.redirectUri, code }).toString();
  const result = await graphJson(url, undefined, fetcher, signal, "code_exchange", z.object({ access_token: z.string().min(1).max(16384) }));
  return identity({ accessToken: result.access_token, expiresAt: null, scopes: [] }, config, expectedIdentity, fetcher, signal);
}
export async function unifiedIdentity(token: ProviderTokens, config: Config, fetcher: typeof fetch): Promise<ConnectedIdentity> {
  if (token.tokenKind !== "meta_system_user" || !token.instagramAccountId) throw new OutreachError("reconnect");
  return identity(token, config, undefined, fetcher, AbortSignal.timeout(45000));
}

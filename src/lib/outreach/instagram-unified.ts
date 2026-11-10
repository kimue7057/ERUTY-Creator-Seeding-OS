import { createHmac } from "node:crypto";
import { z } from "zod";
import { normalizeIdentity, OutreachError } from "./contracts";
import { providerJson } from "./provider-http";
import { InstagramAccountSelectionError, InstagramConnectionError, instagramStageError, type InstagramStage, type InstagramGrantCounts } from "./instagram-errors";
import type { ConnectedIdentity, ProviderTokens } from "./providers";

type Config = { id?: string; secret?: string; version?: string; redirectUri: string; configurationId: string };
const idSchema = z.string().regex(/^\d+$/);
const accountSchema = z.object({ id: idSchema, username: z.string().regex(/^[\w.]{1,30}$/) });
const timestamp = z.number().int().nonnegative().max(8640000000000);
const debugSchema = z.object({ data: z.object({
  app_id: z.string(), is_valid: z.boolean(), type: z.string(),
  expires_at: timestamp, data_access_expires_at: timestamp.optional(), scopes: z.array(z.string()),
  granular_scopes: z.unknown().optional(),
}) });
const granularScopeSchema = z.array(z.object({ scope: z.string(), target_ids: z.array(idSchema.max(50)).optional() })).max(200);
const instagramTargetScopes = { basic: "instagram_basic", messages: "instagram_manage_messages", comments: "instagram_manage_comments", publishing: "instagram_content_publish", insights: "instagram_manage_insights" } as const;
type InspectedToken = { token: ProviderTokens; targets: string[]; grantMetadata: "missing" | "valid" | "invalid"; instagramGrants: InstagramGrantCounts };
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
  const signal = AbortSignal.timeout(20000);
  // The app token is used only for this read-only app metadata check. It is
  // never returned, persisted, or used as an Instagram sender identity.
  const appToken = await graphJson(url, undefined, fetcher, signal, "app_credentials", z.object({ access_token: z.string().min(1).max(16384) }));
  const ownerSchema = z.object({ id: idSchema, name: z.string().min(1).max(300).optional() });
  type Ownership = { status: "confirmed"; business: z.infer<typeof ownerSchema> } | { status: "not_returned" | "unavailable"; business: null };
  let ownership: Ownership;
  try {
    const metadataUrl = new URL(`${graphBase(config)}/${config.id}`);
    metadataUrl.search = new URLSearchParams({ fields: "id,business{id,name}", appsecret_proof: createHmac("sha256", config.secret!).update(appToken.access_token).digest("hex") }).toString();
    const app = await graphJson(metadataUrl, appToken.access_token, fetcher, signal, "app_ownership", z.object({ id: idSchema, business: ownerSchema.nullable().optional() }));
    if (app.id !== config.id) throw instagramStageError("app_ownership", new OutreachError("provider_invalid"));
    ownership = app.business ? { status: "confirmed", business: app.business } : { status: "not_returned", business: null };
  } catch (error) {
    const safe = instagramStageError("app_ownership", error);
    console.warn(JSON.stringify({ event: "outreach.instagram_app_ownership_unavailable", code: safe.code, diagnostic: safe.diagnostic }));
    ownership = { status: "unavailable", business: null };
  }
  // Missing or inaccessible owner metadata does not invalidate credentials,
  // and does not prove the app has no owner or that Instagram is connected.
  return { credentialsVerified: true as const, ownership };
}
async function inspectToken(accessToken: string, config: Config, fetcher: typeof fetch, signal: AbortSignal): Promise<InspectedToken> {
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
  const granular = granularScopeSchema.safeParse(data.granular_scopes);
  const targets = new Set<string>();
  const instagramGrants = Object.fromEntries(Object.entries(instagramTargetScopes).map(([label, scope]) => {
    const entries = granular.success ? granular.data.filter(g => g.scope === scope) : [];
    const ids = [...new Set(entries.flatMap(g => g.target_ids ?? []))], granted = data.scopes.includes(scope);
    if (granted) for (const id of ids) targets.add(id);
    // No target_ids may describe broad access; never equate it with a denial.
    return [label, { granted, entryPresent: entries.length > 0, targetIdsPresent: entries.some(e => e.target_ids !== undefined), targetCount: ids.length }];
  })) as InstagramGrantCounts;
  return { token: { accessToken, expiresAt, scopes: data.scopes, tokenKind: "meta_system_user" }, targets: [...targets], instagramGrants,
    grantMetadata: data.granular_scopes === undefined ? "missing" : granular.success ? "valid" : "invalid" };
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
async function grantedAccounts(token: ProviderTokens, targets: string[], config: Config, fetcher: typeof fetch, signal: AbortSignal) {
  // Use only granted Instagram-scope targets supplied by Meta's inspected token, never
  // caller-supplied IDs, inferred handles, ad/Page targets, or stored old grants.
  if (targets.length > 20) throw new OutreachError("instagram_accounts_incomplete");
  const accounts: z.infer<typeof accountSchema>[] = [];
  for (const id of targets) {
    const url = new URL(`${graphBase(config)}/${id}`);
    url.search = new URLSearchParams({ fields: "id,username,ig_id", appsecret_proof: createHmac("sha256", config.secret!).update(token.accessToken).digest("hex") }).toString();
    // An FB Page can also have id/username. Requiring the IG-specific ig_id
    // prevents a Page from being accepted as an Instagram sender.
    const account = await graphJson(url, token.accessToken, fetcher, signal, "account_lookup", accountSchema.extend({ ig_id: z.union([idSchema, z.number().int().positive()]) }));
    if (account.id !== id) throw instagramStageError("account_lookup", new OutreachError("provider_invalid"));
    accounts.push({ id: account.id, username: account.username });
  }
  return accounts;
}
async function identity(token: ProviderTokens, config: Config, expectedIdentity: string | undefined, fetcher: typeof fetch, signal: AbortSignal): Promise<ConnectedIdentity> {
  const inspected = await inspectToken(token.accessToken, config, fetcher, signal), verified = inspected.token;
  let accounts = await sharedAccounts(verified, config, fetcher, signal);
  const assignedCount = accounts.length;
  const resolution = { assignedAccountCount: assignedCount, grantedTargetCount: inspected.targets.length, grantMetadata: inspected.grantMetadata, instagramGrants: inspected.instagramGrants };
  if (!assignedCount && inspected.targets.length) {
    try { accounts = await grantedAccounts(verified, inspected.targets, config, fetcher, signal); }
    catch (error) { if (error instanceof InstagramConnectionError) Object.assign(error.diagnostic, resolution); throw error; }
  }
  if (!accounts.length) throw new InstagramConnectionError("instagram_no_accounts", { stage: "account_lookup", reason: "no_accounts", ...resolution });
  const matches = accounts.filter(a => token.instagramAccountId ? a.id === token.instagramAccountId : expectedIdentity && normalizeIdentity(a.username) === normalizeIdentity(expectedIdentity));
  if (matches.length !== 1) throw new InstagramAccountSelectionError("instagram_account_not_shared", { stage: "account_lookup", reason: "account_not_shared", ...resolution },accounts.map(account=>account.username));
  const selected = matches[0];
  if (!assignedCount) console.info(JSON.stringify({ event: "outreach.instagram_account_resolved", source: "inspected_instagram_grant", ...resolution }));
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
export async function verifyInstagramSystemUserToken(accessToken: string, config: Config, expectedIdentity: string, fetcher: typeof fetch): Promise<ConnectedIdentity> {
  // A company administrator may supply a first-party system-user token. It
  // receives the same app, lifetime, scope and live asset checks as OAuth.
  // Never infer an authorized account from the supplied username alone.
  try {
    return await identity({ accessToken, expiresAt: null, scopes: [] }, config, expectedIdentity, fetcher, AbortSignal.timeout(45000));
  } catch (error) {
    if(error instanceof InstagramAccountSelectionError){
      throw new InstagramAccountSelectionError("instagram_system_user_account_mismatch",error.diagnostic,error.verifiedAccounts.map(account=>account.username));
    }
    if (error instanceof InstagramConnectionError && error.code === "instagram_no_accounts") {
      throw new InstagramConnectionError("instagram_system_user_no_accounts", error.diagnostic);
    }
    throw error;
  }
}

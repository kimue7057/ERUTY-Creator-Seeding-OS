import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizeIdentity, OutreachError, type SenderAddress, type SenderProvider } from "./contracts";

export const GOOGLE_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GOOGLE_ALIAS_SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";
export type ProviderTokens = { accessToken: string; refreshToken?: string; expiresAt: number; scopes: string[] };
export type ConnectedIdentity = { id: string; identity: string; addresses: SenderAddress[]; tokens: ProviderTokens };
const required = (value?: string) => { if (!value) throw new OutreachError("not_configured"); return value; };
export function providerConfig(provider: SenderProvider, env: Record<string,string|undefined> = process.env) {
  const prefix = { google: "GOOGLE", instagram: "INSTAGRAM", tiktok: "TIKTOK" }[provider];
  const id = env[`OUTREACH_${prefix}_CLIENT_ID`], secret = env[`OUTREACH_${prefix}_CLIENT_SECRET`];
  const origin = env.APP_ORIGIN;
  const originValid = !!origin && (() => { try { const u = new URL(origin); return u.origin === origin && !u.username && (u.protocol === "https:" || env.NODE_ENV !== "production" && ["localhost","127.0.0.1"].includes(u.hostname)); } catch { return false; } })();
  const version = provider === "instagram" ? env.OUTREACH_INSTAGRAM_API_VERSION : undefined;
  return { id, secret, redirectUri: `${origin}/api/outreach/oauth/${provider}/callback`, version,
    configured: !!id && !!secret && originValid && /^[a-fA-F0-9]{64}$/.test(env.OUTREACH_ENCRYPTION_KEY ?? "") && (provider !== "instagram" || /^v\d+\.0$/.test(version ?? "")) };
}
export function authorizationUrl(provider: SenderProvider, state: string, verifier: string, identity: string, aliases: boolean, config = providerConfig(provider)) {
  if (!config.configured) throw new OutreachError("not_configured");
  const url = new URL({ google: "https://accounts.google.com/o/oauth2/v2/auth", instagram: "https://www.instagram.com/oauth/authorize", tiktok: "https://www.tiktok.com/v2/auth/authorize/" }[provider]);
  url.searchParams.set(provider === "tiktok" ? "client_key" : "client_id", required(config.id));
  url.searchParams.set("redirect_uri", config.redirectUri); url.searchParams.set("response_type", "code"); url.searchParams.set("state", state);
  if (provider === "google") {
    url.searchParams.set("scope", ["openid", "email", GOOGLE_SEND_SCOPE, ...(aliases ? [GOOGLE_ALIAS_SCOPE] : [])].join(" "));
    url.searchParams.set("access_type", "offline"); url.searchParams.set("prompt", "consent select_account"); url.searchParams.set("login_hint", identity);
    url.searchParams.set("code_challenge_method", "S256"); url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
  } else if (provider === "instagram") {
    url.searchParams.set("scope", "instagram_business_basic,instagram_business_manage_messages"); url.searchParams.set("force_authentication", "1"); url.searchParams.set("enable_fb_login", "0");
  } else url.searchParams.set("scope", "user.info.basic,user.info.profile");
  return url.href;
}
export async function providerJson(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(url, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) }); }
  catch { throw new OutreachError("provider_unavailable"); }
  if (!response.ok) { await response.body?.cancel(); throw new OutreachError([400,401,403].includes(response.status) ? "reconnect" : "provider_unavailable"); }
  const reader = response.body?.getReader(); if (!reader) throw new OutreachError("provider_invalid");
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 1048576) { await reader.cancel(); throw new OutreachError("provider_invalid"); } chunks.push(part.value); } return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new OutreachError("provider_invalid"); }
}
const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().optional(), expires_in: z.number().positive(), scope: z.string().optional() });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
function tokens(raw: z.infer<typeof tokenSchema>, scope: string[] = []): ProviderTokens {
  return { accessToken: raw.access_token, refreshToken: raw.refresh_token, expiresAt: Date.now() + raw.expires_in * 1000, scopes: raw.scope ? raw.scope.split(/[ ,]+/) : scope };
}
export async function googleAddresses(accessToken: string, identity: string, aliases: boolean, fetcher: typeof fetch = fetch): Promise<SenderAddress[]> {
  if (!aliases) return [{ address: identity, label: "기본 이메일", primary: true }];
  const raw = await providerJson("https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs", { headers: bearer(accessToken) }, fetcher);
  const parsed = z.object({ sendAs: z.array(z.object({ sendAsEmail: z.email(), displayName: z.string().optional(), isPrimary: z.boolean().optional(), verificationStatus: z.string().optional() })) }).parse(raw);
  return parsed.sendAs.filter(a => a.isPrimary || a.verificationStatus === "accepted").map(a => ({ address: a.sendAsEmail, label: a.displayName || (a.isPrimary ? "기본 이메일" : "승인된 추가 주소"), primary: !!a.isPrimary }));
}
export async function fetchIdentity(provider: SenderProvider, token: ProviderTokens, fetcher: typeof fetch = fetch, config = providerConfig(provider)): Promise<ConnectedIdentity> {
  if (provider === "google") {
    const user = z.object({ sub: z.string(), email: z.email(), email_verified: z.literal(true) }).parse(await providerJson("https://openidconnect.googleapis.com/v1/userinfo", { headers: bearer(token.accessToken) }, fetcher));
    if (!token.scopes.includes(GOOGLE_SEND_SCOPE)) throw new OutreachError("permission_missing");
    return { id: user.sub, identity: user.email, addresses: await googleAddresses(token.accessToken,user.email,token.scopes.includes(GOOGLE_ALIAS_SCOPE),fetcher), tokens: token };
  }
  if (provider === "instagram") {
    const version = required(config.version);
    const user = z.object({ user_id: z.union([z.string(),z.number()]).transform(String), username: z.string().regex(/^[\w.]{1,30}$/) }).parse(await providerJson(`https://graph.instagram.com/${version}/me?fields=user_id,username`, { headers: bearer(token.accessToken) }, fetcher));
    return { id: user.user_id, identity: user.username, addresses: [{ address: `@${user.username}`, label: "로그인으로 확인한 계정", primary:true }], tokens:token };
  }
  const raw = z.object({ error: z.object({ code:z.literal("ok") }), data:z.object({ user:z.object({ open_id:z.string(), username:z.string().regex(/^[\w.]{1,30}$/) }) }) }).parse(await providerJson("https://open.tiktokapis.com/v2/user/info/?fields=open_id,username", { headers:bearer(token.accessToken) }, fetcher));
  return { id:raw.data.user.open_id, identity:raw.data.user.username, addresses:[{ address:`@${raw.data.user.username}`,label:"로그인으로 확인한 계정",primary:true }],tokens:token };
}
export async function exchangeCode(provider: SenderProvider, code: string, verifier: string, fetcher: typeof fetch = fetch, config = providerConfig(provider)) {
  if (!config.configured) throw new OutreachError("not_configured");
  const form = new URLSearchParams({ grant_type:"authorization_code", code, redirect_uri:config.redirectUri, client_secret:required(config.secret) });
  form.set(provider === "tiktok" ? "client_key" : "client_id", required(config.id));
  if (provider === "google") form.set("code_verifier",verifier);
  const endpoint = { google:"https://oauth2.googleapis.com/token", instagram:"https://api.instagram.com/oauth/access_token", tiktok:"https://open.tiktokapis.com/v2/oauth/token/" }[provider];
  const raw = await providerJson(endpoint,{method:"POST",body:form},fetcher);
  let result: ProviderTokens;
  if (provider === "instagram") {
    const short = z.object({ access_token:z.string(), permissions:z.array(z.string()).optional() }).parse(raw);
    const url = new URL("https://graph.instagram.com/access_token");
    url.search = new URLSearchParams({ grant_type:"ig_exchange_token", client_secret:required(config.secret), access_token:short.access_token }).toString();
    const long = tokenSchema.parse(await providerJson(url.href,{},fetcher));
    // Missing granted permissions are never treated as messaging authorization.
    result = tokens(long,short.permissions ?? []);
  } else result = tokens(tokenSchema.parse(raw));
  if (provider === "google" && !result.refreshToken) throw new OutreachError("permission_missing");
  return fetchIdentity(provider,result,fetcher,config);
}
export async function refreshTokens(provider: SenderProvider, current: ProviderTokens, fetcher: typeof fetch = fetch, config = providerConfig(provider)) {
  if (current.expiresAt > Date.now() + 120000) return current;
  if (provider === "instagram") throw new OutreachError("reconnect");
  if (!current.refreshToken || !config.configured) throw new OutreachError("reconnect");
  const form = new URLSearchParams({ grant_type:"refresh_token",refresh_token:current.refreshToken,client_secret:required(config.secret),[provider === "google" ? "client_id" : "client_key"]:required(config.id) });
  const raw = tokenSchema.parse(await providerJson(provider === "google" ? "https://oauth2.googleapis.com/token" : "https://open.tiktokapis.com/v2/oauth/token/",{method:"POST",body:form},fetcher));
  return { ...tokens(raw,current.scopes),refreshToken:raw.refresh_token ?? current.refreshToken };
}
export function matchesExpected(expected: string, identity: ConnectedIdentity) {
  return normalizeIdentity(expected) === normalizeIdentity(identity.identity) || identity.addresses.some(a => normalizeIdentity(a.address) === normalizeIdentity(expected));
}

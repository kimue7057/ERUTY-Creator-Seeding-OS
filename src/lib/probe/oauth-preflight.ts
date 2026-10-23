import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProbeConfig } from "./config";
import { probeAuthenticator } from "./auth";
import { PROBE_SCOPES } from "./contracts";

const metadataSchema = z.object({
  issuer: z.string(), authorization_endpoint: z.string(), token_endpoint: z.string(), jwks_uri: z.string(),
  response_types_supported: z.array(z.string()), grant_types_supported: z.array(z.string()),
  code_challenge_methods_supported: z.array(z.string()), token_endpoint_auth_methods_supported: z.array(z.string()),
  scopes_supported: z.array(z.string()), authorization_response_iss_parameter_supported: z.boolean().optional(),
  revocation_endpoint: z.string().optional(),
});

export async function inspectProbeOAuth(config: Pick<ProbeConfig, "issuer" | "resource" | "jwks">, metadataUrl: string, accessToken?: string, request: typeof fetch = fetch, scopes: readonly string[] = PROBE_SCOPES) {
  const clean = (value: string) => {
    const url = new URL(value);
    const issuer = new URL(config.issuer);
    if (url.origin !== issuer.origin || url.username || url.password || url.search || url.hash) throw new Error("oauth_endpoint_origin_mismatch");
    return url;
  };
  clean(metadataUrl);
  const response = await request(metadataUrl, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("oauth_metadata_unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("oauth_metadata_empty");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 65_536) throw new Error("oauth_metadata_too_large"); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  const metadata = metadataSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  if (metadata.issuer !== config.issuer || metadata.jwks_uri !== config.jwks) throw new Error("oauth_issuer_or_jwks_mismatch");
  for (const url of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri, ...(metadata.revocation_endpoint ? [metadata.revocation_endpoint] : [])]) clean(url);
  if (!metadata.response_types_supported.includes("code") || !metadata.grant_types_supported.includes("authorization_code") || !metadata.code_challenge_methods_supported.includes("S256") || !metadata.token_endpoint_auth_methods_supported.includes("none")) throw new Error("oauth_client_contract_incompatible");
  // Discovery cannot prove that a real provider actually enforces PKCE, consent or audience.
  const identity = accessToken ? await probeAuthenticator(config)(`Bearer ${accessToken}`) : undefined;
  if (identity && !scopes.every(scope => identity.scopes.includes(scope))) throw new Error("oauth_token_scopes_missing");
  return {
    issuer: config.issuer, resource: config.resource, metadata_contract: "compatible",
    client_mode: "provided", token_endpoint_auth_method: "none", scopes,
    api_scopes_advertised: scopes.every(scope => metadata.scopes_supported.includes(scope)),
    issuer_identification_advertised: metadata.authorization_response_iss_parameter_supported === true,
    revocation_endpoint_advertised: !!metadata.revocation_endpoint,
    token_validation: identity ? "signature_issuer_audience_lifetime_scopes_verified" : "not_tested",
    ...(identity ? { subject_sha256: createHash("sha256").update(identity.subject).digest("hex") } : {}),
    login_consent_callback_pkce_exchange: "not_tested", work_connection: "unverified",
  };
}

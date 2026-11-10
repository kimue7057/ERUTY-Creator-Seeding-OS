import { OutreachError } from "./contracts";

export type MetaErrorReason = "invalid_client_secret" | "invalid_client_id" | "redirect_uri_mismatch" | "authorization_code_used";
// Retain only numeric diagnostics and fixed reason labels. Error bodies can contain tokens,
// authorization codes and URLs and must never become error messages or logs.
export class ProviderHttpError extends OutreachError {
  constructor(public status: number, public providerCode?: number, public providerSubcode?: number, public metaReason?: MetaErrorReason) {
    super([400,401,403].includes(status) ? "reconnect" : "provider_unavailable");
  }
}
const diagnosticNumber = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
function metaReason(error: unknown): MetaErrorReason | undefined {
  const message = error && typeof error === "object" && "message" in error ? error.message : null;
  if (typeof message !== "string") return;
  if (/^Error validating client secret(?:[.:]|$)/i.test(message)) return "invalid_client_secret";
  if (/^(Invalid client_id|Invalid Client ID|Invalid application ID|Invalid App ID)\b/i.test(message)) return "invalid_client_id";
  if (/^Error validating verification code\./i.test(message) && /redirect_uri/i.test(message)) return "redirect_uri_mismatch";
  if (/^This authorization code has (been used|expired)\b/i.test(message)) return "authorization_code_used";
}
async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader(); if (!reader) throw new OutreachError("provider_invalid");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 1048576) { await reader.cancel(); throw new OutreachError("provider_invalid"); } chunks.push(part.value); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { throw new OutreachError("provider_invalid"); }
  finally { reader.releaseLock(); }
}
export async function providerJson(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(url, { ...init, redirect: "error", cache: "no-store", signal: init.signal ?? AbortSignal.timeout(15000) }); }
  catch { throw new OutreachError("provider_unavailable"); }
  if (!response.ok) {
    const raw = await readJson(response).catch(() => null);
    const error = raw && typeof raw === "object" && "error" in raw ? raw.error : null;
    throw new ProviderHttpError(response.status,
      diagnosticNumber(error && typeof error === "object" && "code" in error ? error.code : undefined),
      diagnosticNumber(error && typeof error === "object" && "error_subcode" in error ? error.error_subcode : undefined),
      new URL(url).hostname === "graph.facebook.com" ? metaReason(error) : undefined);
  }
  return readJson(response);
}

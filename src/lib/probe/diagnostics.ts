import { z } from "zod";
import { ProbeError } from "./contracts";
import { DiscoveryError } from "../discovery/contracts";

export type McpLayer = "http" | "authentication" | "authorization" | "transport" | "tool" | "serialization" | "database" | "lifecycle";
export type McpLogEvent = { request_id: string; outcome: string; at: string; layer: McpLayer; correlation_id?: string; rpc_method?: string; protocol_version?: string; tool?: string; duration_ms?: number; status?: number; error?: ReturnType<typeof privateError> };
// Only a version identifier is diagnostic data. Never echo arbitrary header text.
export function diagnosticProtocolVersion(value: string | string[] | undefined) {
  return value === undefined ? undefined : typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "invalid";
}
export type McpLogger = (event: McpLogEvent) => void;
export function redactDiagnostic(value: string) {
  return value.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[JWT]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[KEY]")
    .replace(/(?:https?|postgres(?:ql)?):\/\/[^\s)]+/gi, "[URL]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/((?:password|client_secret|access_token|refresh_token|authorization|cookie)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}
// Drizzle errors contain SQL and bound parameters in message/query/params. Never serialize them.
// Keep the real stack frames and machine codes, including nested driver causes, privately.
export function privateError(error: unknown, depth = 0): { name: string; code?: string; stack: string[]; cause?: ReturnType<typeof privateError> } {
  const e = error && typeof error === "object" ? error as { name?: unknown; code?: unknown; stack?: unknown; cause?: unknown } : {};
  const name = typeof e.name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(e.name) ? e.name : "Error";
  const code = typeof e.code === "string" && /^[A-Z0-9_]{2,40}$/.test(e.code) ? e.code : undefined;
  return { name, ...(code ? { code } : {}), stack: typeof e.stack === "string" ? e.stack.split("\n").filter(line => /^\s+at /.test(line)).slice(0, 20).map(redactDiagnostic) : [], ...(depth < 3 && e.cause ? { cause: privateError(e.cause, depth + 1) } : {}) };
}
const driverCode = (error: unknown, depth = 0): string | undefined => {
  if (!error || typeof error !== "object" || depth > 4) return;
  const e = error as { code?: unknown; cause?: unknown };
  return typeof e.code === "string" ? e.code : driverCode(e.cause, depth + 1);
};
export function safeFailure(error: unknown) {
  const domain = error instanceof ProbeError || error instanceof DiscoveryError ? error : null;
  let code = domain?.code ?? "internal_error", status = domain?.status ?? 500;
  let layer: McpLayer = status === 401 ? "authentication" : [403, 404].includes(status) ? "authorization" : "tool";
  let retryable = false;
  const driver = driverCode(error);
  if (!domain && error instanceof z.ZodError) { code = "invalid_input"; status = 400; }
  else if (!domain && (driver && (/^08/.test(driver) || ["57P01", "57P02", "57P03", "53300", "ECONNREFUSED", "ECONNRESET", "EPIPE", "ENOTFOUND"].includes(driver)) || error instanceof Error && /^(Connection terminated|timeout exceeded when trying to connect|Connection terminated due to connection timeout)/.test(error.message))) { code = "database_unavailable"; status = 503; layer = "database"; retryable = true; }
  else if (!domain && driver && ["57014", "55P03", "ETIMEDOUT"].includes(driver)) { code = "database_timeout"; status = 503; layer = "database"; retryable = true; }
  else if (!domain && driver && ["40001", "40P01"].includes(driver)) { code = "transaction_retry_required"; status = 503; layer = "database"; retryable = true; }
  else if (!domain && driver && /^[0-9A-Z]{5}$/.test(driver)) { code = "database_error"; layer = "database"; }
  if (["server_busy", "jwks_unavailable"].includes(code)) retryable = true;
  const reauthenticate = status === 401 || code === "insufficient_scope" && (!(error instanceof DiscoveryError) || error.oauthChallenge);
  const recovery = status === 401 ? "Refresh the access token; if refresh is rejected, sign in to the existing connection."
    : code.startsWith("approval_") ? "Ask an administrator to inspect the operating approval, expiry, revocation and environment. Signing in does not extend approval; do not retry automatically."
    : code.startsWith("grant_") || code === "principal_not_allowed" ? "Ask the operator to inspect the grant expiry, revocation and environment. Reauthentication does not renew a DB grant."
    : reauthenticate ? "Authorize the required OAuth scopes."
    : status === 403 || status === 404 ? "Check the permitted organization, campaign and role; do not retry automatically."
    : retryable ? "Retry reads with bounded backoff. For writes, retain the same idempotency key and identical payload."
    : "Correct the input or give the operator this request_id; do not retry automatically.";
  return { code, status, layer, retryable, recovery, reauthenticate };
}

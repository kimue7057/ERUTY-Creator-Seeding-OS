import { OutreachError } from "./contracts";
import { ProviderHttpError, type MetaErrorReason } from "./provider-http";

export type InstagramStage = "app_credentials" | "app_ownership" | "code_exchange" | "token_inspection" | "account_lookup";
export type InstagramGrantCounts = Record<"basic" | "messages" | "comments" | "publishing" | "insights", { granted: boolean; entryPresent: boolean; targetIdsPresent: boolean; targetCount: number }>;
type Reason = "http_error" | "unavailable" | "response_invalid" | "token_invalid" | "app_mismatch" | "token_type" | "token_expired" | "permission_missing" | "no_accounts" | "account_not_shared";
type Diagnostic = { stage: InstagramStage; reason: Reason; httpStatus?: number; graphCode?: number; graphSubcode?: number; metaReason?: MetaErrorReason; assignedAccountCount?: number; grantedTargetCount?: number; grantMetadata?: "missing" | "valid" | "invalid"; instagramGrants?: InstagramGrantCounts };
export class InstagramConnectionError extends OutreachError {
  constructor(code: string, public diagnostic: Diagnostic) { super(code); }
}
export type VerifiedInstagramAccount = {username:string;profileUrl:string};
export class InstagramAccountSelectionError extends InstagramConnectionError {
  // Authorized account names may be shown to the administrator who supplied
  // this token, but must not appear in JSON error logs or public diagnostics.
  #usernames: string[];
  constructor(code:string,diagnostic:Diagnostic,usernames:readonly string[]){
    super(code,diagnostic);this.#usernames=[...new Set(usernames)].slice(0,5);
  }
  get verifiedAccounts():VerifiedInstagramAccount[]{
    return this.#usernames.map(username=>({username,profileUrl:`https://www.instagram.com/${username}/`}));
  }
}
export function instagramStageError(stage: InstagramStage, error: unknown): InstagramConnectionError {
  if (error instanceof InstagramConnectionError) return error;
  const metaReason = error instanceof ProviderHttpError ? error.metaReason : undefined;
  const code = metaReason ? { invalid_client_secret: "instagram_client_secret_invalid", invalid_client_id: "instagram_client_id_invalid", redirect_uri_mismatch: "instagram_redirect_mismatch", authorization_code_used: "oauth_expired" }[metaReason] : `instagram_${stage}_failed`;
  return new InstagramConnectionError(code, {
    stage,
    reason: error instanceof ProviderHttpError ? "http_error" : error instanceof OutreachError && error.code === "provider_unavailable" ? "unavailable" : "response_invalid",
    ...(error instanceof ProviderHttpError ? { httpStatus: error.status, graphCode: error.providerCode, graphSubcode: error.providerSubcode } : {}),
    ...(metaReason ? { metaReason } : {}),
  });
}

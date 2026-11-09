import { OutreachError } from "./contracts";
import { ProviderHttpError } from "./provider-http";

export type InstagramStage = "code_exchange" | "token_inspection" | "account_lookup";
type Reason = "http_error" | "unavailable" | "response_invalid" | "token_invalid" | "app_mismatch" | "token_type" | "token_expired" | "permission_missing";
type Diagnostic = { stage: InstagramStage; reason: Reason; httpStatus?: number; graphCode?: number; graphSubcode?: number };
export class InstagramConnectionError extends OutreachError {
  constructor(code: string, public diagnostic: Diagnostic) { super(code); }
}
export function instagramStageError(stage: InstagramStage, error: unknown): InstagramConnectionError {
  if (error instanceof InstagramConnectionError) return error;
  return new InstagramConnectionError(`instagram_${stage}_failed`, {
    stage,
    reason: error instanceof ProviderHttpError ? "http_error" : error instanceof OutreachError && error.code === "provider_unavailable" ? "unavailable" : "response_invalid",
    ...(error instanceof ProviderHttpError ? { httpStatus: error.status, graphCode: error.providerCode, graphSubcode: error.providerSubcode } : {}),
  });
}

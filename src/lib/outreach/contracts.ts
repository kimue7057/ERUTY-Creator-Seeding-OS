import { z } from "zod";

export const providerSchema = z.enum(["google", "instagram", "tiktok"]);
export type SenderProvider = z.infer<typeof providerSchema>;
export const providerNames: Record<SenderProvider, string> = { google: "Google 이메일", instagram: "Instagram", tiktok: "TikTok" };
export const senderAddressSchema = z.object({ address: z.string().min(1).max(254), label: z.string().max(150), primary: z.boolean() });
export type SenderAddress = z.infer<typeof senderAddressSchema>;
export const registerAccountSchema = z.object({ provider: providerSchema, label: z.string().trim().min(1).max(80), identity: z.string().trim().min(1).max(254) }).superRefine((v, ctx) => {
  const valid = v.provider === "google" ? z.email().safeParse(v.identity).success : /^@?[a-zA-Z0-9._]{1,30}$/.test(v.identity);
  if (!valid) ctx.addIssue({ code: "custom", path: ["identity"], message: "이메일 주소 또는 SNS 아이디를 확인하세요." });
});
export const normalizeIdentity = (value: string) => value.trim().replace(/^@/, "").toLowerCase();
export const senderStates = { pending: "로그인 연결 필요", connected: "계정 연결됨", reconnect: "재연결 필요", disconnected: "연결 해제됨" } as const;
export class OutreachError extends Error {
  constructor(public code: string) { super(code); }
}
export function outreachErrorMessage(error: unknown): string {
  const messages: Record<string, string> = {
    instagram_code_exchange_failed: "Meta 로그인 후 인증 정보를 발급받는 단계에서 실패했습니다. 서비스 연결 설정의 Meta 앱 ID·시크릿과 로그인 완료 주소를 확인해야 합니다.",
    instagram_token_inspection_failed: "Meta에서 발급한 인증 정보를 검증하지 못했습니다. 연결은 완료되지 않았습니다. 서버에 기록된 검증 오류를 확인해야 합니다.",
    instagram_account_lookup_failed: "Meta 로그인은 진행됐지만 Instagram 계정 조회에 실패했습니다. 앱의 Instagram 권한과 공유된 계정 설정을 확인해야 합니다.",
    instagram_app_mismatch: "Meta에서 발급한 인증 정보가 ERUTY에 등록한 앱과 다릅니다. Meta 앱 ID·시크릿·구성 ID가 같은 앱의 값인지 확인하세요.",
    instagram_token_type: "Meta 구성이 Unified Login에서 사용하는 시스템 사용자 인증을 발급하지 않았습니다. Meta의 로그인 구성에서 액세스 토큰 유형을 확인하세요.",
    instagram_no_accounts: "Meta에서 공유된 Instagram 계정을 찾지 못했습니다. 프로페셔널 계정·비즈니스 자산 연결·테스터 초대 수락과 로그인 시 계정 선택을 확인하세요.",
    instagram_account_not_shared: "등록한 Instagram 계정이 이번 로그인에서 공유되지 않았습니다. 로그인 권한 화면에서 해당 계정을 선택하세요.",
    instagram_accounts_incomplete: "Meta 계정 목록 전체를 확인하지 못했습니다. 연결할 Instagram 계정만 선택한 뒤 다시 로그인하세요.",
    test_changed: "테스트 요청의 주소가 변경됐습니다. 새 테스트를 시작해 주세요.",
    test_rate_limit: "이 계정에서 최근 10분 동안 테스트 메일 5통을 요청했습니다. 잠시 후 다시 시도해 주세요.",
    replacement_required: "기존 연결 정보를 교체하면 연결된 계정의 재로그인이 필요합니다. 교체 확인을 선택하세요.",
    placeholders_remaining: "메시지에 {{…}} 빈 항목이 남아 있습니다. 실제 내용으로 작성한 뒤 보내세요.",
    forbidden: "이 작업은 관리자 또는 캠페인 매니저만 할 수 있습니다.",
    not_found: "이 계정을 현재 워크스페이스에서 찾을 수 없습니다.",
    not_configured: "서비스의 로그인 연결 설정이 아직 필요합니다. 아래 연결 설정 안내를 확인하세요.",
    oauth_expired: "연결 요청이 만료됐거나 다른 로그인에서 열렸습니다. 계정 연결을 다시 시작하세요.",
    oauth_denied: "로그인 연결이 취소되었습니다. 기존 계정과 초안은 유지됩니다.",
    wrong_identity: "등록한 주소·아이디와 로그인한 계정이 다릅니다. 연결할 계정으로 다시 로그인하세요.",
    permission_missing: "필요한 권한이 승인되지 않았습니다. 계정 연결에서 권한을 확인해 주세요.",
    reconnect: "인증이 만료되거나 해제되었습니다. 발신 계정을 다시 연결하세요.",
    provider_unavailable: "계정 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    provider_invalid: "계정 서비스 응답을 확인하지 못했습니다. 연결은 완료되지 않았습니다.",
    duplicate: "같은 계정이 이미 등록되어 있습니다. 기존 계정에서 연결을 진행하세요.",
    busy: "계정 연결 또는 발송 작업이 진행 중입니다. 잠시 후 다시 시도하세요.",
    recipient_required: "받는 사람의 연락처와 확인한 출처를 입력하세요.",
    stale: "선정 또는 원본 자료가 변경되었습니다. 후보를 다시 검토한 뒤 연락을 진행하세요.",
    social_unavailable: "이 SNS 계정의 메시지 발송 연결이 아직 완료되지 않았습니다. 계정 연결만으로 DM을 보낼 수는 없습니다.",
    send_unknown: "발송 결과를 확정하지 못했습니다. 중복 발송을 막기 위해 재전송을 중지했습니다. 발신 메일함을 확인하세요.",
    send_failed: "메일 서비스가 발송을 거절했습니다. 연결 상태와 수신 주소를 확인하세요.",
    draft_changed: "초안이 다른 화면에서 변경됐거나 이미 발송되었습니다. 새로고침해 주세요.",
  };
  if (error instanceof z.ZodError) return "입력 내용을 확인하세요. 이메일·주소·필수 항목의 형식이 올바르지 않습니다.";
  return error instanceof OutreachError ? messages[error.code] ?? "요청을 완료하지 못했습니다. 새로고침 후 다시 시도하세요." : "요청을 완료하지 못했습니다. 잠시 후 다시 시도하세요.";
}

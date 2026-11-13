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
export const instagramSystemUserInputSchema = z.object({
  accessToken: z.string().trim().min(20).max(16384).refine(value => !/[\s\u0000-\u001f]/.test(value)),
  revision: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime({ offset: true }),
  confirmed: z.literal(true),
}).strict();
export const senderStates = { pending: "로그인 연결 필요", connected: "계정 연결됨", reconnect: "재연결 필요", disconnected: "연결 해제됨" } as const;
export class OutreachError extends Error {
  constructor(public code: string) { super(code); }
}
export function parseInstagramSystemUserInput(input:unknown) {
  const result=instagramSystemUserInputSchema.safeParse(input);
  if(result.success)return result.data;
  const fields=new Set(result.error.issues.map(issue=>issue.path[0]));
  if(fields.has("accessToken")){
    const value=input&&typeof input==="object"&&"accessToken" in input?input.accessToken:undefined;
    if(typeof value!=="string"||!value.trim())throw new OutreachError("instagram_token_required");
    if(/\s/.test(value.trim()))throw new OutreachError("instagram_token_whitespace");
    throw new OutreachError("instagram_token_format");
  }
  if(fields.has("confirmed"))throw new OutreachError("connection_confirmation_required");
  throw new OutreachError("connection_form_invalid");
}
export function outreachErrorMessage(error: unknown): string {
  const messages: Record<string, string> = {
    ai_key_required:"OpenRouter API 키를 입력하세요. 키는 채팅이 아닌 설정 화면에 입력합니다.",
    ai_key_invalid:"OpenRouter API 키 인증에 실패했습니다. 키의 유효성과 권한을 확인하세요.",
    ai_credit_required:"OpenRouter 크레딧 또는 이 키의 사용 한도가 부족합니다. OpenRouter에서 확인하세요.",
    ai_access_denied:"OpenRouter에서 요청을 허용하지 않았습니다. 키와 모델 접근 권한을 확인하세요.",
    ai_model_unavailable:"선택한 모델이나 구조화된 문장 출력을 사용할 수 없습니다. 모델 ID와 지원 여부를 확인하세요.",
    ai_rate_limited:"OpenRouter 요청 한도에 도달했습니다. 잠시 후 다시 시도하세요.",
    ai_provider_unavailable:"OpenRouter 응답을 받지 못했습니다. 연결 상태를 확인하고 다시 요청하세요.",
    ai_response_invalid:"AI 응답의 형식이나 작성 근거를 확인하지 못했습니다. 본문은 바꾸지 않았습니다.",
    mail_read_required:"이메일 답장 조회 권한이 필요합니다. 발신 계정에서 ‘이메일 답장 수신도 연결’을 선택해 Google에 다시 로그인하세요.",
    mail_read_failed:"회사 메일에서 대화를 불러오지 못했습니다. 연결 상태를 확인하고 다시 조회하세요.",
    mail_response_invalid:"메일 서비스 응답을 확인하지 못했습니다. 메일은 발송하지 않았습니다.",
    mail_thread_mismatch:"원래 발송한 메일과 참여자를 확인하지 못했습니다. 회사 메일함에서 대상을 확인하세요. 다른 주소로 자동 회신하지 않습니다.",
    contact_changed:"새 메시지가 도착했거나 다른 담당자가 변경했습니다. 최신 대화를 다시 읽고 전송을 확인하세요.",
    contact_closed:"보류·종료 상태이거나 보관된 캠페인입니다. 업무 상태를 확인한 뒤 회신하세요.",
    contact_inbound_required:"받은 답장을 먼저 동기화해야 회신할 수 있습니다. 대화를 새로고침하세요.",
    browser_outreach_offline:"연락용 브라우저 실행기가 연결되지 않았습니다. 실행 PC의 Codex·브라우저와 연락 작업 설정을 확인하세요.",
    browser_outreach_pending:"이 수신자에게 진행 중이거나 결과가 확인되지 않은 발송이 있습니다. 발송 기록을 먼저 확인하세요.",
    browser_outreach_claim_expired:"브라우저 작업 권한이 만료됐거나 실행기가 바뀌었습니다. 같은 메시지를 자동으로 다시 보내지 않습니다.",
    browser_outreach_observation_invalid:"선택한 회사 계정·수신자·본문과 실제 브라우저 화면이 일치하는지 확인해야 합니다.",
    instagram_dm_mode_required:"Instagram DM에는 Unified Login으로 연결한 회사 계정이 필요합니다.",
    instagram_dm_inbound_required:"이 상대가 회사 계정에 먼저 보낸 메시지를 확인해야 답장할 수 있습니다.",
    instagram_dm_window_closed:"마지막 수신 메시지로부터 24시간이 지났습니다. 상대가 새 메시지를 보내면 답장할 수 있습니다.",
    instagram_dm_access_required:"Meta가 대화 접근을 허용하지 않았습니다. instagram_manage_messages 권한, 계정의 메시지 접근 허용 및 앱의 테스트·검수 상태를 확인하세요.",
    instagram_dm_rate_limited:"Meta의 요청 한도에 도달했습니다. 잠시 후 다시 확인하세요.",
    instagram_dm_read_failed:"Meta에서 대화를 불러오지 못했습니다. 잠시 후 대화를 새로고침하세요.",
    instagram_dm_response_invalid:"Meta의 대화 응답을 확인하지 못했습니다. 메시지는 전송하지 않았습니다.",
    instagram_dm_conversation_missing:"선택한 발신 계정에서 이 대화를 찾지 못했습니다. 대화 목록을 새로 불러오세요.",
    instagram_dm_thread_unsupported:"이 대화의 참여자를 확인하지 못했습니다. 현재는 두 계정 사이의 대화만 지원합니다.",
    instagram_dm_recipient_changed:"대화 상대가 선정한 크리에이터와 일치하지 않습니다. 계정 아이디와 대화를 다시 확인하세요.",
    instagram_dm_request_changed:"이미 처리된 발송 요청의 내용이 달라졌습니다. 발송 기록을 확인하세요.",
    instagram_dm_send_rejected:"Meta가 DM 발송을 거절했습니다. 권한·대화 상태를 확인한 뒤 새 요청으로 시도하세요.",
    instagram_dm_send_unknown:"DM 발송 결과를 확정하지 못했습니다. 중복 전송을 막기 위해 이 대화의 추가 발송을 중지했습니다. Instagram 대화와 발송 기록을 확인하세요.",
    instagram_token_required: "Meta 시스템 사용자 토큰을 붙여넣으세요.",
    instagram_token_whitespace: "토큰 중간에 공백 또는 줄바꿈이 있습니다. Meta의 토큰 복사 기능으로 다시 복사해 붙여넣으세요.",
    instagram_token_format: "Meta에서 발급한 액세스 토큰 전체를 입력하세요. 앱 ID나 앱 시크릿을 입력하는 칸이 아닙니다.",
    connection_confirmation_required: "해당 계정의 인증 정보 교체 확인란을 체크하세요.",
    connection_form_invalid: "연결 화면의 정보를 읽지 못했습니다. 발신 계정 페이지를 새로고침한 뒤 다시 시도하세요.",
    instagram_connection_data_invalid: "ERUTY의 Instagram 연결 설정을 읽지 못했습니다. 서비스 연결 설정을 확인해야 합니다. 토큰의 유효성을 확인한 상태는 아닙니다.",
    instagram_system_user_account_mismatch: "토큰으로 조회된 Instagram 계정이 등록된 아이디와 다릅니다. 아래 확인된 계정과 Meta의 자산 할당을 비교하세요.",
    instagram_client_secret_invalid: "Meta가 저장된 앱 시크릿을 유효하지 않다고 확인했습니다. Meta 앱 설정 → 기본 정보의 앱 시크릿을 다시 복사해 서비스 연결 설정에 저장하세요.",
    instagram_client_id_invalid: "Meta가 저장된 앱 ID를 유효하지 않다고 확인했습니다. Meta 앱 설정의 앱 ID를 확인해 서비스 연결 설정에 저장하세요.",
    instagram_redirect_mismatch: "Meta가 로그인 완료 주소 불일치를 반환했습니다. Meta에 등록한 주소와 ERUTY의 로그인 완료 주소를 정확히 일치시켜 주세요.",
    instagram_app_credentials_failed: "저장된 Meta 앱 인증 정보를 확인하지 못했습니다. 서버의 앱 점검 오류를 확인해야 합니다. 계정 연결은 완료되지 않았습니다.",
    instagram_code_exchange_failed: "Meta 로그인 후 인증 정보를 발급받는 단계에서 실패했습니다. 서비스 연결 설정의 Meta 앱 ID·시크릿과 로그인 완료 주소를 확인해야 합니다.",
    instagram_token_inspection_failed: "Meta에서 발급한 인증 정보를 검증하지 못했습니다. 연결은 완료되지 않았습니다. 서버에 기록된 검증 오류를 확인해야 합니다.",
    instagram_account_lookup_failed: "Meta 로그인은 진행됐지만 Instagram 계정 조회에 실패했습니다. 앱의 Instagram 권한과 공유된 계정 설정을 확인해야 합니다.",
    instagram_app_mismatch: "Meta에서 발급한 인증 정보가 ERUTY에 등록한 앱과 다릅니다. Meta 앱 ID·시크릿·구성 ID가 같은 앱의 값인지 확인하세요.",
    instagram_token_type: "이 연결 방식에는 Meta 시스템 사용자 토큰이 필요합니다. 일반 사용자 토큰·앱 토큰·Instagram 단독 로그인 토큰은 사용할 수 없습니다.",
    instagram_system_user_no_accounts: "토큰은 유효하지만 연결할 Instagram 계정이 할당되지 않았습니다. Meta 비즈니스 설정 → 사용자 → 시스템 사용자에서 해당 사용자에게 Instagram 자산을 할당했는지 확인하세요.",
    connection_changed: "계정 또는 회사 앱 설정이 다른 화면에서 변경됐습니다. 새로고침한 뒤 연결을 진행하세요.",
    instagram_no_accounts: "Meta 인증은 확인했지만, 할당 계정 목록과 인증 권한에서 연결할 Instagram 계정을 확인하지 못했습니다. 로그인에서 계정을 선택했다면 비즈니스 자산 권한을 추가 확인해야 합니다.",
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

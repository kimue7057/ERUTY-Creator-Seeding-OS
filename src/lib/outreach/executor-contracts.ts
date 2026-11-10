import {z} from "zod";
export const outreachExtensionId="fcmgjacgdcgdmgofiahpipaojnkpapao";
export const executorPairInput=z.strictObject({code:z.string().regex(/^[a-f0-9]{64}$/),extension_id:z.literal(outreachExtensionId)});
export const executorHeartbeat=z.strictObject({observed_username:z.string().regex(/^[a-z0-9._]{1,30}$/).or(z.literal("")),reason:z.enum(["ready","login_required","sender_mismatch","browser_unavailable","platform_restricted","captcha"])});
export const executorReasonLabels:Record<string,string>={ready:"회사 계정 확인 완료",login_required:"회사 Instagram 로그인 필요",sender_mismatch:"로그인 계정 불일치",browser_unavailable:"Instagram 탭 연결 확인 필요",platform_restricted:"Instagram 제한 확인 필요",captcha:"Instagram 본인 확인 필요"};

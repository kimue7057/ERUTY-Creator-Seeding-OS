import { z } from "zod";

export const testEmailSubject = "[ERUTY] 이메일 연결 테스트";
export const testEmailBody = "ERUTY 회사 이메일 연결 및 발송 테스트입니다. 정상 수신 여부를 확인해 주세요.";
export const testEmailInput = z.object({
  id: z.uuid(), accountId: z.uuid(),
  fromAddress: z.email().max(254), toAddress: z.email().max(254),
  confirmed: z.literal(true),
}).strict();
export type ConnectionTestResult = {
  id: string; fromAddress: string; toAddress: string;
  status: "sending" | "sent" | "failed" | "unknown";
  errorCode: string | null; providerMessageId: string | null;
  createdAt: string; sentAt: string | null;
};

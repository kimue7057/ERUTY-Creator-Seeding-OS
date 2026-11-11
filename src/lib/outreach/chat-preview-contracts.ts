import {z} from 'zod';
import {browserUiDiagnostic} from './browser-contracts';
export const chatPreviewInput=z.strictObject({id:z.uuid(),accountId:z.uuid(),campaignId:z.uuid(),candidateIds:z.array(z.uuid()).min(1).max(15).refine(v=>new Set(v).size===v.length),goal:z.number().int().min(1).max(5)});
export const chatPreviewGrant=z.strictObject({job_id:z.uuid(),claim_token:z.string().regex(/^[a-f0-9]{64}$/)});
export const chatPreviewResult=z.strictObject({candidate_id:z.uuid(),recipient:z.string().regex(/^[a-z0-9._]{1,30}$/),state:z.enum(['opened','unavailable']),reason:z.enum(['chat_opened','recipient_unavailable','browser_unavailable','sender_mismatch','login_required','captcha','platform_restricted']),source_url:z.url().nullable(),observed_at:z.iso.datetime(),draft_present:z.boolean().default(false),ui_diagnostic:browserUiDiagnostic.optional()});
export const chatPreviewFinish=chatPreviewGrant.extend({results:z.array(chatPreviewResult).max(15)});
export type ChatPreviewTarget={candidate_id:string;recipient:string;profile_url:string};
export type ChatPreviewResult=z.infer<typeof chatPreviewResult>;
export const chatPreviewStates={queued:'채팅창 열기 대기',running:'채팅창 확인 중',completed:'채팅창 열기 완료',partial:'일부 채팅창 열림',blocked:'채팅창을 열지 못함'} as const;

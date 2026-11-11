import {z} from 'zod';
export const reviewBody=z.string().trim().min(1).max(1000);
export const reviewSaveInput=z.strictObject({id:z.uuid(),sourcePreviewId:z.uuid(),candidateId:z.uuid(),revision:z.number().int().min(0),contextSha256:z.string().regex(/^[a-f0-9]{64}$/),body:reviewBody,basis:z.string().trim().max(2000),evidenceIds:z.array(z.uuid()).max(10).refine(v=>new Set(v).size===v.length)});
export const reviewSendInput=z.strictObject({id:z.uuid(),projectId:z.uuid(),accountId:z.uuid(),items:z.array(z.strictObject({draftId:z.uuid(),revision:z.number().int().positive()})).min(1).max(5).refine(v=>new Set(v.map(i=>i.draftId)).size===v.length),confirmed:z.literal(true)});
export type ReviewBatchItem={draftId:string;revision:number};
export const reviewStatusLabels={draft:'초안',sending:'발송 진행 중',sent:'화면에서 발송 확인',failed:'발송 전 중단',unknown:'결과 확인 필요'} as const;

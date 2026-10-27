import {z} from "zod";
export const RUBRIC = {product_fit:30,brand_style:20,target_audience:20,content_activity:15,engagement:10,partnership:5} as const;
export const LABELS = {product_fit:"제품 적합도",brand_style:"브랜드 스타일",target_audience:"타깃 적합도",content_activity:"콘텐츠·활동",engagement:"참여도",partnership:"협업 가능성"} as const;
const text=(max:number)=>z.string().trim().min(1).max(max).refine(v=>! /\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{20,}|(?:access_token|refresh_token|password|client_secret)\s*[:=]/i.test(v),"Do not store credentials");
const criterion=(max:number)=>z.strictObject({score:z.number().int().min(0).max(max).nullable(),confidence:z.number().min(0).max(1),reason:text(1200),evidence_ids:z.array(z.uuid()).max(20)});
export const evaluationReason=text(2000);
export const evaluationOutput=z.strictObject({rubric_version:z.literal(1),criteria:z.strictObject({product_fit:criterion(30),brand_style:criterion(20),target_audience:criterion(20),content_activity:criterion(15),engagement:criterion(10),partnership:criterion(5)}),confidence:z.number().min(0).max(1),summary:text(2000),risk_flags:z.array(text(300)).max(15)});
export type EvaluationOutput=z.infer<typeof evaluationOutput>;
export class EvaluationError extends Error {constructor(public code:string){super(code);}}
export function validateScores(input:unknown,ids:readonly string[]) {
 const output=evaluationOutput.parse(input), allowed=new Set(ids);
 for(const criterion of Object.values(output.criteria)) {
  if(new Set(criterion.evidence_ids).size!==criterion.evidence_ids.length||criterion.evidence_ids.some(id=>!allowed.has(id)))throw new EvaluationError("evidence_not_allowed");
  if(criterion.score!==null&&!criterion.evidence_ids.length)throw new EvaluationError("scored_reason_needs_evidence");
 }
 const known=Object.values(output.criteria).filter(c=>c.score!==null);
 return {output,knownSubtotal:known.reduce((n,c)=>n+c.score!,0),total:known.length===6?known.reduce((n,c)=>n+c.score!,0):null,unknownCount:6-known.length};
}

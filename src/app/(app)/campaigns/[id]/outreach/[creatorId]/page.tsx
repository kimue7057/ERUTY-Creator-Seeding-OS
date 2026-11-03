import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { evaluationService } from "@/lib/evaluation/service";
import { assessmentFingerprint } from "@/lib/evaluation/shortlist-policy";
import { accountService } from "@/lib/outreach/accounts";
import { draftService } from "@/lib/outreach/drafts";
import { outreachAiReady } from "@/lib/outreach/ai";
import { OutreachWizard } from "@/components/outreach/outreach-wizard";
export default async function OutreachPage({params,searchParams}:{params:Promise<{id:string;creatorId:string}>;searchParams:Promise<{draft?:string}>}) {
  const actor=await requireActor(),{id,creatorId}=await params,{draft:requested}=await searchParams;
  const detail=await evaluationService().detail(actor,id,creatorId);
  if(!detail.can_outreach)return <section className="surface outreach-stage"><h1>크리에이터 선정 상태를 확인하세요</h1><p>최종 선정이 완료되고 평가·원본 자료가 유효한 후보에게 연락할 수 있습니다.</p><Link className="btn" href={`/campaigns/${id}?tab=selected`}>선정 명단으로</Link></section>;
  const [accounts,history]=await Promise.all([accountService().list(actor),draftService().list(actor,id,creatorId)]);
  const existing=requested?history.find(d=>d.id===requested):history.find(d=>d.status==="draft"&&d.inputSha256===assessmentFingerprint(detail.snapshot));
  const initial=existing??{id:randomUUID(),campaignId:id,creatorAccountId:creatorId,inputSha256:assessmentFingerprint(detail.snapshot),revision:0,channel:"email" as const,subject:"",body:"",template:"letter" as const,senderAccountId:null,fromAddress:"",toAddress:"",recipientSource:"",status:"draft",sentAt:null};
  return <OutreachWizard key={initial.id} initial={initial} creatorName={detail.snapshot.creator.display_name||detail.snapshot.creator.handle||"크리에이터"} profile={detail.snapshot.creator.profile_url} assessment={detail.history[0].output} evidence={detail.snapshot.evidence.map(e=>({id:e.id,url:e.source_url,observedAt:e.observed_at}))} accounts={accounts} aiReady={outreachAiReady()} writable={canWrite(actor)} history={history}/>;
}

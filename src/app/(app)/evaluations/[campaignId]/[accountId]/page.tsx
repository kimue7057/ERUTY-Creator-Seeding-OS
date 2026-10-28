import { assessmentFingerprint } from "@/lib/evaluation/shortlist-policy";
import Link from "next/link";
import {randomUUID} from "node:crypto";
import {notFound} from "next/navigation";
import {requireActor} from "@/lib/auth/session";
import {canWrite} from "@/lib/auth/permissions";
import {safeId} from "@/lib/validation/projects";
import {evaluationService,evaluationPrompt} from "@/lib/evaluation/service";
import {evaluationAiConfig} from "@/lib/evaluation/provider";
import {EvaluationError,RUBRIC,LABELS} from "@/lib/evaluation/contracts";
import {PageHeading} from "@/components/ui";
import {EvaluationForm,EvaluationReviewForm} from "@/components/evaluation/forms";
import {Timestamp} from "@/components/discovery/display";
export default async function EvaluationDetail({params}:{params:Promise<{campaignId:string;accountId:string}>}){
 const {campaignId,accountId}=await params,actor=await requireActor();if(!safeId(campaignId)||!safeId(accountId))notFound();
 if(process.env.EVALUATION_ENABLED!=="true")notFound();
 const detail=await evaluationService().detail(actor,campaignId,accountId).catch(error=>{if(error instanceof EvaluationError&&error.code==="evaluation_not_found")notFound();throw error;});
 const latest=detail.history[0],fresh=latest?.inputSha256===(detail.automatic_assessment ? assessmentFingerprint(detail.snapshot) : detail.input_sha256);
 return <><div className="mb-5 text-xs muted"><Link href="/evaluations">검토함</Link> / <Link href={`/campaigns/${campaignId}/discovery/creators/${accountId}`}>원본 근거</Link></div><PageHeading eyebrow="Evaluation history" title={detail.snapshot.creator.display_name??detail.snapshot.creator.handle??"크리에이터 평가"} description={`${detail.campaign.title} · 브리프 v${detail.campaign.briefVersion}`}/>
  <p className="info-banner"><Link href={process.env.CODEX_DISCOVERY_ENABLED === "true" && process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED === "true" ? `/campaigns/${campaignId}?tab=recommended&filter=all&candidate=${accountId}` : `/campaigns/${campaignId}/discovery/creators/${accountId}`} className="source-link">캠페인에서 후보 검토 · 최종 선정 →</Link></p>
  {!detail.automatic_assessment&&!detail.ready_for_step4&&<p className="info-banner">SNS 근거 검토 대기입니다. 평가 초안을 보존할 수 있으며 최종 승인은 근거 검토 후 가능합니다.</p>}
  {latest&&!fresh&&<p className="info-banner">브리프·타깃·원본 근거 또는 검토 상태가 변경됐습니다. 이전 점수는 이력으로 보존되며 새 평가가 필요합니다.</p>}
  <div className="flex gap-2 mb-5"><span className="badge">{detail.can_outreach?"담당자 승인 · 후속 작업 대상":"후속 작업 승인 전"}</span><span className="badge">원본 근거 {detail.snapshot.evidence.length}건</span></div>
  <section className="surface panel-body"><h2>평가 기준</h2><p className="description">제품 30 · 스타일 20 · 타깃 20 · 콘텐츠 15 · 참여도 10 · 협업 5. 미확인 항목은 0점으로 바꾸지 않습니다.</p>
  {detail.history.map(row=><article className="mt-6" key={row.id}><h3>{row.total===null?`확인 가능한 항목 합계 ${row.knownSubtotal}점 · 미확인 ${row.unknownCount}개`:`총점 ${row.total}/100`}</h3><p className="description">{row.promptVersion==="campaign-shortlist-v1"?"Codex 자동 평가":row.source==="openai_api"?"서버 AI 평가":row.source==="codex_import"?"Codex 평가 가져오기 · 출처는 사용자 입력":"Work 평가 가져오기 · 출처는 사용자 입력"} · {row.model} · 신뢰도 {Math.round(row.output.confidence*100)}% · <Timestamp value={row.createdAt}/></p><p className="body-copy">{row.output.summary}</p>
  <div className="overflow-x-auto"><table className="table min-w-[640px]"><thead><tr><th>항목</th><th>점수</th><th>판단 근거</th></tr></thead><tbody>{(Object.keys(RUBRIC) as (keyof typeof RUBRIC)[]).map(key=><tr key={key}><td>{LABELS[key]}</td><td>{row.output.criteria[key].score===null?"미확인":`${row.output.criteria[key].score}/${RUBRIC[key]}`}</td><td>{row.output.criteria[key].reason}<div className="flex gap-2 flex-wrap mt-2">{row.output.criteria[key].evidence_ids.map(id=><Link key={id} href={`/campaigns/${campaignId}/discovery/creators/${accountId}`} className="badge">근거 {id.slice(0,8)}</Link>)}</div></td></tr>)}</tbody></table></div><ul className="description mt-3">{row.output.risk_flags.map(flag=><li key={flag}>{flag==="audience_country_unverified"?"시청자 국가 미확인":flag==="discovery_verification_pending"?"SNS 원본 근거 검토 대기":flag}</li>)}</ul>
  <section aria-label="평가 검토 이력">{detail.decisions.filter(d=>d.evaluationId===row.id).map(d=><div key={d.id} className="review-record"><span className="badge">{d.verdict==="approved"?"승인":d.verdict==="hold"?"보류":"제외"}</span> <Timestamp value={d.createdAt}/><p>{d.reason}</p></div>)}</section>
  {canWrite(actor)&&row.promptVersion!=="campaign-shortlist-v1"&&<details className="review-disclosure"><summary>이 평가 검토하기</summary><EvaluationReviewForm campaignId={campaignId} accountId={accountId} evaluationId={row.id} requestKey={randomUUID()} canApprove={row.id===latest?.id&&fresh&&detail.ready_for_step4}/></details>}</article>)}
  {!latest&&<p className="description mt-5">저장된 평가가 없습니다.</p>}</section>
  {canWrite(actor)&&!detail.automatic_assessment&&<section className="surface panel-body mt-7"><h2>새 평가</h2><EvaluationForm campaignId={campaignId} accountId={accountId} inputHash={detail.input_sha256} requestKey={randomUUID()} aiReady={evaluationAiConfig().configured} discoveryReady={detail.ready_for_step4}/><details className="mt-5"><summary>AI 평가 요청 원문</summary><p className="description">아래 원문을 Codex 또는 Work에 전달하고 실제 반환된 JSON만 가져오세요. 새 SNS 관찰 요청이 아닙니다.</p><textarea className="input mt-3" readOnly rows={15} aria-label="AI 평가 요청 원문" value={evaluationPrompt(detail.snapshot)}/></details></section>}
 </>;
}

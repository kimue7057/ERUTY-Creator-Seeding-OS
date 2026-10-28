import Link from "next/link";
import {requireActor} from "@/lib/auth/session";
import {evaluationService} from "@/lib/evaluation/service";
import {PageHeading,Empty} from "@/components/ui";
export default async function Evaluations() {
 const actor=await requireActor();
 if(process.env.EVALUATION_ENABLED!=="true")return <Empty title="평가 기능 준비 중" text="운영 설정이 완료되면 평가와 검토를 시작할 수 있습니다."/>;
 const rows=await evaluationService().list(actor);
 const campaigns=[...new Map(rows.map(r=>[r.campaignId,{id:r.campaignId,title:r.title}])).values()];
 return <><PageHeading eyebrow="Creator shortlist" title="추천 후보 · 승인" description="캠페인에서 자동 평가한 추천 후보를 확인하고 최종 승인하세요."/><p className="info-banner">발굴 요청부터 자동 평가, 추천 명단과 사용자 승인까지 캠페인 한곳에서 이어집니다.</p>{campaigns.length?<div className="project-grid mt-7">{campaigns.map(c=><Link key={c.id} className="project-card" href={`/campaigns/${c.id}`}><div className="eyebrow mb-4">캠페인</div><h2>{c.title}</h2><p className="description">저장된 후보 {rows.filter(r=>r.campaignId===c.id).length}명</p><div className="card-footer">추천 후보 확인 · 최종 승인 →</div></Link>)}</div>:<Empty title="추천 후보를 찾기 시작하세요" text="캠페인에서 발굴을 요청하면 SNS 근거를 평가해 추천 명단을 올려드립니다." href="/campaigns" label="캠페인 열기"/>}</>;
}

import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { draftService } from "@/lib/outreach/drafts";
import { PageHeading } from "@/components/ui";
import {reviewOutreachService} from '@/lib/outreach/review-service';
const statuses={draft:"작성 중",sent:"발송 완료",failed:"발송 실패",unknown:"결과 확인 필요",sending:"발송 처리 중"};
const channels={email:"이메일",instagram:"Instagram DM",tiktok:"TikTok 메시지"};
export default async function OutreachList({searchParams}:{searchParams:Promise<{status?:string;channel?:string;search?:string;page?:string}>}) {
  const actor=await requireActor(),query=await searchParams,page=Math.min(10000,Math.max(1,Math.floor(Number(query.page)||1)));
  const [rows,projectReviews]=await Promise.all([draftService().workspace(actor,{...query,page}),reviewOutreachService().projects(actor)]);
  const url=(p:number)=>`/outreach?${new URLSearchParams({...query,page:String(p)})}`;
  return <><PageHeading eyebrow="WORKSPACE · OUTREACH" title="초안·발송 기록" description="선정한 크리에이터에게 보낼 메시지를 이어서 작성하고, 실제 발송 상태를 확인하세요."/>
    <div className="outreach-intro"><Link className="btn btn-primary" href="/campaigns">선정 명단에서 새 연락 시작 →</Link><div><Link className="btn" href="/outreach/instagram">Instagram DM</Link><Link className="btn" href="/settings/templates">템플릿·서명</Link><Link className="btn" href="/settings/accounts">발신 계정</Link></div></div>
    {projectReviews.length>0&&<section className="surface outreach-stage"><h2>프로젝트 협업 문의</h2><p className="description">크리에이터별 작성 근거·문안·DM 미리보기를 검토하고 회사 계정으로 연락하세요.</p><div className="outreach-records">{projectReviews.map(project=><article className="outreach-record" key={project.id}><div><h3>{project.name}</h3><p className="description">초안 {project.drafts}명 · 진행 {project.pending}명 · 발송 확인 {project.sent}명{project.unknown?` · 결과 확인 필요 ${project.unknown}명`:''}</p></div><Link className="btn btn-primary" href={`/projects/${project.id}/outreach`}>문안 검토·발송 →</Link></article>)}</div></section>}
    <form className="outreach-list-filter surface"><label>검색<input className="input" name="search" defaultValue={query.search} placeholder="크리에이터·캠페인·제목" maxLength={150}/></label><label>연락 채널<select className="input" name="channel" defaultValue={query.channel??""}><option value="">모든 채널</option>{Object.entries(channels).map(([key,value])=><option key={key} value={key}>{value}</option>)}</select></label><label>상태<select className="input" name="status" defaultValue={query.status??""}><option value="">모든 상태</option>{Object.entries(statuses).map(([key,value])=><option key={key} value={key}>{value}</option>)}</select></label><button className="btn" type="submit">조회</button></form>
    <div className="outreach-records">{rows.slice(0,25).map(row=><article className="surface outreach-record" key={row.id}><div><p className="eyebrow">{channels[row.channel]} · {row.platform}</p><h2>{row.creatorName||row.handle||"크리에이터"}</h2><p className="description">{row.campaignTitle}</p></div><div><strong>{row.subject||"제목 없는 초안"}</strong><p className="description">{row.fromAddress||"발신 미선택"} → {row.toAddress||"수신 미입력"}</p><p className="description">{row.updatedAt.toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</p></div><span className={`badge ${row.status==="sent"?"badge-green":""}`}>{statuses[row.status]}</span><Link className="btn" href={`/campaigns/${row.campaignId}/outreach/${row.creatorAccountId}?draft=${row.id}`}>{row.status==="draft"?"이어서 작성":"기록 보기"} →</Link></article>)}</div>
    {!rows.length&&<section className="surface outreach-stage"><h2>해당하는 연락 기록이 없습니다</h2><p className="description">캠페인의 선정 명단에서 ‘연락하기’를 누르면 크리에이터 분석과 함께 초안을 시작합니다.</p><Link className="source-link" href="/campaigns">캠페인 보기 →</Link></section>}
    <nav className="sender-actions" aria-label="연락 기록 페이지">{page>1&&<Link className="btn" href={url(page-1)}>이전</Link>}<span>{page}페이지</span>{rows.length>25&&<Link className="btn" href={url(page+1)}>다음</Link>}</nav>
  </>;
}

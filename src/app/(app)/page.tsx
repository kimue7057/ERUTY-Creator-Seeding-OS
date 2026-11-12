import Link from 'next/link';
import {PageHeading,Empty} from '@/components/ui';
import {requireActor} from '@/lib/auth/session';
import {canWrite} from '@/lib/auth/permissions';
import {listProjects} from '@/lib/projects/service';
import {listCampaigns} from '@/lib/campaigns/service';
import {workspaceBoards} from '@/lib/evaluation/workspace';
import {shortlistCounts,candidateGroup} from '@/lib/evaluation/presentation';
import {CampaignTable} from '@/components/campaigns/campaign-table';
import {contactService} from '@/lib/outreach/contacts';
import {draftService} from '@/lib/outreach/drafts';
import {groupContacts,campaignContactCounts} from '@/lib/outreach/contact-workspace';
export default async function Overview(){
 const actor=await requireActor();
 const [projects,campaigns,contacts,drafts]=await Promise.all([listProjects(actor),listCampaigns(actor),contactService().list(actor),draftService().summary(actor)]);
 const active=campaigns.filter(row=>row.campaign.status!=='archived'),activeIds=new Set(active.map(r=>r.campaign.id)),boards=await workspaceBoards(actor,[...activeIds]);
 const summaries=new Map(boards.map(b=>[b.campaign_id,shortlistCounts(b.candidates)])),counts=campaignContactCounts(contacts);
 const review=[...summaries.values()].reduce((n,c)=>n+c.review_pending,0),interrupted=[...summaries.values()].reduce((n,c)=>n+c.interrupted,0);
 const groups=groupContacts(contacts.filter(r=>r.origin!=='connection_test'&&(!r.campaignId||activeIds.has(r.campaignId))));
 const selectedReady=boards.reduce((n,b)=>n+b.candidates.filter(c=>candidateGroup(c)==='selected'&&!contacts.some(r=>r.campaignId===b.campaign_id&&r.creatorAccountId===c.id)).length,0);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const reply=groups.filter(g=>g.task==='회신 필요'),due=groups.filter(g=>g.primary.nextActionOn&&g.primary.nextActionOn<=today&&!['closed','declined','hold'].includes(g.primary.progress)),unknown=groups.filter(g=>g.task==='결과 확인 필요'),readIssues=groups.filter(g=>g.task==='수신 확인 필요');
 const sorted=[...active].sort((a,b)=>(counts.get(b.campaign.id)?.reply??0)-(counts.get(a.campaign.id)?.reply??0)||(summaries.get(b.campaign.id)?.review_pending??0)-(summaries.get(a.campaign.id)?.review_pending??0));
 return <><PageHeading eyebrow="TODAY'S WORK" title="오늘 할 일" description="후보 검토부터 제안 발송, 답장과 다음 연락까지 이어서 진행하세요." action={canWrite(actor)?{href:projects.length?'/campaigns/new':'/projects/new',label:projects.length?'새 캠페인':'브랜드 등록'}:undefined}/>
 <div className="journey" aria-label="시딩 업무 흐름"><Link href="/projects">브랜드·제품 준비</Link><Link href="/campaigns">발굴·평가</Link><Link href="/evaluations">후보 검토·선정</Link><Link href="/outreach?status=draft">제안 작성·발송</Link><Link href="/contacts">답장·협업</Link></div>
 <section className="todo-grid" aria-label="지금 처리할 업무">{[
  {title:'후보 검토',value:review,unit:'명',text:'평가와 원본을 보고 최종 선정',href:'/evaluations'},
  {title:'선정 후 제안 준비',value:selectedReady,unit:'명',text:'선정 명단에서 연락 시작·이어서 작성',href:'/campaigns'},
  {title:'작성 중인 제안',value:drafts.drafts,unit:'건',text:'저장한 단계에서 이어서 검토·발송',href:'/outreach?status=draft'},
  {title:'답장·회신 필요',value:reply.length,unit:'명',text:'받은 답장을 읽고 회사 계정으로 회신',href:'/contacts?task='+encodeURIComponent('회신 필요')},
  {title:'오늘까지 다음 연락',value:due.length,unit:'명',text:'약속한 연락일이 된 크리에이터',href:'/contacts?due=1'},
  {title:'수신 연결 점검',value:readIssues.length,unit:'명',text:'답장 조회 오류·권한 상태 확인',href:'/contacts?task='+encodeURIComponent('수신 확인 필요')},
 ].map(t=><Link className="surface todo-card" href={t.href} key={t.title}><span>{t.title}</span><strong>{t.value}<small>{t.unit}</small></strong><p>{t.text} →</p></Link>)}</section>
 {(drafts.unknown>0||unknown.length>0||drafts.failed>0)&&<section className="workspace-alert"><strong>발송 결과를 확인할 업무가 있습니다.</strong><div className="sender-actions">{drafts.unknown>0&&<Link className="btn" href="/outreach?status=unknown">제안 발송 결과 {drafts.unknown}건</Link>}{unknown.length>0&&<Link className="btn" href={'/contacts?task='+encodeURIComponent('결과 확인 필요')}>회신 결과 {unknown.length}명</Link>}{drafts.failed>0&&<Link className="btn" href="/outreach?status=failed">발송 중단 {drafts.failed}건</Link>}</div></section>}
 {(reply.length>0||due.length>0)&&<section><div className="section-heading"><h2>먼저 확인할 크리에이터</h2><Link className="source-link" href="/contacts">연락·협업 전체 →</Link></div><div className="todo-people">{[...new Map([...reply,...due].map(g=>[g.id,g])).values()].slice(0,5).map(g=><Link className="surface" key={g.id} href={`/contacts/${g.primary.id}`}><span className="badge badge-green">{g.task==='회신 필요'?'회신 필요':'다음 연락일 도래'}</span><strong>{g.primary.displayName}</strong><p className="description">{g.primary.projectName??'개별 연락'} · {g.primary.campaignTitle??g.primary.channel}</p></Link>)}</div></section>}
 {interrupted>0&&<p className="workspace-alert">자동 평가 {interrupted}명이 중단됐습니다. 해당 캠페인의 ‘발굴·평가 기록’에서 확인하세요.</p>}
 <div className="section-heading"><h2>이어서 진행할 캠페인</h2><Link className="source-link" href="/campaigns">전체 보기 →</Link></div><section className="surface">{sorted.length?<CampaignTable rows={sorted.slice(0,5)} summaries={summaries} contacts={counts}/>:<Empty title="첫 캠페인을 준비하세요" text="브랜드와 제품을 등록하고 탐색 조건을 정하세요. 발굴한 후보를 선정한 뒤 제안을 보낼 수 있습니다." href={canWrite(actor)?projects.length?'/campaigns/new':'/projects/new':undefined} label={projects.length?'캠페인 만들기':'브랜드 등록'}/>}</section>
 <p className="description mt-4">캠페인별 최대 200명의 후보 · 연락 대화 최근 500건 기준입니다. 수신 상태는 마지막 조회 결과이며, 연락 화면에서 새로고침할 수 있습니다.</p></>;
}

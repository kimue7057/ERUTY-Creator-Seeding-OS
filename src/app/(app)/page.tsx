import Link from "next/link";
import { PageHeading, Empty } from "@/components/ui";
import { ProjectCard } from "@/components/projects/project-card";
import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { listProjects } from "@/lib/projects/service";
import { listCampaigns } from "@/lib/campaigns/service";
import { workspaceSummaries } from "@/lib/evaluation/workspace";
import { CampaignTable } from "@/components/campaigns/campaign-table";
export default async function Overview() {
  const actor = await requireActor();
  const [projects, campaigns] = await Promise.all([listProjects(actor), listCampaigns(actor)]);
  const active = campaigns.filter(row => row.campaign.status !== "archived");
  const summaries = await workspaceSummaries(actor, active.map(row => row.campaign.id));
  const total = [...summaries.values()].reduce((sum,c) => ({ recommended: sum.recommended+c.recommended, selected: sum.selected+c.selected, processing: sum.processing+c.processing, interrupted: sum.interrupted+c.interrupted }), { recommended: 0, selected: 0, processing: 0, interrupted: 0 });
  const sorted = [...active].sort((a,b) => (summaries.get(b.campaign.id)?.recommended ?? 0) - (summaries.get(a.campaign.id)?.recommended ?? 0));
  return <><PageHeading eyebrow="Workspace" title="캠페인의 다음 할 일을 확인하세요" description="발굴을 요청하고, 자동 평가한 추천 후보를 검토해 최종 선정하세요." action={canWrite(actor) ? { href: projects.length ? "/campaigns/new" : "/projects/new", label: projects.length ? "새 캠페인" : "새 프로젝트" } : undefined} />
    <div className="workspace-counts home-counts">{[{ label: "운영 중인 캠페인", value: active.length, unit: "개", href: "/campaigns" }, { label: "검토할 추천", value: total.recommended, unit: "명", href: "/evaluations" }, { label: "자동 평가 중", value: total.processing, unit: "명", href: "/campaigns" }, { label: "최종 선정", value: total.selected, unit: "명", href: "/campaigns" }].map(item => <Link href={item.href} key={item.label}><span>{item.label}</span><strong>{item.value}<small>{item.unit}</small></strong></Link>)}</div>
    {total.recommended > 0 && <div className="workspace-next"><p>최종 선정을 기다리는 추천 후보가 {total.recommended}명 있습니다.</p><Link className="btn btn-primary" href="/evaluations">추천 후보 검토 →</Link></div>}
    {total.interrupted > 0 && <p className="workspace-alert">자동 평가 {total.interrupted}명이 중단됐습니다. 해당 캠페인의 진행·기록에서 확인할 수 있습니다.</p>}
    <div className="section-heading"><h2>이어서 진행할 캠페인</h2><Link href="/campaigns" className="source-link">전체 보기 →</Link></div><section className="surface">{sorted.length ? <CampaignTable rows={sorted.slice(0,5)} summaries={summaries} /> : <Empty title="첫 캠페인을 준비하세요" text="프로젝트와 제품을 연결하고 탐색 조건을 정하면 SNS에서 후보를 찾기 시작할 수 있습니다." href={canWrite(actor) ? projects.length ? "/campaigns/new" : "/projects/new" : undefined} label={projects.length ? "캠페인 만들기" : "프로젝트 만들기"} />}</section>
    <p className="description mt-4">최근 캠페인 최대 100개 · 캠페인별 최대 200명의 후보 기준입니다.</p>
    <div className="section-heading"><div><h2>프로젝트와 브랜드 자료</h2><p className="description">캠페인에 사용할 브랜드 소개와 제품을 관리합니다.</p></div><div className="flex gap-4"><Link href="/projects" className="source-link">전체 보기 →</Link>{canWrite(actor) && projects.length > 0 && <Link href="/projects/new" className="source-link">새 프로젝트</Link>}</div></div>
    {projects.length ? <div className="project-grid">{projects.slice(0,3).map(p => <ProjectCard key={p.id} project={p} />)}</div> : <section className="surface"><Empty title="브랜드와 제품부터 등록하세요" text="프로젝트의 브랜드 자료는 여러 캠페인에서 함께 사용할 수 있습니다." href={canWrite(actor) ? "/projects/new" : undefined} label="프로젝트 만들기" /></section>}
  </>;
}

import Link from "next/link";
import { FolderKanban, Package, Megaphone, CheckCheck, ArrowUpRight, Sprout } from "lucide-react";
import { PageHeading, Steps, Empty } from "@/components/ui";
import { ProjectCard } from "@/components/projects/project-card";
import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { listProjects, workspaceCounts } from "@/lib/projects/service";
import { listCampaigns } from "@/lib/campaigns/service";
import { CampaignTable } from "@/components/campaigns/campaign-table";
export default async function Overview() {
  const actor = await requireActor();
  const discovery = process.env.CODEX_DISCOVERY_ENABLED === "true", evaluation = process.env.EVALUATION_ENABLED === "true";
  const [projects, counts, campaigns] = await Promise.all([listProjects(actor), workspaceCounts(actor), listCampaigns(actor)]);
  const stats = [
    { label: "전체 프로젝트", value: counts.projects, note: "브랜드와 제품의 시작점", icon: FolderKanban },
    { label: "등록된 제품", value: counts.products, note: "캠페인에 연결할 제품", icon: Package },
    { label: "전체 캠페인", value: counts.campaigns, note: "프로젝트별 독립 타겟팅", icon: Megaphone },
    { label: "준비 완료 캠페인", value: counts.ready, note: "발굴 조건 설정 완료", icon: CheckCheck },
  ];
  return <><PageHeading eyebrow="Workspace overview" title="좋은 연결의 시작, 프로젝트부터." description="브랜드의 이야기를 모으고, 크리에이터와 만날 다음 캠페인을 준비하세요." action={canWrite(actor) ? { href: "/projects/new", label: "새 프로젝트" } : undefined} />
    <div className="stats-grid">{stats.map(({ label, value, note, icon: Icon }) => <div className="stat-card" key={label}><div className="stat-title">{label}<Icon size={16} className="text-[#94a58e]" /></div><div className="stat-value">{value}<span className="text-xs font-normal text-[#8e998e] ml-1.5">개</span></div><div className="stat-note">{note}</div></div>)}</div>
    <div className="section-heading"><h2>시딩 워크플로</h2><span className="badge badge-green">{discovery && evaluation ? "STEP 1–4 · 준비·발굴·검토" : "STEP 1–2 · 데이터 준비"}</span></div><Steps discovery={discovery} evaluation={evaluation} />
    <div className="section-heading"><h2>최근 프로젝트 <span className="text-xs font-normal muted ml-2">브랜드의 모든 정보를 한 곳에</span></h2><Link href="/projects" className="text-xs muted flex gap-2 items-center">전체 보기<ArrowUpRight size={13} /></Link></div>
    {projects.length ? <div className="project-grid">{projects.slice(0, 3).map(p => <ProjectCard key={p.id} project={p} />)}</div> : <section className="surface"><Empty title="첫 프로젝트를 만들어 보세요" text="브랜드 소개와 제품을 등록하고, 국가와 플랫폼에 맞는 캠페인을 준비하세요." href={canWrite(actor) ? "/projects/new" : undefined} label="프로젝트 만들기" /></section>}
    <div className="section-heading"><h2>최근 캠페인</h2><Link href="/campaigns" className="text-xs muted flex gap-2 items-center">전체 보기<ArrowUpRight size={13} /></Link></div><section className="surface">{campaigns.length ? <CampaignTable rows={campaigns.slice(0, 5)} /> : <Empty title="다음 캠페인을 준비해 보세요" text="프로젝트와 제품을 연결한 뒤 국가, 플랫폼, 크리에이터 조건을 설정하세요." href={canWrite(actor) ? "/campaigns/new" : undefined} label="캠페인 만들기" />}</section>
    <div className="info-banner"><Sprout size={21} className="shrink-0 mt-0.5" /><div><strong>작은 준비가, 좋은 협업의 시작입니다.</strong><br />{discovery ? "캠페인에서 발굴 요청을 만들고 실행 안내를 Codex 앱에 전달하세요. 직접 탐색한 후보는 근거와 실행 경로를 사람이 검토한 뒤 평가·승인합니다." : "브랜드와 제품을 충분히 정리해 두면 다음 캠페인에서도 그대로 사용할 수 있어요. SNS 직접 발굴은 실행 환경을 준비한 뒤 사용할 수 있습니다."}</div></div>
  </>;
}

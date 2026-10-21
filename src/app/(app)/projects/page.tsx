import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { listProjects } from "@/lib/projects/service";
import { PageHeading, Empty } from "@/components/ui";
import { ProjectCard } from "@/components/projects/project-card";
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireActor();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.slice(0, 100) : "";
  const projects = await listProjects(actor, query);
  return <><PageHeading eyebrow="Step 01 · Project library" title="프로젝트" description="브랜드의 이야기, 제품, 참고 자료를 프로젝트별로 관리하세요." action={canWrite(actor) ? { href: "/projects/new", label: "새 프로젝트" } : undefined} /><div className="toolbar"><span className="text-xs muted">프로젝트 {projects.length}개 · 최근 수정 순</span><form className="search-form"><input name="q" className="search" aria-label="프로젝트 검색" defaultValue={query} placeholder="프로젝트 이름으로 검색" maxLength={100} /><button className="btn">검색</button></form></div>{projects.length ? <div className="project-grid">{projects.map(p => <ProjectCard key={p.id} project={p} />)}</div> : <div className="surface"><Empty title={query ? "검색 결과가 없습니다" : "첫 프로젝트를 만들어 보세요"} text={query ? "다른 프로젝트 이름으로 검색해 주세요." : "프로젝트에 브랜드와 제품을 정리하면 캠페인에서 다시 사용할 수 있습니다."} href={!query && canWrite(actor) ? "/projects/new" : undefined} label="프로젝트 만들기" /></div>}<p className="description mt-5 text-[11px]">최신 100개까지 표시합니다.</p></>;
}

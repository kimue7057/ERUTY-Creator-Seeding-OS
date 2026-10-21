import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { listProjects } from "@/lib/projects/service";
import { listCampaigns } from "@/lib/campaigns/service";
import { safeId } from "@/lib/validation/projects";
import { PLATFORMS, STATUSES } from "@/lib/validation/campaigns";
import { PageHeading, Empty } from "@/components/ui";
import { CampaignTable } from "@/components/campaigns/campaign-table";
export default async function Campaigns({ searchParams }: { searchParams: Promise<{ q?: string; projectId?: string; platform?: string; status?: string }> }) {
  const actor = await requireActor(); const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const projectId = typeof params.projectId === "string" && safeId(params.projectId) ? params.projectId : "";
  const platform = PLATFORMS.some(p => p.value === params.platform) ? params.platform : "";
  const status = STATUSES.some(s => s.value === params.status) ? params.status : "";
  const [rows, projects] = await Promise.all([listCampaigns(actor, { query, projectId, platform, status }), listProjects(actor)]);
  return <><PageHeading eyebrow="Step 02 · Campaign targeting" title="캠페인" description="프로젝트의 브랜드 정보를 바탕으로, 캠페인마다 다른 타겟팅을 설정하세요." action={canWrite(actor) ? { href: "/campaigns/new", label: "새 캠페인" } : undefined} /><div className="toolbar"><span className="muted text-xs">캠페인 {rows.length}개 · 최근 수정 순</span><form className="search-form"><input className="search" name="q" placeholder="캠페인 이름으로 검색" aria-label="캠페인 검색" defaultValue={query} maxLength={100} /><select name="projectId" className="input w-auto" defaultValue={projectId} aria-label="프로젝트 필터"><option value="">전체 프로젝트</option>{projects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select><select className="input w-auto" name="platform" defaultValue={platform} aria-label="플랫폼 필터"><option value="">전체 플랫폼</option>{PLATFORMS.map(p => <option value={p.value} key={p.value}>{p.label}</option>)}</select><select className="input w-auto" name="status" defaultValue={status} aria-label="상태 필터"><option value="">전체 상태</option>{STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select><button className="btn">적용</button></form></div><section className="surface">{rows.length ? <CampaignTable rows={rows} /> : <Empty title="표시할 캠페인이 없습니다" text="검색 조건을 바꾸거나, 프로젝트에 연결할 새 캠페인을 만들어 보세요." href={canWrite(actor) ? "/campaigns/new" : undefined} label="캠페인 만들기" />}</section><p className="description mt-5 text-[11px]">검색 조건에 맞는 최신 100개까지 표시합니다. 준비 완료 상태는 SNS 발굴 실행을 의미하지 않습니다.</p></>;
}

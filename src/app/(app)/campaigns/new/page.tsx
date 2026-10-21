import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { listProjects, getProject, projectProducts } from "@/lib/projects/service";
import { safeId } from "@/lib/validation/projects";
import { PageHeading, Empty } from "@/components/ui";
import { CampaignForm } from "@/components/campaigns/campaign-form";
export default async function NewCampaign({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const actor = await requireActor(); if (!canWrite(actor)) notFound();
  const { projectId: requested } = await searchParams;
  const projects = await listProjects(actor);
  if (!projects.length) return <><PageHeading eyebrow="Step 02 · New campaign" title="새 캠페인" description="먼저 브랜드 프로젝트를 등록하세요." /><div className="surface"><Empty title="프로젝트가 필요합니다" text="프로젝트와 제품을 등록하면 캠페인 타겟팅을 설정할 수 있습니다." href="/projects/new" label="프로젝트 만들기" /></div></>;
  if (requested && (typeof requested !== "string" || !safeId(requested))) notFound();
  const projectId = requested ?? projects[0].id;
  const project = await getProject(actor, projectId); if (!project) notFound();
  const products = await projectProducts(actor, projectId);
  const options = projects.some(p => p.id === projectId) ? projects : [project, ...projects];
  return <><PageHeading eyebrow="Step 02 · New campaign" title="새 캠페인" description="브랜드와 제품을 연결하고 크리에이터 타겟팅을 설정하세요." /><CampaignForm key={projectId} projectOptions={options} projectId={projectId} products={products} /></>;
}

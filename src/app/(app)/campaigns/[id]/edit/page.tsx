import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { getCampaign } from "@/lib/campaigns/service";
import { getProject, projectProducts } from "@/lib/projects/service";
import { safeId } from "@/lib/validation/projects";
import { PageHeading } from "@/components/ui";
import { CampaignForm } from "@/components/campaigns/campaign-form";
import { campaignSchema } from "@/lib/validation/campaigns";
export default async function EditCampaign({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor(); const { id } = await params; if (!safeId(id) || !canWrite(actor)) notFound();
  const campaign = await getCampaign(actor, id); if (!campaign) notFound();
  const [project, available] = await Promise.all([getProject(actor, campaign.projectId), projectProducts(actor, campaign.projectId)]); if (!project) notFound();
  const options = [...available, ...campaign.selectedProducts.filter(p => !available.some(a => a.id === p.id))];
  return <><PageHeading eyebrow="Step 02 · Edit campaign" title="캠페인 편집" description="타겟팅은 이 캠페인에만 반영됩니다. 관련 제품 변경 시 새 브리프 버전을 보존합니다." /><CampaignForm campaign={{ ...campaignSchema.parse(campaign), id: campaign.id }} projectOptions={[project]} projectId={project.id} products={options} /></>;
}

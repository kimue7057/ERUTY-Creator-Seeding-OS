import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { getProject } from "@/lib/projects/service";
import { safeId } from "@/lib/validation/projects";
import { notFound } from "next/navigation";
import { PageHeading } from "@/components/ui";
import { ProjectForm } from "@/components/projects/project-form";
export default async function EditProject({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor(); const { id } = await params;
  if (!safeId(id) || !canWrite(actor)) notFound();
  const project = await getProject(actor, id); if (!project) notFound();
  return <><PageHeading eyebrow="Step 01 · Edit project" title="프로젝트 편집" description="수정한 브랜드 정보는 새 캠페인에 반영됩니다. 기존 캠페인 브리프는 유지됩니다." /><ProjectForm project={project} /></>;
}

import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { getProject } from "@/lib/projects/service";
import { safeId } from "@/lib/validation/projects";
import { PageHeading } from "@/components/ui";
import { ProductForm } from "@/components/projects/product-form";
export default async function NewProduct({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor(); const { id } = await params;
  if (!safeId(id) || !canWrite(actor)) notFound();
  const project = await getProject(actor, id); if (!project) notFound();
  return <><PageHeading eyebrow="Project library · Product" title="제품 추가" description={`${project.name}의 제품 정보를 등록하세요.`} /><ProductForm projectId={id} /></>;
}

import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { projectProducts, getProject } from "@/lib/projects/service";
import { safeId } from "@/lib/validation/projects";
import { PageHeading } from "@/components/ui";
import { ProductForm } from "@/components/projects/product-form";
export default async function EditProduct({ params }: { params: Promise<{ id: string; productId: string }> }) {
  const actor = await requireActor(); const { id, productId } = await params;
  if (!safeId(id) || !safeId(productId) || !canWrite(actor)) notFound();
  const project = await getProject(actor, id); if (!project) notFound();
  const product = (await projectProducts(actor, id)).find(p => p.id === productId); if (!product) notFound();
  return <><PageHeading eyebrow="Project library · Product" title="제품 편집" description={`${project.name}의 제품 정보를 수정하거나 보관하세요.`} /><ProductForm projectId={id} product={product} /></>;
}

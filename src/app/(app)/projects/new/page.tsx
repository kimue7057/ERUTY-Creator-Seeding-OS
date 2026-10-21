import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { notFound } from "next/navigation";
import { PageHeading } from "@/components/ui";
import { ProjectForm } from "@/components/projects/project-form";
export default async function NewProject() {
  if (!canWrite(await requireActor())) notFound();
  return <><PageHeading eyebrow="Step 01 · New project" title="새 프로젝트" description="캠페인에서 함께 사용할 브랜드의 기본 정보를 입력하세요." /><ProjectForm /></>;
}

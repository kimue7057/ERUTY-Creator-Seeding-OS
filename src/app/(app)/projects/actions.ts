"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth/session";
import { saveProject, saveProduct, archiveProduct } from "@/lib/projects/service";
import { actionError, type ActionState } from "@/lib/action-state";
export async function projectAction(id: string | undefined, _: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requireActor();
  let savedId: string;
  try {
    const record = await saveProject(actor, {
      name: String(form.get("name") ?? ""), website: String(form.get("website") ?? "").trim(),
      summary: String(form.get("summary") ?? ""), usp: String(form.get("usp") ?? ""), brandStyle: String(form.get("brandStyle") ?? ""),
      referenceUrls: String(form.get("referenceUrls") ?? "").split(/\r?\n/).map(s => s.trim()).filter(Boolean),
    }, id);
    savedId = record.id;
  } catch (error) { return actionError(error); }
  revalidatePath("/", "layout");
  redirect(`/projects/${savedId}`);
}
export async function productAction(projectId: string, id: string | undefined, _: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requireActor();
  try { await saveProduct(actor, projectId, { name: String(form.get("name") ?? ""), features: String(form.get("features") ?? ""), url: String(form.get("url") ?? "").trim() }, id); }
  catch (error) { return actionError(error); }
  revalidatePath("/", "layout");
  redirect(`/projects/${projectId}`);
}
export async function archiveProductAction(projectId: string, id: string): Promise<ActionState> {
  const actor = await requireActor();
  try { await archiveProduct(actor, projectId, id); }
  catch (error) { return actionError(error); }
  revalidatePath("/", "layout");
  redirect(`/projects/${projectId}`);
}

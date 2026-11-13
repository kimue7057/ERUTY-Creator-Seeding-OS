"use server";
import { requireActor } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { templateService } from "@/lib/outreach/templates";
import { outreachErrorMessage } from "@/lib/outreach/contracts";
export async function saveMessageTemplate(input:unknown) {
  const actor=await requireActor();try {const template=await templateService().save(actor,input);revalidatePath("/settings/templates");return {template};}catch(error){return {error:outreachErrorMessage(error)};}
}
export async function archiveMessageTemplate(id:string,revision:number,archived:boolean) {
  const actor=await requireActor();try {const template=await templateService().archive(actor,id,revision,archived);revalidatePath("/settings/templates");return {template};}catch(error){return {error:outreachErrorMessage(error)};}
}
export async function initializeTemplates() {
  const actor=await requireActor();try {const result=await templateService().installDefaults(actor);revalidatePath("/settings/templates");return {templates:await templateService().list(actor),added:result.added};}catch(error){return {error:outreachErrorMessage(error)};}
}
export async function saveMailBranding(input:unknown,revision:number) {
  const actor=await requireActor();try {const settings=await templateService().saveBranding(actor,input,revision);revalidatePath("/settings/templates");return {settings};}catch(error){return {error:outreachErrorMessage(error)};}
}

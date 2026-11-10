"use server";
import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";
import { draftService } from "@/lib/outreach/drafts";
import { OutreachError,outreachErrorMessage } from "@/lib/outreach/contracts";
import { evaluationService } from "@/lib/evaluation/service";
import { writeProposal } from "@/lib/outreach/ai";
import { outreachAiReady } from "@/lib/outreach/ai";
import { db } from "@/lib/db";
import { auditEvents } from "@/lib/db/schema";
import { outreachMember } from "@/lib/outreach/accounts";
import { and,eq,sql } from "drizzle-orm";
export async function saveOutreach(input:unknown) {
  const actor=await requireActor();try {const draft=await draftService().save(actor,input);return {draft};}catch(e){return {error:outreachErrorMessage(e)};}
}
export async function duplicateOutreach(id:string) {
  const actor=await requireActor();try {const draft=await draftService().duplicate(actor,id);revalidatePath("/outreach");return {draft};}catch(e){return {error:outreachErrorMessage(e)};}
}
export async function refreshOutreachAccounts() {
  const actor=await requireActor();try {return {accounts:await (await import("@/lib/outreach/accounts")).accountService().list(actor)};}catch(e){return {error:outreachErrorMessage(e)};}
}
export async function sendOutreach(id:string,revision:number,confirmed:boolean) {
  const actor=await requireActor();try {const draft=await draftService().send(actor,id,revision,confirmed);revalidatePath(`/campaigns/${draft.campaignId}`);return {draft};}catch(e){return {error:outreachErrorMessage(e),draft:await draftService().get(actor,id).catch(()=>null)};}
}
export async function generateOutreach(campaignId:string,creatorId:string,channel:string,language:string,purpose:string) {
  const actor=await requireActor();try {
    if(!canWrite(actor))throw new OutreachError("forbidden");
    const context=await evaluationService().detail(actor,campaignId,creatorId);if(!context.can_outreach)throw new OutreachError("stale");
    if(!outreachAiReady())throw new OutreachError("not_configured");
    await db.transaction(async tx=>{
      await outreachMember(tx,actor,true);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor.organizationId}),hashtext(${actor.userId+":outreach-ai"}))`);
      const [{count}]=await tx.select({count:sql<number>`count(*)::int`}).from(auditEvents).where(and(eq(auditEvents.organizationId,actor.organizationId),eq(auditEvents.actorId,actor.userId),eq(auditEvents.action,"outreach.ai_requested"),sql`${auditEvents.createdAt}>now()-interval '2 minutes'`));
      if(count>=2)throw new OutreachError("busy");
      await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:creatorId,action:"outreach.ai_requested"});
    });
    return {proposal:await writeProposal(context.snapshot,context.history[0].output,channel,language,purpose)};
  }catch(e){return {error:outreachErrorMessage(e)};}
}

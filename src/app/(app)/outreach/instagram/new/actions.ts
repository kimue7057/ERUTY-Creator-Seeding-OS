"use server";
import {requireActor} from "@/lib/auth/session";
import {browserSendService} from "@/lib/outreach/browser-sends";
import {browserSendInput} from "@/lib/outreach/browser-contracts";
import {draftService} from "@/lib/outreach/drafts";
import {evaluationService} from "@/lib/evaluation/service";
import {OutreachError,outreachErrorMessage} from "@/lib/outreach/contracts";
export async function loadBrowserOutreach(accountId?:string){
  const actor=await requireActor();try{const service=browserSendService();const [jobs,workers]=await Promise.all([service.history(actor,accountId),process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED==="true"?service.availability(actor):Promise.resolve([])]);return{jobs,workers};}catch(error){return{error:outreachErrorMessage(error)};}
}
export async function requestBrowserOutreach(input:unknown){
  const actor=await requireActor();try{if(process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED!=="true")throw new OutreachError("browser_outreach_offline");const data=browserSendInput.omit({draftId:true,draftRevision:true}).parse(input);return{job:await browserSendService().create(actor,data)};}catch(error){return{error:outreachErrorMessage(error)};}
}
export async function sendBrowserOutreachDraft(id:string,revision:number,confirmed:boolean){
  const actor=await requireActor();try{
    if(process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED!=="true")throw new OutreachError("browser_outreach_offline");
    const draft=await draftService().get(actor,id);if(!draft||draft.revision!==revision||draft.channel!=="instagram"||!draft.senderAccountId)throw new OutreachError("draft_changed");
    const detail=await evaluationService().detail(actor,draft.campaignId,draft.creatorAccountId);
    const job=await browserSendService().create(actor,{id:draft.id,accountId:draft.senderAccountId,recipient:detail.snapshot.creator.handle,body:draft.body,confirmed,draftId:draft.id,draftRevision:revision});
    return{job,draft:await draftService().get(actor,id)};
  }catch(error){return{error:outreachErrorMessage(error),draft:await draftService().get(actor,id).catch(()=>null)};}
}
export async function cancelBrowserOutreach(id:string){
  const actor=await requireActor();try{return await browserSendService().cancel(actor,id);}catch(error){return{error:outreachErrorMessage(error)};}
}

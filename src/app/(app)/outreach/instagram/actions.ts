"use server";
import { requireActor } from "@/lib/auth/session";
import { instagramDmService } from "@/lib/outreach/instagram-dm";
import { outreachErrorMessage } from "@/lib/outreach/contracts";
import { instagramReplySchema } from "@/lib/outreach/instagram-dm-contracts";
import { InstagramDmError } from "@/lib/outreach/instagram-dm-provider";
function report(error:unknown){
  if(error instanceof InstagramDmError)console.error(JSON.stringify({event:"outreach.instagram_dm_failed",code:error.code,diagnostic:error.diagnostic}));
  return outreachErrorMessage(error);
}
export async function listInstagramConversations(accountId:string,after?:string){
  const actor=await requireActor();try{return{page:await instagramDmService().list(actor,accountId,after)};}catch(error){return{error:report(error)};}
}
export async function readInstagramThread(accountId:string,selection:unknown){
  const actor=await requireActor();try{return{thread:await instagramDmService().thread(actor,accountId,selection)};}catch(error){return{error:report(error)};}
}
export async function instagramSendHistory(accountId:string){
  const actor=await requireActor();try{return{history:await instagramDmService().history(actor,accountId)};}catch(error){return{error:outreachErrorMessage(error)};}
}
export async function sendInstagramReply(input:unknown){
  const actor=await requireActor();try{
    // Inbox replies have no caller-supplied campaign context. Campaign sends
    // go through the saved-draft action and its live selection checks.
    const data=instagramReplySchema.omit({draftId:true,draftRevision:true}).parse(input);
    return{receipt:await instagramDmService().send(actor,{...data,draftId:null,draftRevision:null})};
  }catch(error){return{error:report(error)};}
}

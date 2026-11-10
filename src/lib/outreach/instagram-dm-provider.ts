import { createHmac } from "node:crypto";
import { z } from "zod";
import { normalizeIdentity, OutreachError } from "./contracts";
import { providerJson,ProviderHttpError,readProviderJson } from "./provider-http";
import { assertDmWindow,DM_WINDOW_MS,instagramConversationId,instagramScopedId,type DmConversation,type DmMessage,type DmSelection,type DmThread } from "./instagram-dm-contracts";
type Context={id:string;username:string;accessToken:string;secret:string;version:string};
const opaque=z.string().min(1).max(1024),date=z.string().max(64).refine(v=>Number.isFinite(Date.parse(v)));
const person=z.object({id:instagramScopedId,username:z.string().regex(/^[\w.]{1,30}$/).optional()});
const message=z.object({id:opaque,created_time:date,from:person,to:z.object({data:z.array(person).max(10)}),message:z.string().max(12000).optional()});
const messageList=z.object({data:z.array(message).max(30)});
const conversation=z.object({id:instagramConversationId,updated_time:date,messages:messageList.optional()});
const page=z.object({data:z.array(conversation).max(100),paging:z.object({cursors:z.object({after:z.string().min(1).max(4096).optional()}).optional(),next:z.string().optional()}).optional()});
const fields="id,updated_time,messages.limit(1){id,created_time,from,to,message}";
export class InstagramDmError extends OutreachError{
  constructor(code:string,public diagnostic:{stage:"conversations"|"messages"|"send";httpStatus?:number;graphCode?:number;graphSubcode?:number}){super(code);}
}
export class InstagramDmSendError extends InstagramDmError{
  constructor(code:string,public ambiguous:boolean,diagnostic:InstagramDmError["diagnostic"]){super(code,diagnostic);}
}
function apiUrl(context:Context,path:string,query:Record<string,string>={}){
  if(!/^v\d+\.0$/.test(context.version)||!/^\d+$/.test(context.id))throw new OutreachError("not_configured");
  const url=new URL(`https://graph.facebook.com/${context.version}/${path}`);
  url.search=new URLSearchParams({...query,appsecret_proof:createHmac("sha256",context.secret).update(context.accessToken).digest("hex")}).toString();return url;
}
function classify(error:unknown,stage:"conversations"|"messages"){
  if(error instanceof InstagramDmError||error instanceof OutreachError&&!(error instanceof ProviderHttpError))return error;
  const http=error instanceof ProviderHttpError?error:undefined;
  return new InstagramDmError(http?.providerCode===190?"reconnect":[10,200].includes(http?.providerCode??-1)||http?.status===403?"instagram_dm_access_required":http?.status===429?"instagram_dm_rate_limited":"instagram_dm_read_failed",{stage,httpStatus:http?.status,graphCode:http?.providerCode,graphSubcode:http?.providerSubcode});
}
export function instagramDmProvider(context:Context,fetcher:typeof fetch=fetch){
  const signal=()=>AbortSignal.timeout(25000);
  async function get<T>(path:string,query:Record<string,string>,schema:z.ZodType<T>,stage:"conversations"|"messages"):Promise<T>{
    try{return schema.parse(await providerJson(apiUrl(context,path,query).href,{headers:{Authorization:`Bearer ${context.accessToken}`},signal:signal()},fetcher));}
    catch(error){if(error instanceof z.ZodError)throw new InstagramDmError("instagram_dm_response_invalid",{stage});throw classify(error,stage);}
  }
  const isCompany=(p:z.infer<typeof person>)=>p.id===context.id||!!p.username&&normalizeIdentity(p.username)===normalizeIdentity(context.username);
  function recipient(messages:z.infer<typeof message>[]){
    const others=new Map<string,z.infer<typeof person>>();
    for(const m of messages){
      if(!isCompany(m.from)&&!m.to.data.some(isCompany))throw new OutreachError("instagram_dm_thread_unsupported");
      for(const p of [m.from,...m.to.data])if(!isCompany(p)){const old=others.get(p.id);if(old?.username&&p.username&&normalizeIdentity(old.username)!==normalizeIdentity(p.username))throw new OutreachError("instagram_dm_recipient_changed");others.set(p.id,{...old,...p,username:p.username??old?.username});}
    }
    return others.size===1?[...others.values()][0]:null;
  }
  async function list(after?:string,userId?:string){
    const result=await get(`${context.id}/conversations`,{platform:"instagram",fields,limit:"25",...(after?{after}:{}),...(userId?{user_id:userId}:{})},page,"conversations");
    const items:DmConversation[]=result.data.map(c=>{let who:null|z.infer<typeof person>=null;try{who=recipient(c.messages?.data??[]);}catch{}return{id:c.id,updatedAt:new Date(c.updated_time).toISOString(),recipientId:who?.id??null,username:who?.username??null,preview:(c.messages?.data[0]?.message??"메시지 내용 확인").slice(0,140)};});
    const cursor=result.paging?.cursors?.after;
    if(result.paging?.next&&!cursor)throw new OutreachError("instagram_dm_response_invalid");
    // Never follow a provider-supplied paging URL.
    return{items,nextCursor:result.paging?.next&&cursor?cursor:null};
  }
  return{
    list,
    thread:async(selection:DmSelection):Promise<DmThread>=>{
      // Prove ownership through this sender's edge; the token may authorize
      // multiple company accounts, so a bare conversation-node GET is insufficient.
      let after: string|undefined,owned=false;const seen=new Set<string>();
      for(let i=0;i<4;i++){
        const result=await list(after,selection.recipientId);if(result.items.some(c=>c.id===selection.conversationId)){owned=true;break;}
        if(!result.nextCursor)break;if(seen.has(result.nextCursor))throw new OutreachError("instagram_dm_response_invalid");seen.add(result.nextCursor);after=result.nextCursor;
      }
      if(!owned)throw new OutreachError("instagram_dm_conversation_missing");
      const result=await get(encodeURIComponent(selection.conversationId),{fields:"id,messages.limit(20){id,created_time,from,to,message}"},z.object({id:instagramConversationId,messages:messageList}),"messages");
      if(result.id!==selection.conversationId)throw new OutreachError("instagram_dm_response_invalid");
      const who=recipient(result.messages.data);
      if(!who?.username||who.id!==selection.recipientId||normalizeIdentity(who.username)!==normalizeIdentity(selection.username))throw new OutreachError("instagram_dm_recipient_changed");
      const messages:DmMessage[]=result.messages.data.map(m=>({id:m.id,createdAt:new Date(m.created_time).toISOString(),senderId:m.from.id,senderUsername:m.from.username??null,text:m.message??"[사진 또는 첨부 메시지]",incoming:m.from.id===who.id})).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
      const lastIncomingAt=messages.filter(m=>m.incoming).at(-1)?.createdAt??null;let canReply=true;try{assertDmWindow(lastIncomingAt);}catch{canReply=false;}
      return{selection:{...selection,username:who.username},messages,lastIncomingAt,replyUntil:lastIncomingAt?new Date(Date.parse(lastIncomingAt)+DM_WINDOW_MS).toISOString():null,canReply};
    },
    send:async(recipientId:string,body:string)=>{
      let response:Response;
      try{response=await fetcher(apiUrl(context,`${context.id}/messages`).href,{method:"POST",headers:{Authorization:`Bearer ${context.accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({recipient:{id:recipientId},message:{text:body},messaging_type:"RESPONSE"}),signal:AbortSignal.timeout(20000),redirect:"error",cache:"no-store"});}
      catch{throw new InstagramDmSendError("send_unknown",true,{stage:"send"});}
      const raw=await readProviderJson(response).catch(()=>null);
      if(!response.ok){
        const error=z.object({error:z.object({code:z.number().int().nonnegative(),error_subcode:z.number().int().nonnegative().optional()})}).safeParse(raw);
        const known=error.success&&[400,401,403,404,429].includes(response.status),code=error.success?error.data.error.code:undefined;
        throw new InstagramDmSendError(!known?"send_unknown":code===190?"reconnect":[10,200].includes(code??-1)?"instagram_dm_access_required":response.status===429?"instagram_dm_rate_limited":"instagram_dm_send_rejected",!known,{stage:"send",httpStatus:response.status,graphCode:code,graphSubcode:error.success?error.data.error.error_subcode:undefined});
      }
      const sent=z.object({recipient_id:instagramScopedId,message_id:opaque}).safeParse(raw);
      if(!sent.success||sent.data.recipient_id!==recipientId)throw new InstagramDmSendError("send_unknown",true,{stage:"send",httpStatus:response.status});
      return sent.data.message_id;
    },
  };
}

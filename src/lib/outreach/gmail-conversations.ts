import {z} from 'zod';
import {OutreachError} from './contracts';
import {readProviderJson} from './provider-http';
import {rawEmail} from './message';
import {defaultBranding} from './template-contracts';
export type MailMessage={id:string;body:string;incoming:boolean;sentAt:Date;headers:Record<string,string>};
const identifier=z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);
type Part={mimeType?:string;filename?:string;body?:{data?:string};parts?:Part[]};
const part:z.ZodType<Part>=z.lazy(()=>z.object({mimeType:z.string().optional(),filename:z.string().optional(),body:z.object({data:z.string().max(4_000_000).optional()}).optional(),parts:z.array(part).max(100).optional()}));
const message=z.object({id:identifier,threadId:identifier,internalDate:z.string().regex(/^\d+$/),payload:part.and(z.object({headers:z.array(z.object({name:z.string().max(100),value:z.string().max(16000)})).max(300)}))});
export function mailAddresses(value:string){return [...value.toLowerCase().matchAll(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g)].map(m=>m[0]);}
function content(p:Part,depth=0):string{
 if(depth>12)throw new OutreachError('mail_response_invalid');if(p.filename)return '';
 if(p.mimeType==='text/plain'&&p.body?.data)return Buffer.from(p.body.data,'base64url').toString('utf8');
 const children=p.parts?.map(x=>content(x,depth+1)).filter(Boolean)??[];if(children.length)return p.mimeType==='multipart/alternative'?children[0]:children.join('\n\n');
 if(p.mimeType==='text/html'&&p.body?.data)return Buffer.from(p.body.data,'base64url').toString('utf8').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?\s*>|<\/p>|<\/div>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');return '';
}
export function parseMailMessage(input:unknown,threadId:string,recipient:string,company:string[]):MailMessage{
 const m=message.parse(input);if(m.threadId!==threadId)throw new OutreachError('mail_thread_mismatch');
 const h:Record<string,string>={};for(const x of m.payload.headers)h[x.name.toLowerCase()]=x.value;
 const from=mailAddresses(h.from??''),to=mailAddresses((h.to??'')+','+(h.cc??'')),own=new Set(company.map(x=>x.toLowerCase())),target=recipient.toLowerCase();
 const incoming=from.length===1&&from[0]===target&&to.some(x=>own.has(x)),outgoing=from.length===1&&own.has(from[0])&&to.includes(target);
 if(!incoming&&!outgoing)throw new OutreachError('mail_thread_mismatch');
 if([...from,...to].some(x=>x!==target&&!own.has(x))||incoming&&h['reply-to']&&mailAddresses(h['reply-to']).some(x=>x!==target))throw new OutreachError('mail_thread_mismatch');
 const sentAt=new Date(Number(m.internalDate));if(!Number.isFinite(sentAt.getTime()))throw new OutreachError('mail_response_invalid');
 return{id:m.id,incoming,sentAt,body:(content(m.payload).trim()||'[첨부 파일 또는 본문 없는 이메일]').slice(0,24000),headers:Object.fromEntries(['message-id','in-reply-to','references','subject','from','to'].filter(k=>h[k]).map(k=>[k,h[k]]))};
}
export class MailSendError extends OutreachError{constructor(public ambiguous:boolean){super(ambiguous?'send_unknown':'send_failed');}}
export function gmailConversations(token:string,fetcher:typeof fetch=fetch){
 async function get(path:string){const response=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000),redirect:'error',cache:'no-store'});if(!response.ok){await response.body?.cancel();throw new OutreachError(response.status===401?'reconnect':response.status===403?'mail_read_required':'mail_read_failed');}try{return await readProviderJson(response);}catch{throw new OutreachError('mail_response_invalid');}}
 return{
  async thread(threadId:string|null,seedMessageId:string,recipient:string,company:string[]){
   if(!threadId){const seed=z.object({id:identifier,threadId:identifier}).parse(await get(`messages/${identifier.parse(seedMessageId)}?format=metadata`));if(seed.id!==seedMessageId)throw new OutreachError('mail_thread_mismatch');threadId=seed.threadId;}
   const result=z.object({id:identifier,messages:z.array(z.unknown()).min(1).max(200)}).parse(await get(`threads/${identifier.parse(threadId)}?format=full`));if(result.id!==threadId)throw new OutreachError('mail_thread_mismatch');
   const messages=result.messages.map(x=>parseMailMessage(x,threadId!,recipient,company)).sort((a,b)=>a.sentAt.getTime()-b.sentAt.getTime());if(!messages.some(x=>x.id===seedMessageId))throw new OutreachError('mail_thread_mismatch');return{threadId,messages};
  },
  async send(input:{id:string;threadId:string;from:string;to:string;subject:string;body:string;inReplyTo:string;references:string}){
   const raw=rawEmail({...input,template:'letter',branding:{...defaultBranding,companyName:'',signature:'',website:''},reply:{inReplyTo:input.inReplyTo,references:input.references}});
   let response:Response;try{response=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({raw,threadId:identifier.parse(input.threadId)}),redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new MailSendError(true);}
   if(!response.ok){await response.body?.cancel();throw new MailSendError(![400,401,403,404,429].includes(response.status));}const result=z.object({id:identifier,threadId:identifier}).safeParse(await response.json().catch(()=>null));if(!result.success||result.data.threadId!==input.threadId)throw new MailSendError(true);return result.data;
  },
 };
}

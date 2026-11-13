import {z} from 'zod';
import {OutreachError} from './contracts';import {readProviderJson} from './provider-http';
export const defaultOutreachModel='openai/gpt-5.4-mini';
export const routerModel=z.string().trim().min(3).max(160).regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._:+-]+$/);
export const routerKey=z.string().trim().min(20).max(512).regex(/^[A-Za-z0-9_-]+$/);
function statusError(status:number){return new OutreachError(status===401?'ai_key_invalid':status===402?'ai_credit_required':status===403?'ai_access_denied':status===400||status===404?'ai_model_unavailable':status===429?'ai_rate_limited':'ai_provider_unavailable');}
export async function openRouterJson(credentials:{apiKey:string;model:string},instructions:string,input:string,schema:Record<string,unknown>,maxTokens:number,fetcher:typeof fetch=fetch){
 const apiKey=routerKey.parse(credentials.apiKey),model=routerModel.parse(credentials.model);let response:Response;
 try{response=await fetcher('https://openrouter.ai/api/v1/chat/completions',{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(45000),headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','X-Title':'ERUTY Creator Seeding OS'},body:JSON.stringify({model,stream:false,messages:[{role:'system',content:instructions},{role:'user',content:input}],max_tokens:maxTokens,provider:{require_parameters:true},response_format:{type:'json_schema',json_schema:{name:'eruty_outreach',strict:true,schema}}})});}catch{throw new OutreachError('ai_provider_unavailable');}
 if(!response.ok){await response.body?.cancel();throw statusError(response.status);}
 const raw=await readProviderJson(response);if(raw&&typeof raw==='object'&&'error' in raw)throw statusError(502);
 const result=z.object({choices:z.array(z.object({finish_reason:z.literal('stop'),message:z.object({content:z.string().min(1).max(60000),refusal:z.string().nullable().optional()})})).min(1).max(1)}).safeParse(raw);
 if(!result.success||result.data.choices[0].message.refusal)throw new OutreachError('ai_response_invalid');
 try{return JSON.parse(result.data.choices[0].message.content) as unknown;}catch{throw new OutreachError('ai_response_invalid');}
}
export async function checkOpenRouter(credentials:{apiKey:string;model:string},fetcher:typeof fetch=fetch){
 const result=await openRouterJson(credentials,'This is a connection check. Return the required JSON object with ok set to true. No other content.','Connection check only; no personal or creator data.',{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},256,fetcher);
 if(!z.object({ok:z.literal(true)}).safeParse(result).success)throw new OutreachError('ai_response_invalid');
}

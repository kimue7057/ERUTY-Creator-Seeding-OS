import {z} from "zod";
import {OutreachError} from "@/lib/outreach/contracts";
import {outreachExecutorService} from "@/lib/outreach/executors";
import {outreachExtensionId} from "@/lib/outreach/executor-contracts";
import {browserSendService} from "@/lib/outreach/browser-sends";
import {browserSendGrant,browserObservation,browserFinish,browserReview,browserReviewFinish} from "@/lib/outreach/browser-contracts";
import {chatPreviewService} from '@/lib/outreach/chat-previews';
export const runtime="nodejs";
const extensionOrigin=`chrome-extension://${outreachExtensionId}`;
const headers={"Cache-Control":"private, no-store, max-age=0","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","Access-Control-Allow-Origin":extensionOrigin,Vary:"Origin"};
export function OPTIONS(request:Request){return new Response(null,{status:request.headers.get("origin")===extensionOrigin?204:403,headers:{...headers,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"content-type, authorization, x-eruty-executor","Access-Control-Max-Age":"600"}});}
export async function POST(request:Request,{params}:{params:Promise<{action:string}>}){
  try{
    if(process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED!=="true"||request.headers.get("origin")!==extensionOrigin||request.headers.get("x-eruty-executor")!=="1")throw new OutreachError("forbidden");
    if(!request.headers.get("content-type")?.startsWith("application/json"))return Response.json({error:"json_required"},{status:415,headers});
    const reader=request.body?.getReader();if(!reader)throw new SyntaxError();const chunks:Uint8Array[]=[];let length=0;
    try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>65536)return Response.json({error:"body_too_large"},{status:413,headers});chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
    const input:unknown=JSON.parse(Buffer.concat(chunks).toString("utf8")),{action}=await params,connections=outreachExecutorService();
    if(action==="pair")return Response.json(await connections.pair(input),{headers});
    const identity=await connections.authenticate(request.headers.get("authorization")?.replace(/^Bearer /,"")??""),service=browserSendService();
    if(action==="heartbeat")return Response.json(await connections.heartbeat(identity,input),{headers});
    if(action==="disconnect"){z.strictObject({}).parse(input);return Response.json(await connections.revoke(identity.actor,identity.id,true),{headers});}
    if(action==="next"){z.strictObject({}).parse(input);return Response.json(await service.next(identity.actor,identity.lease),{headers});}
    if(action==='preview-next'){const data=z.strictObject({protocol_version:z.union([z.literal(2),z.literal(3),z.literal(4)])}).parse(input);return Response.json(await chatPreviewService().next(identity,data.protocol_version),{headers});}
    if(action==='preview-check')return Response.json(await chatPreviewService().check(identity,input),{headers});
    if(action==='preview-finish')return Response.json(await chatPreviewService().finish(identity,input),{headers});
    if(action==='compose-check')return Response.json(await chatPreviewService().check(identity,input,'compose'),{headers});
    if(action==='compose-finish')return Response.json(await chatPreviewService().finish(identity,input,'compose'),{headers});
    if(action==="review-context"){const data=browserReview.omit({worker_id:true,instance_id:true}).parse(input);return Response.json(await service.reviewContext(identity.actor,{...data,...identity.lease}),{headers});}
    if(action==="review-finish"){const data=browserReviewFinish.omit({worker_id:true,instance_id:true}).parse(input);return Response.json(await service.reviewFinish(identity.actor,{...data,...identity.lease}),{headers});}
    const grantSchema=browserSendGrant.omit({worker_id:true,instance_id:true});
    const data=action==="arm"?grantSchema.extend({observation:browserObservation}).parse(input):action==="finish"?browserFinish.omit({worker_id:true,instance_id:true}).parse(input):grantSchema.parse(input);
    const grant={...data,...identity.lease};
    const result=action==="context"?await service.context(identity.actor,grant):action==="arm"?await service.arm(identity.actor,grant):action==="finish"?await service.finish(identity.actor,grant):null;
    return Response.json(result??{error:"unknown_action"},{status:result?200:404,headers});
  }catch(error){return Response.json({error:error instanceof OutreachError?error.code:"invalid_request"},{status:error instanceof OutreachError?error.code==="forbidden"?403:409:error instanceof z.ZodError||error instanceof SyntaxError?422:503,headers});}
}

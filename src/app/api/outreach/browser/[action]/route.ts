import {z} from "zod";
import {browserWorkerAuth} from "@/lib/discovery/remote-auth";
import {browserSendService} from "@/lib/outreach/browser-sends";
import {OutreachError} from "@/lib/outreach/contracts";
import {DiscoveryError} from "@/lib/discovery/contracts";
export const runtime="nodejs";
const headers={"Cache-Control":"private, no-store, max-age=0","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
export async function POST(request:Request,{params}:{params:Promise<{action:string}>}){
  try{
    const origin=request.headers.get("origin");
    if(process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED!=="true"||request.headers.get("x-eruty-outreach")!=="1"||origin&&origin!==process.env.APP_ORIGIN)throw new OutreachError("forbidden");
    if(!request.headers.get("content-type")?.startsWith("application/json"))return Response.json({error:"json_required"},{status:415,headers});
    const reader=request.body?.getReader();if(!reader)return Response.json({error:"body_required"},{status:400,headers});
    const chunks:Uint8Array[]=[];let size=0;
    try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536)return Response.json({error:"body_too_large"},{status:413,headers});chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
    const actor=await browserWorkerAuth().actor(request.headers.get("authorization")?.replace(/^Bearer /,"")??""),input:unknown=JSON.parse(Buffer.concat(chunks).toString("utf8")),{action}=await params,service=browserSendService();
    const result=action==="next"?await service.next(actor,input):action==="context"?await service.context(actor,input):action==="arm"?await service.arm(actor,input):action==="finish"?await service.finish(actor,input):null;
    if(!result)return Response.json({error:"unknown_action"},{status:404,headers});return Response.json(result,{headers});
  }catch(error){return Response.json({error:error instanceof OutreachError||error instanceof DiscoveryError?error.code:"invalid_request"},{status:error instanceof DiscoveryError?error.status:error instanceof OutreachError?error.code==="forbidden"?403:409:error instanceof z.ZodError||error instanceof SyntaxError?422:503,headers});}
}

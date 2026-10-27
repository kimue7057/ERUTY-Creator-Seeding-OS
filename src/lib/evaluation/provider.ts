import {z} from "zod";
import {evaluationOutput,EvaluationError} from "./contracts";
import {evaluationPrompt,type EvaluationContext,evaluationService} from "./service";
import type {ActorScope} from "../auth/permissions";
export function evaluationAiConfig(env:Record<string,string|undefined>=process.env){
 const enabled=env.EVALUATION_AI_ENABLED==="true",key=env.OPENAI_API_KEY,model=env.EVALUATION_MODEL;
 return {enabled,configured:enabled&&!!key&&!!model,key,model};
}
export async function requestAiEvaluation(snapshot:EvaluationContext["snapshot"],config:ReturnType<typeof evaluationAiConfig>,fetcher:typeof fetch=fetch){
 if(!config.configured||!config.key||!config.model)throw new EvaluationError("evaluation_ai_not_configured");
 const schema=z.toJSONSchema(evaluationOutput);delete schema.$schema;
 let response:Response;
 try {response=await fetcher("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${config.key}`,"Content-Type":"application/json"},signal:AbortSignal.timeout(45000),redirect:"error",body:JSON.stringify({model:config.model,store:false,max_output_tokens:5000,input:[{role:"user",content:evaluationPrompt(snapshot)}],text:{format:{type:"json_schema",name:"creator_evaluation",strict:true,schema}}})});}
 catch {throw new EvaluationError("evaluation_provider_unavailable");}
 if(!response.ok){await response.body?.cancel();throw new EvaluationError(response.status===429?"evaluation_provider_rate_limited":"evaluation_provider_failed");}
 const reader=response.body?.getReader();if(!reader)throw new EvaluationError("evaluation_provider_invalid");
 const chunks:Uint8Array[]=[];let size=0;
 try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1048576){await reader.cancel();throw new EvaluationError("evaluation_provider_invalid");}chunks.push(part.value);}}
 catch(error){if(error instanceof EvaluationError)throw error;throw new EvaluationError("evaluation_provider_unavailable");}
 let body:{status?:string;id?:string;output?:{type?:string;content?:{type?:string;text?:string}[]}[]};
 try{body=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw new EvaluationError("evaluation_provider_invalid");}
 if(body.status!=="completed")throw new EvaluationError("evaluation_provider_incomplete");
 if(body.output?.some(item=>item.content?.some(c=>c.type==="refusal")))throw new EvaluationError("evaluation_provider_refused");
 const text=body.output?.filter(o=>o.type==="message").flatMap(o=>o.content??[]).filter(c=>c.type==="output_text").map(c=>c.text??"").join("");
 try{return evaluationOutput.parse(JSON.parse(text??""));}catch{throw new EvaluationError("evaluation_provider_invalid");}
}
export async function generateEvaluation(actor:ActorScope,campaignId:string,accountId:string,key:string,inputHash:string,config=evaluationAiConfig(),service=evaluationService(),fetcher:typeof fetch=fetch){
 if(!config.configured||!config.model)throw new EvaluationError("evaluation_ai_not_configured");
 const current=await service.claim(actor,campaignId,accountId,key,inputHash,config.model);
 try {const output=await requestAiEvaluation(current.snapshot,config,fetcher);return await service.record(actor,campaignId,accountId,{idempotency_key:key,input_sha256:inputHash,model:config.model,output},"openai_api");}
 catch(error){await service.fail(actor,key).catch(()=>{});throw error;}
}

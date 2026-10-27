"use server";
import {randomUUID} from "node:crypto";
import {revalidatePath} from "next/cache";
import {requireActor} from "@/lib/auth/session";
import {evaluationService} from "@/lib/evaluation/service";
import {generateEvaluation} from "@/lib/evaluation/provider";
import {EvaluationError} from "@/lib/evaluation/contracts";
import {privateError} from "@/lib/probe/diagnostics";
export type EvaluationFormState={saved:boolean;error:string};
const messages:Record<string,string>={evaluation_forbidden:"현재 계정에는 저장 권한이 없습니다.",evaluation_stale_input:"브리프·타깃·근거가 변경됐습니다. 새로고침한 뒤 평가해 주세요.",evaluation_discovery_pending:"SNS 근거 검토가 완료돼야 AI 자동 평가와 최종 승인이 가능합니다.",evaluation_evidence_not_reviewed:"평가에 사용한 Work 원본 근거를 먼저 검토해 주세요.",evaluation_unknowns_acknowledgement_required:"미확인 항목과 위험 표시를 확인해 주세요.",evaluation_ai_not_configured:"AI 자동 평가 연결이 설정되지 않았습니다. Work 평가 가져오기를 사용할 수 있습니다.",evaluation_in_progress:"같은 평가가 처리 중입니다. 자동으로 다시 호출하지 않습니다.",evaluation_generation_already_attempted:"이미 처리한 요청입니다. 결과를 확인한 뒤 필요하면 새 평가를 시작하세요.",evaluation_provider_rate_limited:"AI 서비스 요청 한도에 도달했습니다. 이번 요청은 자동 재시도하지 않습니다."};
function failure(error:unknown):EvaluationFormState{const id=randomUUID();console.error(JSON.stringify({layer:"evaluation",request_id:id,error:privateError(error)}));return {saved:false,error:`${error instanceof EvaluationError?messages[error.code]??"평가를 저장하지 못했습니다. 입력과 근거를 확인해 주세요.":"입력 형식과 현재 권한을 확인해 주세요."} 요청 ID: ${id}`};}
export async function evaluationAction(campaignId:string,accountId:string,_:EvaluationFormState,form:FormData):Promise<EvaluationFormState>{
 const actor=await requireActor();
 try {
  if(process.env.EVALUATION_ENABLED!=="true")throw new EvaluationError("evaluation_disabled");
  const key=String(form.get("idempotency_key")??""),inputHash=String(form.get("input_sha256")??"");
  if(form.get("mode")==="generate")await generateEvaluation(actor,campaignId,accountId,key,inputHash);
  else if(form.get("mode")==="import"){
   const json=String(form.get("evaluation_json")??"");if(Buffer.byteLength(json)>65536)throw new EvaluationError("evaluation_input_too_large");
   await evaluationService().record(actor,campaignId,accountId,{idempotency_key:key,input_sha256:inputHash,output:JSON.parse(json),model:String(form.get("model")??"ChatGPT Work")});
  }else throw new EvaluationError("evaluation_invalid_mode");
 }catch(error){return failure(error);}
 revalidatePath(`/evaluations/${campaignId}/${accountId}`);return {saved:true,error:""};
}
export async function evaluationReviewAction(campaignId:string,accountId:string,evaluationId:string,_:EvaluationFormState,form:FormData):Promise<EvaluationFormState>{
 const actor=await requireActor();try{if(process.env.EVALUATION_ENABLED!=="true")throw new EvaluationError("evaluation_disabled");await evaluationService().review(actor,campaignId,accountId,{evaluation_id:evaluationId,idempotency_key:String(form.get("idempotency_key")??""),verdict:form.get("verdict"),reason:form.get("reason"),unknowns_acknowledged:form.get("acknowledged")==="on"});}catch(error){return failure(error);}
 revalidatePath(`/evaluations/${campaignId}/${accountId}`);return {saved:true,error:""};
}

"use client";
import {useActionState,useId,useState} from "react";
import {useHydrated} from "@/components/use-hydrated";
import {evaluationAction,evaluationReviewAction} from "@/app/(app)/evaluations/actions";
export function EvaluationForm({campaignId,accountId,inputHash,requestKey,aiReady,discoveryReady}:{campaignId:string;accountId:string;inputHash:string;requestKey:string;aiReady:boolean;discoveryReady:boolean}){
 const [state,submit,pending]=useActionState(evaluationAction.bind(null,campaignId,accountId),{saved:false,error:""});const hydrated=useHydrated(),id=useId();const [mode,setMode]=useState("import");
 return <form action={submit} className="review-form" aria-label="크리에이터 평가 저장" aria-busy={pending}>
  <input type="hidden" name="input_sha256" value={inputHash}/><input type="hidden" name="idempotency_key" value={requestKey}/>
  <label className="field">평가 방식<select className="input" name="mode" value={mode} onChange={e=>setMode(e.target.value)} disabled={pending}><option value="import">Work 평가 가져오기</option><option value="generate" disabled={!aiReady||!discoveryReady}>AI 자동 평가{!aiReady?" · 연결 설정 필요":!discoveryReady?" · SNS 검토 대기":""}</option></select></label>
  {mode==="import"?<><label className="field" htmlFor={id+"model"}>평가 도구·모델<input id={id+"model"} className="input" name="model" defaultValue="ChatGPT Work" maxLength={150} required disabled={pending}/></label><label className="field" htmlFor={id}>평가 JSON<textarea id={id} className="input" name="evaluation_json" rows={12} maxLength={65536} required disabled={pending} placeholder="아래 평가 요청을 Work에서 실행한 실제 JSON 결과를 붙여넣으세요."/></label><p className="description">가져온 평가의 출처는 사용자 입력으로 기록됩니다. SNS 관찰·최종 승인이 자동 생성되지는 않습니다.</p></>:<p className="description">현재 브리프와 공개 관찰 근거를 설정된 AI 서비스에 전달합니다. 요청은 자동 재시도하지 않습니다.</p>}
  <button className="btn btn-primary" disabled={pending||!hydrated||state.saved}>{pending?"평가 처리 중…":state.saved?"평가 저장됨":"평가 저장"}</button>
  <div aria-live="polite">{state.error&&<p className="form-error" role="alert">{state.error}</p>}{state.saved&&<p role="status">평가를 저장했습니다. 새 평가가 필요하면 새로고침해 주세요.</p>}</div>
 </form>;
}
export function EvaluationReviewForm({campaignId,accountId,evaluationId,requestKey,canApprove}:{campaignId:string;accountId:string;evaluationId:string;requestKey:string;canApprove:boolean}){
 const [state,submit,pending]=useActionState(evaluationReviewAction.bind(null,campaignId,accountId,evaluationId),{saved:false,error:""});const hydrated=useHydrated(),id=useId();
 return <form action={submit} className="review-form" aria-label="크리에이터 평가 검토"><input type="hidden" name="idempotency_key" value={requestKey}/><label className="field">판정<select name="verdict" aria-label="판정" className="input" required defaultValue="" disabled={pending}><option value="" disabled>선택하세요</option><option value="approved" disabled={!canApprove}>승인{!canApprove?" · 근거 검토 또는 새 평가 필요":""}</option><option value="hold">보류</option><option value="rejected">제외</option></select></label><label className="field" htmlFor={id}>검토 사유<textarea id={id} className="input" name="reason" maxLength={2000} required disabled={pending}/></label><label className="flex gap-2 items-start text-sm"><input type="checkbox" name="acknowledged" disabled={pending}/>미확인 항목·신뢰도·위험 표시를 확인했습니다. 크리에이터 소재지와 시청자 국가는 별개임을 확인했습니다.</label><button className="btn" disabled={pending||!hydrated||state.saved}>검토 저장</button><div aria-live="polite">{state.error&&<p className="form-error" role="alert">{state.error}</p>}{state.saved&&<p role="status">검토 이력을 저장했습니다.</p>}</div></form>;
}

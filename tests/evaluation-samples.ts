import type {EvaluationOutput} from "../src/lib/evaluation/contracts";
import {RUBRIC} from "../src/lib/evaluation/contracts";
export const sampleEvaluation=(id:string)=>({rubric_version:1 as const,criteria:Object.fromEntries(Object.entries(RUBRIC).map(([key,max])=>[key,{score:key==="target_audience"?null:Math.floor(max/2),confidence:0.5,reason:"SYNTHETIC test assessment; no actual creator or Work evaluation",evidence_ids:[id]}])) as unknown as EvaluationOutput["criteria"],confidence:0.5,summary:"SYNTHETIC evaluation fixture only",risk_flags:["Synthetic evidence"]});

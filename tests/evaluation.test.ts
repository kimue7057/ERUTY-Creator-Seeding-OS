import {test} from "node:test";import assert from "node:assert/strict";import {randomUUID} from "node:crypto";
import {RUBRIC,validateScores} from "../src/lib/evaluation/contracts";
import {sampleEvaluation} from "./evaluation-samples";
test("fixed rubric totals 100; unknowns remain null, and scores require scoped evidence",()=>{
 const id=randomUUID(),sample=sampleEvaluation(id),result=validateScores(sample,[id]);assert.equal(Object.values(RUBRIC).reduce((a,b)=>a+b,0),100);assert.equal(result.total,null);assert.equal(result.unknownCount,1);assert.equal(result.knownSubtotal,39);
 assert.throws(()=>validateScores(sample,[]));assert.throws(()=>validateScores({...sample,criteria:{...sample.criteria,product_fit:{...sample.criteria.product_fit,score:31}}},[id]));assert.throws(()=>validateScores({...sample,criteria:{...sample.criteria,product_fit:{...sample.criteria.product_fit,evidence_ids:[]}}},[id]));
 assert.throws(()=>validateScores({...sample,summary:"password=do-not-store"},[id]));
});

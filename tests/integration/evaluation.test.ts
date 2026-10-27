import {test} from "node:test";import assert from "node:assert/strict";import {randomUUID} from "node:crypto";import {eq} from "drizzle-orm";
import {withDiscoveryDatabase,sqlFailure} from "../discovery-fixture";import {sampleEvaluation} from "../evaluation-samples";
import {localDiscoveryActor,prepareSample,logSample,observationSample} from "../discovery-samples";
import {discoveryService} from "../../src/lib/discovery/service";import {memberships,campaigns} from "../../src/lib/db/schema";
import {discoveryCapabilities as capabilities} from "../../src/lib/db/discovery-schema";
import {creatorEvaluations,evaluationReviews,evaluationRequests} from "../../src/lib/db/evaluation-schema";
import {evaluationService} from "../../src/lib/evaluation/service";import {EvaluationError} from "../../src/lib/evaluation/contracts";
import {evaluationAiConfig,requestAiEvaluation,generateEvaluation} from "../../src/lib/evaluation/provider";
type Fixture=Parameters<Parameters<typeof withDiscoveryDatabase>[0]>[0];
const code=(name:string)=>(e:unknown)=>e instanceof EvaluationError&&e.code===name;
async function seed(f:Fixture,work=false){
 const campaign=await f.campaign(),service=discoveryService(f.database),who={...localDiscoveryActor(f.actor),executionSource:work?"work_manual_task" as const:"codex_test" as const};
 if(work)for(const kind of ["sns_native_search","work_mcp_write"] as const)await f.database.insert(capabilities).values({organizationId:f.actor.organizationId,platform:"instagram",kind,verdict:"verified",environmentSha256:who.environmentSha256,privateEvidenceReference:"SYNTHETIC local fixture, not Work",facts:{native_search:true,direct_profiles:5,recent_content_profiles:5,limitations:["SYNTHETIC"]},observedAt:new Date(),reviewedBy:f.actor.userId});
 const run=await service.prepare(who,{...prepareSample(campaign.id),execution_source:who.executionSource,work_task_reference:work?"SYNTHETIC fixture, not hosted Work":null});
 const log=await service.appendLog(who,logSample(run.run_id));const saved=await service.record(who,{...observationSample(run.run_id,run.context_sha256,log.log_id),work_trace_reference:work?"SYNTHETIC contract fixture, not real Work":null});
 if(work)for(const id of saved.evidence_ids)await service.reviewEvidence(who,{evidence_id:id,verdict:"accepted",reason:"SYNTHETIC fixture review only"});
 return {campaign,accountId:saved.creator_account_id,evidenceIds:saved.evidence_ids,who,discovery:service};
}
test("evaluation drafts are tenant scoped, precision aware, idempotent, immutable and never approve unreviewed discovery",async()=>{
 await withDiscoveryDatabase(async f=>{
  const s=await seed(f),svc=evaluationService(f.database),ctx=await svc.context(f.actor,s.campaign.id,s.accountId),input={input_sha256:ctx.input_sha256,idempotency_key:randomUUID(),model:"SYNTHETIC Work import",output:sampleEvaluation(s.evidenceIds[0])};
  const [a,b]=await Promise.all([svc.record(f.actor,s.campaign.id,s.accountId,input),svc.record(f.actor,s.campaign.id,s.accountId,input)]);assert.equal(a.id,b.id);assert.equal(a.total,null);assert.ok(a.output.risk_flags.includes("audience_country_unverified"));assert.ok(a.output.risk_flags.includes("discovery_verification_pending"));
  await assert.rejects(svc.context(f.other,s.campaign.id,s.accountId),code("evaluation_not_found"));await assert.rejects(svc.record({...f.reader,role:"admin"},s.campaign.id,s.accountId,input),code("evaluation_forbidden"));
  await assert.rejects(svc.record(f.actor,s.campaign.id,s.accountId,{...input,model:"changed"}),code("evaluation_idempotency_conflict"));await assert.rejects(svc.record(f.actor,s.campaign.id,s.accountId,{...input,idempotency_key:randomUUID(),output:sampleEvaluation(randomUUID())}),code("evidence_not_allowed"));
  await assert.rejects(svc.review(f.actor,s.campaign.id,s.accountId,{evaluation_id:a.id,idempotency_key:randomUUID(),verdict:"approved",reason:"Cannot verify synthetic creator",unknowns_acknowledged:true}),code("evaluation_discovery_pending"));
  const decision={evaluation_id:a.id,idempotency_key:randomUUID(),verdict:"hold",reason:"SYNTHETIC pending review",unknowns_acknowledged:false};const hold=await svc.review(f.actor,s.campaign.id,s.accountId,decision);assert.equal((await svc.review(f.actor,s.campaign.id,s.accountId,decision)).id,hold.id);
  assert.equal((await svc.detail(f.actor,s.campaign.id,s.accountId)).can_outreach,false);assert.equal((await svc.detail(f.reader,s.campaign.id,s.accountId)).history.length,1);
  await assert.rejects(f.database.update(creatorEvaluations).set({total:99}).where(eq(creatorEvaluations.id,a.id)),sqlFailure("23514"));await assert.rejects(f.database.delete(evaluationReviews).where(eq(evaluationReviews.id,hold.id)),sqlFailure("23514"));
  await f.database.update(campaigns).set({notes:"SYNTHETIC targeting changed"}).where(eq(campaigns.id,s.campaign.id));await assert.rejects(svc.record(f.actor,s.campaign.id,s.accountId,{...input,idempotency_key:randomUUID()}),code("evaluation_stale_input"));
 });
});
test("reviewed Work-shaped fixture can be approved with acknowledged unknowns; new evidence review or targeting invalidates approval (not hosted Work)",async()=>{
 await withDiscoveryDatabase(async f=>{
  const s=await seed(f,true),svc=evaluationService(f.database),ctx=await svc.context(f.actor,s.campaign.id,s.accountId);assert.equal(ctx.ready_for_step4,true);
  const row=await svc.record(f.actor,s.campaign.id,s.accountId,{input_sha256:ctx.input_sha256,idempotency_key:randomUUID(),model:"SYNTHETIC",output:sampleEvaluation(s.evidenceIds[0])});
  const review={evaluation_id:row.id,idempotency_key:randomUUID(),verdict:"approved",reason:"SYNTHETIC approval contract test",unknowns_acknowledged:false};await assert.rejects(svc.review(f.actor,s.campaign.id,s.accountId,review),code("evaluation_unknowns_acknowledgement_required"));
  await svc.review(f.actor,s.campaign.id,s.accountId,{...review,unknowns_acknowledged:true});assert.equal((await svc.detail(f.actor,s.campaign.id,s.accountId)).can_outreach,true);
  await s.discovery.reviewEvidence(s.who,{evidence_id:s.evidenceIds[0],verdict:"needs_review",reason:"SYNTHETIC source needs recheck"});assert.equal((await svc.detail(f.actor,s.campaign.id,s.accountId)).can_outreach,false);
  await f.database.update(memberships).set({role:"reviewer"}).where(eq(memberships.userId,f.actor.userId));await assert.rejects(svc.review(f.actor,s.campaign.id,s.accountId,{...review,idempotency_key:randomUUID(),verdict:"hold"}),code("evaluation_forbidden"));
 });
});
test("AI structured-output boundary uses no storage/tools, refuses malformed/refused results, and never calls without configuration",async()=>{
 await withDiscoveryDatabase(async f=>{
  const s=await seed(f,true),ctx=await evaluationService(f.database).context(f.actor,s.campaign.id,s.accountId),output=sampleEvaluation(s.evidenceIds[0]);let calls=0;
  const fetcher:typeof fetch=async(url,init)=>{calls++;assert.equal(url,"https://api.openai.com/v1/responses");const body=JSON.parse(String(init?.body));assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(body.tools,undefined);assert.match(body.input[0].content,/untrusted data/);return new Response(JSON.stringify({status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(output)}]}]}),{headers:{"Content-Type":"application/json"}});};
  await assert.rejects(requestAiEvaluation(ctx.snapshot,evaluationAiConfig({}),fetcher),code("evaluation_ai_not_configured"));assert.equal(calls,0);
  const config=evaluationAiConfig({EVALUATION_AI_ENABLED:"true",OPENAI_API_KEY:"synthetic-no-real-key",EVALUATION_MODEL:"synthetic-model"});assert.deepEqual(await requestAiEvaluation(ctx.snapshot,config,fetcher),output);assert.equal(calls,1);
  await assert.rejects(requestAiEvaluation(ctx.snapshot,config,async()=>new Response(JSON.stringify({status:"completed",output:[{type:"message",content:[{type:"refusal"}]}]}))),code("evaluation_provider_refused"));
  await assert.rejects(requestAiEvaluation(ctx.snapshot,config,async()=>new Response(JSON.stringify({status:"incomplete",output:[]}))),code("evaluation_provider_incomplete"));
 });
});
test("concurrent AI requests and lost responses do not automatically repeat paid generation; pending discovery blocks generation",async()=>{
 await withDiscoveryDatabase(async f=>{
  const s=await seed(f,true),svc=evaluationService(f.database),ctx=await svc.context(f.actor,s.campaign.id,s.accountId),key=randomUUID(),config=evaluationAiConfig({EVALUATION_AI_ENABLED:"true",OPENAI_API_KEY:"synthetic-key",EVALUATION_MODEL:"synthetic-model"});let calls=0;
  const fetcher:typeof fetch=async()=>{calls++;return new Response(JSON.stringify({status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(sampleEvaluation(s.evidenceIds[0]))}]}]}));};
  const results=await Promise.allSettled([generateEvaluation(f.actor,s.campaign.id,s.accountId,key,ctx.input_sha256,config,svc,fetcher),generateEvaluation(f.actor,s.campaign.id,s.accountId,key,ctx.input_sha256,config,svc,fetcher)]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(calls,1);
  await assert.rejects(generateEvaluation(f.actor,s.campaign.id,s.accountId,key,ctx.input_sha256,config,svc,fetcher));assert.equal(calls,1);
  const failedKey=randomUUID();await assert.rejects(generateEvaluation(f.actor,s.campaign.id,s.accountId,failedKey,ctx.input_sha256,config,svc,async()=>{calls++;throw new Error("SYNTHETIC lost response");}),code("evaluation_provider_unavailable"));
  const before=calls;await assert.rejects(generateEvaluation(f.actor,s.campaign.id,s.accountId,failedKey,ctx.input_sha256,config,svc,fetcher),code("evaluation_generation_already_attempted"));assert.equal(calls,before);
  const jobs=await f.database.select().from(evaluationRequests);assert.deepEqual(jobs.map(j=>j.state).sort(),["failed","succeeded"]);await assert.rejects(f.database.delete(evaluationRequests),sqlFailure("23514"));
  const pending=await seed(f),pendingCtx=await svc.context(f.actor,pending.campaign.id,pending.accountId);await assert.rejects(generateEvaluation(f.actor,pending.campaign.id,pending.accountId,randomUUID(),pendingCtx.input_sha256,config,svc,fetcher),code("evaluation_discovery_pending"));assert.equal(calls,before);
 });
});

test("changed input during generation is not saved or approved and archived campaigns never call the provider",async()=>{
 await withDiscoveryDatabase(async f=>{
  const s=await seed(f,true),svc=evaluationService(f.database),ctx=await svc.context(f.actor,s.campaign.id,s.accountId),key=randomUUID(),config=evaluationAiConfig({EVALUATION_AI_ENABLED:"true",OPENAI_API_KEY:"synthetic-key",EVALUATION_MODEL:"synthetic-model"});let calls=0;
  const fetcher:typeof fetch=async()=>{calls++;await f.database.update(campaigns).set({notes:"SYNTHETIC concurrent targeting change"}).where(eq(campaigns.id,s.campaign.id));return new Response(JSON.stringify({status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(sampleEvaluation(s.evidenceIds[0]))}]}]}));};
  await assert.rejects(generateEvaluation(f.actor,s.campaign.id,s.accountId,key,ctx.input_sha256,config,svc,fetcher),code("evaluation_stale_input"));assert.equal(calls,1);assert.equal((await f.database.select().from(creatorEvaluations)).length,0);assert.equal((await f.database.select().from(evaluationRequests))[0].state,"failed");
  await f.database.update(campaigns).set({status:"archived"}).where(eq(campaigns.id,s.campaign.id));const archived=await svc.context(f.actor,s.campaign.id,s.accountId);
  await assert.rejects(generateEvaluation(f.actor,s.campaign.id,s.accountId,randomUUID(),archived.input_sha256,config,svc,fetcher),code("evaluation_campaign_archived"));assert.equal(calls,1);
 });
});

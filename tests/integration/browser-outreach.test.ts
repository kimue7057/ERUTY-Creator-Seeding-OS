import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {withDiscoveryDatabase,sqlFailure} from "../discovery-fixture";
import {accountService} from "../../src/lib/outreach/accounts";
import {browserSendService} from "../../src/lib/outreach/browser-sends";
import {automaticWorkerService} from "../../src/lib/discovery/automatic-worker";
import {browserOutreachSends,instagramDmSends} from "../../src/lib/db/outreach-schema";
import {OutreachError} from "../../src/lib/outreach/contracts";
import {seedShortlistCandidate,goodShortlistEvaluation} from "../shortlist-samples";
import {shortlistService} from "../../src/lib/evaluation/shortlist";
import {evaluationService} from "../../src/lib/evaluation/service";
import {assessmentFingerprint} from "../../src/lib/evaluation/shortlist-policy";
import {draftService} from "../../src/lib/outreach/drafts";
type Fixture=Parameters<Parameters<typeof withDiscoveryDatabase>[0]>[0];
const code=(value:string)=>(e:unknown)=>e instanceof OutreachError&&e.code===value;
async function setup(f:Fixture){
  const account=await accountService(f.database).register(f.actor,{provider:"instagram",label:"SYNTHETIC browser company",identity:"synthetic_company"});
  const worker={worker_id:randomUUID(),instance_id:randomUUID(),name:"SYNTHETIC shared browser",browser_surface:"iab" as const,platforms:["instagram" as const],ready:true,outreach_ready:true};
  await automaticWorkerService(f.database).heartbeat(f.actor,worker);const svc=browserSendService(f.database),input={id:randomUUID(),accountId:account.id,recipient:"synthetic_recipient",body:"SYNTHETIC approved proposal",confirmed:true};
  const observation=()=>({sender:"synthetic_company",recipient:input.recipient,body:input.body,source_url:`https://www.instagram.com/${input.recipient}/`,observed_at:new Date().toISOString(),visible_text:`SYNTHETIC rendered outgoing: ${input.body}`});return{account,worker,lease:{worker_id:worker.worker_id,instance_id:worker.instance_id},svc,input,observation};
}
test("browser first-contact uses the same worker, requires exact approval and isolates roles/organizations without API tokens",async()=>withDiscoveryDatabase(async f=>{
  const h=await setup(f);await assert.rejects(h.svc.create(f.other,h.input),code("not_found"));await assert.rejects(h.svc.create(f.reader,h.input),code("forbidden"));await assert.rejects(h.svc.create(f.actor,{...h.input,confirmed:false}));
  const duplicate=await Promise.all([h.svc.create(f.actor,h.input),h.svc.create(f.actor,h.input)]);assert.equal(duplicate[0].id,duplicate[1].id);assert.equal((await h.svc.history(f.actor)).length,1);assert.equal((await h.svc.history(f.other)).length,0);
  const grant=(await h.svc.next(f.actor,h.lease)).assignment!;assert.ok(grant);const context=await h.svc.context(f.actor,grant);assert.equal(context.recipient,"synthetic_recipient");assert.equal(context.send_permitted,false);assert.equal(context.state,"preparing");
  assert.equal((await automaticWorkerService(f.database).next(f.actor,h.lease)).assignment,null);assert.equal((await shortlistService(f.database).next(f.actor,h.lease)).assignment,null);
  await assert.rejects(h.svc.context(f.actor,{...grant,claim_token:"0".repeat(64)}),code("browser_outreach_claim_expired"));
  await assert.rejects(h.svc.arm(f.actor,{...grant,observation:{...h.observation(),sender:"other_company"}}),code("browser_outreach_observation_invalid"));
  const permit=await h.svc.arm(f.actor,{...grant,observation:h.observation()});assert.equal(permit.send_permitted,true);await assert.rejects(h.svc.arm(f.actor,{...grant,observation:h.observation()}),code("browser_outreach_pending"));
  assert.equal((await h.svc.finish(f.actor,{...grant,outcome:"sent",reason:"confirmed_on_screen",observation:h.observation()})).state,"sent");
  assert.equal((await h.svc.finish(f.actor,{...grant,outcome:"sent",reason:"confirmed_on_screen",observation:h.observation()})).state,"sent");
  const [receipt]=await h.svc.history(f.actor);assert.equal(receipt.state,"sent");assert.ok(!JSON.stringify(receipt).includes("claimHash"));assert.ok(!JSON.stringify(receipt).includes(grant.claim_token));
  await assert.rejects(f.database.update(browserOutreachSends).set({body:"rewritten"}).where(eq(browserOutreachSends.id,h.input.id)),sqlFailure("23514"));await assert.rejects(f.database.delete(browserOutreachSends).where(eq(browserOutreachSends.id,h.input.id)),sqlFailure("23514"));
}));
test("cancellation, changed observations and ambiguous browser sends never authorize a duplicate or API bypass",async()=>withDiscoveryDatabase(async f=>{
  const h=await setup(f);await h.svc.create(f.actor,h.input);const grant=(await h.svc.next(f.actor,h.lease)).assignment!;
  await h.svc.cancel(f.actor,h.input.id);await assert.rejects(h.svc.arm(f.actor,{...grant,observation:h.observation()}),code("browser_outreach_pending"));
  const next={...h.input,id:randomUUID()};await h.svc.create(f.actor,next);const second=(await h.svc.next(f.actor,h.lease)).assignment!;
  for(const observation of [{...h.observation(),body:"different"},{...h.observation(),source_url:"https://evil.invalid/"},{...h.observation(),observed_at:new Date(0).toISOString()}])await assert.rejects(h.svc.arm(f.actor,{...second,observation}),code("browser_outreach_observation_invalid"));
  await h.svc.arm(f.actor,{...second,observation:h.observation()});await assert.rejects(h.svc.cancel(f.actor,next.id),code("browser_outreach_pending"));
  await assert.rejects(h.svc.finish(f.actor,{...second,outcome:"sent",reason:"confirmed_on_screen",observation:{...h.observation(),visible_text:"no outgoing text"}}),code("browser_outreach_observation_invalid"));
  assert.equal((await h.svc.finish(f.actor,{...second,outcome:"blocked",reason:"unconfirmed_result",observation:null})).state,"unknown");await assert.rejects(h.svc.create(f.actor,{...h.input,id:randomUUID()}),code("browser_outreach_pending"));
  await f.database.insert(instagramDmSends).values({id:randomUUID(),organizationId:f.actor.organizationId,accountId:h.account.id,conversationId:"synthetic_thread",senderProviderId:"333",fromUsername:"synthetic_company",recipientId:"444",recipientUsername:"other_recipient",body:"SYNTHETIC unknown API receipt",inputSha256:"a".repeat(64),status:"unknown",createdBy:f.actor.userId});
  await assert.rejects(h.svc.create(f.actor,{...h.input,id:randomUUID(),recipient:"other_recipient"}),code("browser_outreach_pending"));
}));
test("offline legacy workers cannot accept outreach and do not gain send permission from discovery alone",async()=>withDiscoveryDatabase(async f=>{
  const h=await setup(f);await automaticWorkerService(f.database).heartbeat(f.actor,{...h.worker,outreach_ready:false});assert.equal((await h.svc.availability(f.actor)).length,0);await assert.rejects(h.svc.create(f.actor,h.input),code("browser_outreach_offline"));
  await automaticWorkerService(f.database).heartbeat(f.actor,h.worker);await h.svc.create(f.actor,h.input);const grant=(await h.svc.next(f.actor,h.lease)).assignment!;
  await h.svc.finish(f.actor,{...grant,outcome:"blocked",reason:"login_required",observation:null});assert.equal((await h.svc.history(f.actor))[0].state,"blocked");
  await assert.rejects(h.svc.finish(f.actor,{...grant,claim_token:"f".repeat(64),outcome:"sent",reason:"confirmed_on_screen",observation:h.observation()}),code("browser_outreach_claim_expired"));
}));
test("campaign browser outreach rechecks selection, recipient and draft at arm time",async()=>withDiscoveryDatabase(async f=>{
  const h=await setup(f),seed=await seedShortlistCandidate(f),shortlist=shortlistService(f.database);await shortlist.enqueue(f.actor,seed.campaign.id,seed.accountId);const assignment=(await shortlist.next(f.actor,seed.worker)).assignment!;
  await shortlist.finish(f.actor,{...seed.worker,assessment_id:assignment.assessment_id,output:goodShortlistEvaluation(seed.ids[0]),error_code:null});await shortlist.review(f.actor,seed.campaign.id,{assessment_id:assignment.assessment_id,idempotency_key:randomUUID(),verdict:"approved",reason:"",acknowledged:true});
  const detail=await evaluationService(f.database).detail(f.actor,seed.campaign.id,seed.accountId),recipient=detail.snapshot.creator.handle!;
  const draft=await draftService(f.database).save(f.actor,{id:randomUUID(),campaignId:seed.campaign.id,creatorAccountId:seed.accountId,inputSha256:assessmentFingerprint(detail.snapshot),revision:0,channel:"instagram",subject:"",body:h.input.body,template:"letter",senderAccountId:h.account.id,fromAddress:"@synthetic_company",toAddress:`@${recipient}`,recipientSource:detail.snapshot.creator.profile_url});
  await h.svc.create(f.actor,{...h.input,id:draft.id,recipient,draftId:draft.id,draftRevision:draft.revision});const grant=(await h.svc.next(f.actor,h.lease)).assignment!;
  await shortlist.review(f.actor,seed.campaign.id,{assessment_id:assignment.assessment_id,idempotency_key:randomUUID(),verdict:"rejected",reason:"SYNTHETIC approval withdrawn",acknowledged:true});
  await assert.rejects(h.svc.arm(f.actor,{...grant,observation:{...h.observation(),recipient,source_url:detail.snapshot.creator.profile_url}}),code("stale"));assert.equal((await h.svc.context(f.actor,grant)).state,"preparing");
  await h.svc.finish(f.actor,{...grant,outcome:"blocked",reason:"unconfirmed_result",observation:null});assert.equal((await draftService(f.database).get(f.actor,draft.id))?.status,"failed");
}));

test("expired armed workers stay unknown; disconnected queued senders close without starving the browser queue",async()=>withDiscoveryDatabase(async f=>{
  const h=await setup(f);
  // A synthetic crashed process had already committed its one-click permit.
  await f.database.insert(browserOutreachSends).values({id:randomUUID(),organizationId:f.actor.organizationId,accountId:h.account.id,senderUsername:"synthetic_company",recipientUsername:"synthetic_recipient",body:h.input.body,inputSha256:"a".repeat(64),state:"armed",workerId:h.worker.worker_id,instanceId:randomUUID(),claimHash:"b".repeat(64),claimExpiresAt:new Date(Date.now()-1000),armedAt:new Date(Date.now()-600000),createdBy:f.actor.userId});
  assert.equal((await h.svc.next(f.actor,h.lease)).assignment,null);assert.equal((await h.svc.history(f.actor))[0].state,"unknown");await assert.rejects(h.svc.create(f.actor,h.input),code("browser_outreach_pending"));
  const input={...h.input,id:randomUUID(),recipient:"synthetic_other"};await h.svc.create(f.actor,input);await accountService(f.database).disconnect(f.actor,h.account.id);assert.equal((await h.svc.next(f.actor,h.lease)).assignment,null);assert.equal((await h.svc.history(f.actor)).find(j=>j.id===input.id)?.state,"blocked");
}));

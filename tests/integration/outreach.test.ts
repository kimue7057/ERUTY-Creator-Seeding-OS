import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { withDiscoveryDatabase } from "../discovery-fixture";
import { seedShortlistCandidate,goodShortlistEvaluation } from "../shortlist-samples";
import { shortlistService } from "../../src/lib/evaluation/shortlist";
import { evaluationService } from "../../src/lib/evaluation/service";
import { assessmentFingerprint } from "../../src/lib/evaluation/shortlist-policy";
import { accountService } from "../../src/lib/outreach/accounts";
import { draftService } from "../../src/lib/outreach/drafts";
import { senderAccounts,senderOAuthStates,outreachDrafts } from "../../src/lib/db/outreach-schema";
import { GOOGLE_SEND_SCOPE } from "../../src/lib/outreach/providers";
import { OutreachError } from "../../src/lib/outreach/contracts";
import { seal } from "../../src/lib/outreach/crypto";
process.env.OUTREACH_ENCRYPTION_KEY="a".repeat(64);
process.env.OUTREACH_GOOGLE_CLIENT_ID="synthetic-client";process.env.OUTREACH_GOOGLE_CLIENT_SECRET="synthetic-secret";
process.env.APP_ORIGIN="http://127.0.0.1:3000";
const errorCode=(code:string)=>(e:unknown)=>e instanceof OutreachError&&e.code===code;
const mock:typeof fetch=async url=>String(url).includes("oauth2.googleapis.com/token")?Response.json({access_token:"synthetic-access",refresh_token:"synthetic-refresh",expires_in:3600,scope:`openid email ${GOOGLE_SEND_SCOPE}`}):Response.json({sub:"synthetic-subject",email:"sender@example.invalid",email_verified:true});
test("OAuth is single-use, bound to the current session and tenant; public views never expose credentials",async()=>{
  await withDiscoveryDatabase(async f=>{
    const service=accountService(f.database,mock),account=await service.register(f.actor,{provider:"google",label:"Synthetic sender",identity:"sender@example.invalid"});
    assert.equal(account.status,"pending");assert.deepEqual(account.addresses,[]);
    await assert.rejects(service.register(f.reader,{provider:"google",label:"no",identity:"x@example.invalid"}),errorCode("forbidden"));
    await assert.rejects(service.begin(f.other,account.id,"session"),errorCode("not_found"));
    const url=new URL(await service.begin(f.actor,account.id,"session-a")),state=url.searchParams.get("state")!;
    assert.equal(url.searchParams.get("code_challenge_method"),"S256");assert.equal(url.searchParams.get("access_type"),"offline");
    await assert.rejects(service.complete(f.actor,"google",state,"session-b","code"),errorCode("oauth_expired"));
    await service.complete(f.actor,"google",state,"session-a","code");
    await assert.rejects(service.complete(f.actor,"google",state,"session-a","code"),errorCode("oauth_expired"));
    const publicRows=await service.list(f.actor);assert.equal(publicRows[0].status,"connected");assert.ok(!JSON.stringify(publicRows).includes("synthetic-access"));assert.ok(!JSON.stringify(publicRows).includes("tokenCiphertext"));assert.equal((await service.list(f.other)).length,0);
    const reconnect=new URL(await service.begin(f.actor,account.id,"session-a"));
    await service.disconnect(f.actor,account.id);
    await assert.rejects(service.complete(f.actor,"google",reconnect.searchParams.get("state")!,"session-a","code"),errorCode("oauth_expired"));
    assert.equal((await f.database.select().from(senderAccounts))[0].tokenCiphertext,null);
  });
});
test("wrong provider identity, missing consent, expired states and duplicate account registrations do not connect",async()=>{
  await withDiscoveryDatabase(async f=>{
    const service=accountService(f.database,mock),account=await service.register(f.actor,{provider:"google",label:"Other expected",identity:"other@example.invalid"});
    await assert.rejects(service.register(f.actor,{provider:"google",label:"duplicate",identity:"OTHER@example.invalid"}),errorCode("duplicate"));
    let state=new URL(await service.begin(f.actor,account.id,"session")).searchParams.get("state")!;
    await assert.rejects(service.complete(f.actor,"google",state,"session","code"),errorCode("wrong_identity"));
    assert.equal((await service.list(f.actor))[0].status,"pending");
    state=new URL(await service.begin(f.actor,account.id,"session")).searchParams.get("state")!;
    await assert.rejects(service.complete(f.actor,"google",state,"session",null),errorCode("oauth_denied"));
    state=new URL(await service.begin(f.actor,account.id,"session")).searchParams.get("state")!;
    await f.database.update(senderOAuthStates).set({expiresAt:new Date(0)});
    await assert.rejects(service.complete(f.actor,"google",state,"session","code"),errorCode("oauth_expired"));
  });
});
async function approvedFixture(f:Parameters<Parameters<typeof withDiscoveryDatabase>[0]>[0]) {
  const seeded=await seedShortlistCandidate(f),svc=shortlistService(f.database);
  await svc.enqueue(f.actor,seeded.campaign.id,seeded.accountId);const assignment=(await svc.next(f.actor,seeded.worker)).assignment!;
  await svc.finish(f.actor,{...seeded.worker,assessment_id:assignment.assessment_id,output:goodShortlistEvaluation(seeded.ids[0]),error_code:null});
  await svc.review(f.actor,seeded.campaign.id,{assessment_id:assignment.assessment_id,idempotency_key:randomUUID(),verdict:"approved",reason:"",acknowledged:true});
  const context=await evaluationService(f.database).detail(f.actor,seeded.campaign.id,seeded.accountId);
  const account=await accountService(f.database).register(f.actor,{provider:"google",label:"Synthetic verified sender",identity:"sender@example.invalid"});
  await f.database.update(senderAccounts).set({status:"connected",providerId:"synthetic",identity:"sender@example.invalid",addresses:[{address:"sender@example.invalid",label:"Primary",primary:true}],tokenCiphertext:seal(JSON.stringify({accessToken:"synthetic-access",expiresAt:Date.now()+3600000,scopes:[GOOGLE_SEND_SCOPE]}),`${f.actor.organizationId}:${account.id}:sender-token`),verifiedAt:new Date()}).where(eq(senderAccounts.id,account.id));
  const input={id:randomUUID(),campaignId:seeded.campaign.id,creatorAccountId:seeded.accountId,inputSha256:assessmentFingerprint(context.snapshot),revision:0,channel:"email",subject:"Synthetic proposal",body:"Synthetic creator context only",template:"brand",senderAccountId:account.id,fromAddress:"sender@example.invalid",toAddress:"creator@example.invalid",recipientSource:"https://example.invalid/contact"};
  return {input,seeded,assignment,svc};
}
test("selected sender, draft revision and explicit confirmation are enforced; double-click cannot send twice",async()=>{
  await withDiscoveryDatabase(async f=>{
    const {input}=await approvedFixture(f);let sends=0;
    const sendMock:typeof fetch=async(url,init)=>{if(String(url).includes("userinfo"))return Response.json({sub:"synthetic",email:"sender@example.invalid",email_verified:true});sends++;const message=Buffer.from(JSON.parse(String(init?.body)).raw,"base64url").toString();assert.match(message,/To: creator@example.invalid/);return Response.json({id:"synthetic-provider-message"});};
    const svc=draftService(f.database,sendMock);
    await assert.rejects(svc.save(f.other,input));await assert.rejects(svc.save(f.reader,input),errorCode("forbidden"));
    await assert.rejects(svc.save(f.actor,{...input,fromAddress:"spoof@example.invalid"}),errorCode("reconnect"));
    const saved=await svc.save(f.actor,input);await assert.rejects(svc.save(f.actor,input),errorCode("draft_changed"));
    await assert.rejects(svc.send(f.actor,saved.id,saved.revision,false),errorCode("recipient_required"));
    const results=await Promise.allSettled([svc.send(f.actor,saved.id,saved.revision,true),svc.send(f.actor,saved.id,saved.revision,true)]);
    assert.equal(sends,1);assert.ok(results.some(r=>r.status==="fulfilled"));
    assert.equal((await svc.send(f.actor,saved.id,saved.revision,true)).status,"sent");assert.equal(sends,1);
    assert.equal((await svc.list(f.other,input.campaignId,input.creatorAccountId)).length,0);
  });
});
test("uncertain delivery is retained and never retried; SNS connection alone cannot authorize DM",async()=>{
  await withDiscoveryDatabase(async f=>{
    const {input}=await approvedFixture(f);let sends=0;
    const svc=draftService(f.database,async url=>{if(String(url).includes("userinfo"))return Response.json({sub:"synthetic",email:"sender@example.invalid",email_verified:true});sends++;throw new Error("synthetic network interruption");});
    const saved=await svc.save(f.actor,input);
    await assert.rejects(svc.send(f.actor,saved.id,saved.revision,true),errorCode("send_unknown"));
    await assert.rejects(svc.send(f.actor,saved.id,saved.revision,true),errorCode("send_unknown"));assert.equal(sends,1);
    assert.equal((await f.database.select().from(outreachDrafts).where(eq(outreachDrafts.id,saved.id)))[0].status,"unknown");
    const social=await svc.save(f.actor,{...input,id:randomUUID(),channel:"tiktok",senderAccountId:null,fromAddress:"",toAddress:"https://www.tiktok.com/@synthetic"});
    await assert.rejects(svc.send(f.actor,social.id,social.revision,true),errorCode("social_unavailable"));assert.equal(sends,1);
  });
});
test("withdrawing final approval blocks a previously saved message",async()=>{
  await withDiscoveryDatabase(async f=>{
    const {input,seeded,assignment,svc:shortlist}=await approvedFixture(f);let sends=0;
    const svc=draftService(f.database,async()=>{sends++;return Response.json({id:"must-not-send"});});const saved=await svc.save(f.actor,input);
    await shortlist.review(f.actor,seeded.campaign.id,{assessment_id:assignment.assessment_id,idempotency_key:randomUUID(),verdict:"hold",reason:"",acknowledged:true});
    await assert.rejects(svc.send(f.actor,saved.id,saved.revision,true),errorCode("stale"));assert.equal(sends,0);
  });
});

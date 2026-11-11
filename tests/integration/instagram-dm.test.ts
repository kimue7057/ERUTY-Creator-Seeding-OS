import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { withDiscoveryDatabase,sqlFailure } from "../discovery-fixture";
import { accountService } from "../../src/lib/outreach/accounts";
import { providerAppService } from "../../src/lib/outreach/provider-apps";
import { instagramDmService } from "../../src/lib/outreach/instagram-dm";
import { instagramDmSends,senderAccounts,browserOutreachSends } from "../../src/lib/db/outreach-schema";
import { OutreachError } from "../../src/lib/outreach/contracts";
import { seedShortlistCandidate,goodShortlistEvaluation } from "../shortlist-samples";
import { shortlistService } from "../../src/lib/evaluation/shortlist";
import { evaluationService } from "../../src/lib/evaluation/service";
import { assessmentFingerprint } from "../../src/lib/evaluation/shortlist-policy";
import { draftService } from "../../src/lib/outreach/drafts";
process.env.OUTREACH_ENCRYPTION_KEY="a".repeat(64);process.env.APP_ORIGIN="http://127.0.0.1:3000";
const code=(c:string)=>(e:unknown)=>e instanceof OutreachError&&e.code===c;
type Fixture=Parameters<Parameters<typeof withDiscoveryDatabase>[0]>[0];
async function setup(f:Fixture){
  await providerAppService(f.database).save(f.actor,{provider:"instagram",revision:0,clientId:"10000",clientSecret:"synthetic-secret",version:"v27.0",instagramLoginMode:"unified",configurationId:"20000"});
  let sends=0,mode="ok",username="synthetic_recipient";const selection={conversationId:"t_synthetic",recipientId:"444",username};
  const incoming=()=>({id:"message_in",created_time:new Date(Date.now()-(mode==="expired"?25*3600000:10000)).toISOString(),from:{id:"444",username},to:{data:[{id:"333",username:"synthetic_company"}]},message:"SYNTHETIC inbound"});
  const mock:typeof fetch=async(url,init)=>{
    const u=new URL(String(url));assert.equal(u.hostname,"graph.facebook.com");
    if(u.pathname.endsWith("/debug_token"))return Response.json({data:{app_id:"10000",type:"SYSTEM_USER",is_valid:true,expires_at:0,scopes:mode==="revoked"?["instagram_basic"]:["instagram_basic","instagram_manage_messages"]}});
    if(u.pathname.endsWith("/assigned_instagram_accounts"))return Response.json({data:[{id:"333",username:"synthetic_company"}]});
    if(u.pathname.endsWith("/conversations"))return Response.json({data:mode==="missing"?[]:[{id:"t_synthetic",updated_time:new Date().toISOString(),messages:{data:[incoming()]}}]});
    if(u.pathname.endsWith("/t_synthetic"))return Response.json({id:"t_synthetic",messages:{data:[incoming()]}});
    assert.equal(u.pathname,"/v27.0/333/messages");assert.equal(init?.method,"POST");sends++;
    if(mode==="unknown")throw new Error("SYNTHETIC ambiguous transport");
    if(mode==="reject")return Response.json({error:{code:200,message:"SYNTHETIC private diagnostic"}},{status:403});
    return Response.json({recipient_id:"444",message_id:"synthetic_receipt"});
  };
  const accounts=accountService(f.database,mock),account=await accounts.register(f.actor,{provider:"instagram",label:"Synthetic IG",identity:"synthetic_company"});
  await accounts.connectInstagramSystemUser(f.actor,account.id,{accessToken:"synthetic-private-meta-token",revision:1,updatedAt:account.updatedAt.toISOString(),confirmed:true});
  const svc=instagramDmService(f.database,mock),input={id:randomUUID(),accountId:account.id,selection,body:"SYNTHETIC approved reply",confirmed:true};
  return{svc,input,account,mock,sends:()=>sends,mode:(value:string)=>{mode=value;},username:(value:string)=>{username=value;selection.username=value;}};
}
test("Instagram sending is tenant/role scoped, confirmed, sender-owned, immutable and idempotent under concurrent requests",async()=>withDiscoveryDatabase(async f=>{
  const h=await setup(f);
  await assert.rejects(h.svc.list(f.other,h.account.id),code("not_found"));await assert.rejects(h.svc.list(f.reader,h.account.id),code("forbidden"));
  await assert.rejects(h.svc.send(f.actor,{...h.input,confirmed:false}));assert.equal(h.sends(),0);
  await assert.rejects(h.svc.send(f.actor,{...h.input,selection:{...h.input.selection,username:"wrong_recipient"}}),code("instagram_dm_recipient_changed"));assert.equal(h.sends(),0);
  const browserId=randomUUID();await f.database.insert(browserOutreachSends).values({id:browserId,organizationId:f.actor.organizationId,accountId:h.account.id,senderUsername:"synthetic_company",recipientUsername:h.input.selection.username,body:"SYNTHETIC queued browser reply",inputSha256:"a".repeat(64),createdBy:f.actor.userId});
  await assert.rejects(h.svc.send(f.actor,h.input),code("browser_outreach_pending"));assert.equal(h.sends(),0);await f.database.update(browserOutreachSends).set({state:"cancelled"}).where(eq(browserOutreachSends.id,browserId));
  const result=await Promise.allSettled([h.svc.send(f.actor,h.input),h.svc.send(f.actor,h.input)]);assert.ok(result.some(r=>r.status==="fulfilled"));assert.equal(h.sends(),1);
  assert.equal((await h.svc.send(f.actor,h.input)).status,"sent");assert.equal(h.sends(),1);
  await assert.rejects(h.svc.send(f.actor,{...h.input,body:"changed"}),code("instagram_dm_request_changed"));
  assert.equal((await h.svc.history(f.other)).length,0);
  await assert.rejects(f.database.update(instagramDmSends).set({body:"rewritten"}).where(eq(instagramDmSends.id,h.input.id)),sqlFailure("23514"));
  await assert.rejects(f.database.delete(instagramDmSends).where(eq(instagramDmSends.id,h.input.id)),sqlFailure("23514"));
}));
test("expired, missing and revoked conversations cannot send, and an ambiguous send blocks new IDs in that conversation",async()=>withDiscoveryDatabase(async f=>{
  const h=await setup(f);
  for(const [mode,error] of [["expired","instagram_dm_window_closed"],["missing","instagram_dm_conversation_missing"],["revoked","instagram_dm_access_required"]]){h.mode(mode);await assert.rejects(h.svc.send(f.actor,h.input),code(error));}assert.equal(h.sends(),0);
  h.mode("unknown");await assert.rejects(h.svc.send(f.actor,h.input),code("instagram_dm_send_unknown"));assert.equal(h.sends(),1);
  await assert.rejects(h.svc.send(f.actor,{...h.input,id:randomUUID()}),code("instagram_dm_send_unknown"));assert.equal(h.sends(),1);
  const [row]=await h.svc.history(f.actor);assert.equal(row.status,"unknown");assert.equal(row.providerMessageId,null);
}));
test("explicit Meta rejections retain a safe failed receipt and permit a separately confirmed new attempt",async()=>withDiscoveryDatabase(async f=>{
  const h=await setup(f);h.mode("reject");await assert.rejects(h.svc.send(f.actor,h.input),code("instagram_dm_access_required"));
  const [receipt]=await h.svc.history(f.actor);assert.equal(receipt.status,"failed");assert.equal(receipt.graphCode,200);assert.ok(!JSON.stringify(receipt).includes("private diagnostic"));
  h.mode("ok");assert.equal((await h.svc.send(f.actor,{...h.input,id:randomUUID()})).status,"sent");assert.equal(h.sends(),2);
  await accountService(f.database,h.mock).disconnect(f.actor,h.account.id);await assert.rejects(h.svc.send(f.actor,{...h.input,id:randomUUID()}),code("reconnect"));assert.equal(h.sends(),2);
}));
test("campaign Instagram sends require the current final selection, revision and matching creator, and preserve a receipt",async()=>withDiscoveryDatabase(async f=>{
  const h=await setup(f),seed=await seedShortlistCandidate(f),shortlist=shortlistService(f.database);await shortlist.enqueue(f.actor,seed.campaign.id,seed.accountId);
  const assignment=(await shortlist.next(f.actor,seed.worker)).assignment!;await shortlist.finish(f.actor,{...seed.worker,assessment_id:assignment.assessment_id,output:goodShortlistEvaluation(seed.ids[0]),error_code:null});await shortlist.review(f.actor,seed.campaign.id,{assessment_id:assignment.assessment_id,idempotency_key:randomUUID(),verdict:"approved",reason:"",acknowledged:true});
  const detail=await evaluationService(f.database).detail(f.actor,seed.campaign.id,seed.accountId);h.username(detail.snapshot.creator.handle!);
  const svc=draftService(f.database,h.mock),draft=await svc.save(f.actor,{id:randomUUID(),campaignId:seed.campaign.id,creatorAccountId:seed.accountId,inputSha256:assessmentFingerprint(detail.snapshot),revision:0,channel:"instagram",subject:"",body:h.input.body,template:"letter",senderAccountId:h.account.id,fromAddress:"@synthetic_company",toAddress:`@${h.input.selection.username}`,recipientSource:detail.snapshot.creator.profile_url,instagramConversation:h.input.selection});
  await assert.rejects(svc.send(f.actor,draft.id,draft.revision+1,true),code("draft_changed"));
  assert.equal((await svc.send(f.actor,draft.id,draft.revision,true)).status,"sent");assert.equal(h.sends(),1);assert.equal((await h.svc.history(f.actor))[0].draftId,draft.id);
  assert.equal((await svc.send(f.actor,draft.id,draft.revision,true)).status,"sent");assert.equal(h.sends(),1);
  const next=await svc.save(f.actor,{...draft,id:randomUUID(),revision:0});await shortlist.review(f.actor,seed.campaign.id,{assessment_id:assignment.assessment_id,idempotency_key:randomUUID(),verdict:"rejected",reason:"SYNTHETIC changed approval",acknowledged:true});
  await assert.rejects(svc.send(f.actor,next.id,next.revision,true),code("stale"));assert.equal(h.sends(),1);
  const [stored]=await f.database.select().from(senderAccounts).where(eq(senderAccounts.id,h.account.id));assert.equal(stored.status,"connected");
}));


test('contact CRM imports confirmed Instagram outreach, reads inbound, pins sender and recipient, and records one API reply',async()=>withDiscoveryDatabase(async f=>{
 const {contactService}=await import('../../src/lib/outreach/contacts');const h=await setup(f);
 await f.database.insert(instagramDmSends).values({id:randomUUID(),organizationId:f.actor.organizationId,accountId:h.account.id,conversationId:h.input.selection.conversationId,senderProviderId:'333',fromUsername:'synthetic_company',recipientId:'444',recipientUsername:h.input.selection.username,body:'SYNTHETIC original proposal',inputSha256:'a'.repeat(64),status:'sent',providerMessageId:'synthetic_first_send',sentAt:new Date(Date.now()-120000),createdBy:f.actor.userId});
 const crm=contactService(f.database,h.mock),rows=await crm.list(f.actor);assert.equal(rows.length,1);assert.equal(rows[0].origin,'legacy');const inbox=await crm.sync(f.actor,rows[0].id);assert.equal(inbox.messages.at(-1)?.direction,'in');assert.equal(inbox.conversation.instagramSelection?.recipientId,'444');
 const input={id:randomUUID(),caseId:rows[0].id,version:inbox.conversation.version,body:'SYNTHETIC CRM Instagram reply',confirmed:true};const sent=await crm.reply(f.actor,input);assert.equal(sent.attempts[0].status,'sent');assert.equal(sent.messages.at(-1)?.body,input.body);assert.equal(h.sends(),1);assert.equal((await crm.list(f.actor)).length,1);await crm.reply(f.actor,input);assert.equal(h.sends(),1);
 await assert.rejects(crm.reply(f.other,{...input,id:randomUUID()}),code('not_found'));assert.equal(h.sends(),1);
}));

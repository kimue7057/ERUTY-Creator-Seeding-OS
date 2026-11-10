import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {withDiscoveryDatabase,sqlFailure} from "../discovery-fixture";
import {accountService} from "../../src/lib/outreach/accounts";
import {outreachExecutorService} from "../../src/lib/outreach/executors";
import {browserSendService} from "../../src/lib/outreach/browser-sends";
import {outreachExtensionId} from "../../src/lib/outreach/executor-contracts";
import {browserOutreachExecutors} from "../../src/lib/db/outreach-schema";
import {OutreachError} from "../../src/lib/outreach/contracts";
const code=(value:string)=>(e:unknown)=>e instanceof OutreachError&&e.code===value;
type Fixture=Parameters<Parameters<typeof withDiscoveryDatabase>[0]>[0];
async function connection(f:Fixture,name="synthetic_company"){
  const account=await accountService(f.database).register(f.actor,{provider:"instagram",label:"SYNTHETIC company",identity:name}),svc=outreachExecutorService(f.database);
  const pair=await svc.startPair(f.actor,{accountId:account.id,name:"SYNTHETIC Chrome executor",confirmed:true});const credentials=await svc.pair({code:pair.code,extension_id:outreachExtensionId}),identity=await svc.authenticate(credentials.token);return{account,svc,pair,credentials,identity};
}
test("executor pairing is one-use, admin-approved, account-scoped and never exposes tokens in lists",async()=>withDiscoveryDatabase(async f=>{
  const h=await connection(f);
  await assert.rejects(h.svc.startPair(f.reader,{accountId:h.account.id,name:"SYNTHETIC",confirmed:true}),code("forbidden"));
  await assert.rejects(h.svc.startPair(f.other,{accountId:h.account.id,name:"SYNTHETIC",confirmed:true}),code("not_found"));
  await assert.rejects(h.svc.pair({code:h.pair.code,extension_id:outreachExtensionId}),code("forbidden"));
  const list=await h.svc.list(f.actor);assert.equal(list.length,1);assert.ok(!JSON.stringify(list).includes(h.credentials.token));assert.ok(!JSON.stringify(list).includes(h.pair.code));assert.equal((await h.svc.list(f.other)).length,0);
  await assert.rejects(f.database.update(browserOutreachExecutors).set({accountId:randomUUID()}).where(eq(browserOutreachExecutors.id,h.identity.id)),sqlFailure("23514"));
  const svc=browserSendService(f.database),request={id:randomUUID(),accountId:h.account.id,recipient:"synthetic_creator",body:"SYNTHETIC exact approved message",confirmed:true};
  await h.svc.heartbeat(h.identity,{observed_username:"synthetic_wrong",reason:"ready"});assert.equal((await svc.availability(f.actor,h.account.id)).length,0);await assert.rejects(svc.create(f.actor,request),code("browser_outreach_offline"));
  await h.svc.heartbeat(h.identity,{observed_username:"synthetic_company",reason:"ready"});assert.equal((await svc.availability(f.actor,h.account.id)).length,1);
  const second=await accountService(f.database).register(f.actor,{provider:"instagram",label:"SYNTHETIC other sender",identity:"synthetic_second"});assert.equal((await svc.availability(f.actor,second.id)).length,0);await assert.rejects(svc.create(f.actor,{...request,accountId:second.id}),code("browser_outreach_offline"));
  await svc.create(f.actor,request);const grant=(await svc.next(f.actor,h.identity.lease)).assignment!;assert.ok(grant);const ctx=await svc.context(f.actor,grant);assert.equal(ctx.sender,"synthetic_company");
}));
test("two executor profiles cannot claim or arm each other's company jobs; revocation preserves unknown sends",async()=>withDiscoveryDatabase(async f=>{
  const a=await connection(f,"synthetic_a"),b=await connection(f,"synthetic_b"),svc=browserSendService(f.database);
  for(const h of[a,b])await h.svc.heartbeat(h.identity,{observed_username:h.credentials.sender,reason:"ready"});
  const body="SYNTHETIC approved test",aInput={id:randomUUID(),accountId:a.account.id,recipient:"synthetic_recipient",body,confirmed:true};
  await svc.create(f.actor,{...aInput,id:randomUUID(),accountId:b.account.id});assert.equal((await svc.next(f.actor,a.identity.lease)).assignment,null);
  const bg=(await svc.next(f.actor,b.identity.lease)).assignment!;await assert.rejects(svc.context(f.actor,{...bg,...a.identity.lease}),code("not_found"));
  await svc.create(f.actor,aInput);const ag=(await svc.next(f.actor,a.identity.lease)).assignment!;
  await svc.arm(f.actor,{...ag,observation:{sender:"synthetic_a",recipient:"synthetic_recipient",body,source_url:"https://www.instagram.com/synthetic_recipient/",observed_at:new Date().toISOString(),visible_text:body}});
  await a.svc.revoke(f.actor,a.identity.id);assert.equal((await svc.history(f.actor,a.account.id))[0].state,"unknown");await assert.rejects(a.svc.authenticate(a.credentials.token),code("forbidden"));assert.equal((await svc.availability(f.actor,a.account.id)).length,0);
  await b.svc.revoke(f.actor,b.identity.id);assert.equal((await svc.history(f.actor,b.account.id))[0].state,"blocked");
}));
test("concurrent redemption issues one credential and expired pairing never connects",async()=>withDiscoveryDatabase(async f=>{
  const account=await accountService(f.database).register(f.actor,{provider:"instagram",label:"SYNTHETIC",identity:"synthetic_company"}),svc=outreachExecutorService(f.database);
  const p=await svc.startPair(f.actor,{accountId:account.id,name:"SYNTHETIC",confirmed:true});const result=await Promise.allSettled([svc.pair({code:p.code,extension_id:outreachExtensionId}),svc.pair({code:p.code,extension_id:outreachExtensionId})]);assert.equal(result.filter(r=>r.status==="fulfilled").length,1);
  const expired=await svc.startPair(f.actor,{accountId:account.id,name:"SYNTHETIC expired",confirmed:true});await f.client.query("update outreach_browser_executors set pair_expires_at=now()-interval '1 second' where status='pairing'");await assert.rejects(svc.pair({code:expired.code,extension_id:outreachExtensionId}),code("forbidden"));
}));
test("a pre-arm UI failure preserves its exact stage without claiming a send or storing invented evidence",async()=>withDiscoveryDatabase(async f=>{
  const h=await connection(f),svc=browserSendService(f.database);await h.svc.heartbeat(h.identity,{observed_username:"synthetic_company",reason:"ready"});const input={id:randomUUID(),accountId:h.account.id,recipient:"synthetic_recipient",body:"SYNTHETIC not sent",confirmed:true};await svc.create(f.actor,input);const grant=(await svc.next(f.actor,h.identity.lease)).assignment!;
  assert.equal((await svc.finish(f.actor,{...grant,outcome:"blocked",reason:"recipient_button_unavailable",ui_diagnostic:{stage:"open",path_kind:"recipient_profile",message_controls:[{label:"Message",kind:"button",enabled:false}],editor_count:0,recipient_headers:0}})).state,"blocked");
  const row=(await f.client.query("select state,reason,armed_at,sent_at,observation from outreach_browser_sends where id=$1",[input.id])).rows[0];assert.equal(row.reason,"recipient_button_unavailable");assert.equal(row.armed_at,null);assert.equal(row.sent_at,null);assert.equal(row.observation,null);assert.equal((await f.client.query("select count(*)::int count from audit_events where entity_id=$1 and action='outreach.browser_ui_blocked.open'",[input.id])).rows[0].count,1);
}));

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
import { InstagramConnectionError } from "../../src/lib/outreach/instagram-errors";
import { seal } from "../../src/lib/outreach/crypto";
import { providerAppService, resolveProviderConfig } from "../../src/lib/outreach/provider-apps";
import { templateService } from "../../src/lib/outreach/templates";
import { defaultBranding } from "../../src/lib/outreach/template-contracts";
import { outreachProviderApps } from "../../src/lib/db/outreach-schema";
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
test("Unified Instagram config is session-bound, encrypted, target-scoped and independent of Google fingerprints",async()=>{
  await withDiscoveryDatabase(async f=>{
    const googleBefore=await f.database.transaction(tx=>resolveProviderConfig(tx,f.actor.organizationId,"google"));
    const apps=providerAppService(f.database),input={provider:"instagram",revision:0,clientId:"10000",clientSecret:"synthetic-meta-secret",version:"v25.0",instagramLoginMode:"unified",configurationId:"20000"};
    await apps.save(f.actor,input);
    const googleAfter=await f.database.transaction(tx=>resolveProviderConfig(tx,f.actor.organizationId,"google"));assert.equal(googleAfter.fingerprint,googleBefore.fingerprint);
    let calls=0;
    const meta:typeof fetch=async url=>{calls++;const u=new URL(String(url));assert.equal(u.hostname,"graph.facebook.com");
      if(u.pathname.endsWith("/oauth/access_token"))return Response.json({access_token:"synthetic-system-token"});
      if(u.pathname.endsWith("/debug_token"))return Response.json({data:{app_id:"10000",type:"SYSTEM_USER",is_valid:true,expires_at:0,scopes:["instagram_basic"]}});
      return Response.json({data:[{id:"111",username:"not_the_target"},{id:"333",username:"intended_creator"}]});};
    const svc=accountService(f.database,meta),account=await svc.register(f.actor,{provider:"instagram",label:"Synthetic Instagram",identity:"intended_creator"});
    const url=new URL(await svc.begin(f.actor,account.id,"session-a"));assert.equal(url.origin,"https://www.facebook.com");assert.equal(url.searchParams.get("config_id"),"20000");
    await assert.rejects(svc.complete(f.actor,"instagram",url.searchParams.get("state")!,"wrong-session","code"),errorCode("oauth_expired"));assert.equal(calls,0);
    await svc.complete(f.actor,"instagram",url.searchParams.get("state")!,"session-a","code");
    const stored=(await f.database.select().from(senderAccounts).where(eq(senderAccounts.id,account.id)))[0];assert.equal(stored.providerId,"333");assert.equal(stored.expiresAt,null);assert.ok(!stored.tokenCiphertext!.includes("synthetic-system-token"));
    assert.equal((await svc.list(f.actor))[0].status,"connected");await svc.sync(f.actor,account.id);
    const pending=new URL(await svc.begin(f.actor,account.id,"session-a"));
    await apps.save(f.actor,{...input,revision:1,replace:true,configurationId:"20001"});
    assert.equal((await svc.list(f.actor))[0].status,"reconnect");await assert.rejects(svc.complete(f.actor,"instagram",pending.searchParams.get("state")!,"session-a","code"),errorCode("oauth_expired"));
    await assert.rejects(svc.sync(f.actor,account.id),errorCode("reconnect"));assert.equal((await svc.list(f.other)).length,0);
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

test("failed Meta verification preserves the pending account, consumes the login attempt and retains only safe diagnostics",async()=>{
  await withDiscoveryDatabase(async f=>{
    await providerAppService(f.database).save(f.actor,{provider:"instagram",revision:0,clientId:"10000",clientSecret:"synthetic-meta-secret",version:"v26.0",instagramLoginMode:"unified",configurationId:"20000"});
    const svc=accountService(f.database,async url=>String(url).includes("/oauth/access_token")?Response.json({access_token:"synthetic-private-token"}):Response.json({error:{code:190,message:"synthetic-private-token"}},{status:400}));
    const account=await svc.register(f.actor,{provider:"instagram",label:"Synthetic Instagram",identity:"intended_creator"});
    const state=new URL(await svc.begin(f.actor,account.id,"session-a")).searchParams.get("state")!;
    await assert.rejects(svc.complete(f.actor,"instagram",state,"session-a","synthetic-code"),(error:unknown)=>{
      assert.ok(error instanceof InstagramConnectionError);assert.equal(error.code,"instagram_token_inspection_failed");assert.equal(error.diagnostic.graphCode,190);assert.doesNotMatch(JSON.stringify(error),/synthetic-private-token/);return true;
    });
    const stored=(await f.database.select().from(senderAccounts).where(eq(senderAccounts.id,account.id)))[0];
    assert.equal(stored.status,"pending");assert.equal(stored.tokenCiphertext,null);assert.equal(stored.verifiedAt,null);
    await assert.rejects(svc.complete(f.actor,"instagram",state,"session-a","synthetic-code"),errorCode("oauth_expired"));
  });
});

test("a Meta-inspected IG grant can connect despite an empty assigned list, but a later revoked grant cannot reuse the stored account ID",async()=>{
  await withDiscoveryDatabase(async f=>{
    await providerAppService(f.database).save(f.actor,{provider:"instagram",revision:0,clientId:"10000",clientSecret:"synthetic-meta-secret",version:"v27.0",instagramLoginMode:"unified",configurationId:"20000"});
    let revoked=false;
    const svc=accountService(f.database,async url=>{
      const path=new URL(String(url)).pathname;
      if(path.endsWith("/oauth/access_token"))return Response.json({access_token:"synthetic-granted-token"});
      if(path.endsWith("/debug_token"))return Response.json({data:{app_id:"10000",type:"SYSTEM_USER",is_valid:true,expires_at:0,scopes:["instagram_basic"],granular_scopes:[{scope:"instagram_basic",target_ids:revoked?[]:["333"]}]}});
      if(path.endsWith("/assigned_instagram_accounts"))return Response.json({data:[]});
      assert.equal(path,"/v27.0/333");assert.equal(revoked,false);return Response.json({id:"333",username:"intended_creator",ig_id:"12345"});
    });
    const account=await svc.register(f.actor,{provider:"instagram",label:"Synthetic grant target",identity:"intended_creator"}),state=new URL(await svc.begin(f.actor,account.id,"session-a")).searchParams.get("state")!;
    await svc.complete(f.actor,"instagram",state,"session-a","synthetic-code");
    const stored=(await f.database.select().from(senderAccounts).where(eq(senderAccounts.id,account.id)))[0];assert.equal(stored.providerId,"333");assert.equal(stored.status,"connected");assert.doesNotMatch(stored.tokenCiphertext!,/synthetic-granted-token/);
    await svc.sync(f.actor,account.id);revoked=true;
    await assert.rejects(svc.sync(f.actor,account.id),errorCode("instagram_no_accounts"));assert.equal((await svc.list(f.actor))[0].status,"reconnect");
  });
});

test("saved Meta app checks enforce actual admin membership, tenant and revision without connecting an account or storing an app token",async()=>{
  await withDiscoveryDatabase(async f=>{
    let calls=0;
    const apps=providerAppService(f.database,async url=>{calls++;const u=new URL(String(url));if(u.pathname.endsWith("/oauth/access_token")){assert.equal(u.searchParams.get("client_secret"),"synthetic-meta-secret");return Response.json({access_token:"synthetic-private-app-token"});}assert.equal(u.pathname,"/v26.0/10000");return Response.json({id:"10000",business:{id:"90000",name:"Synthetic owner"}});});
    await apps.save(f.actor,{provider:"instagram",revision:0,clientId:"10000",clientSecret:"synthetic-meta-secret",version:"v26.0",instagramLoginMode:"unified",configurationId:"20000"});
    const account=await accountService(f.database).register(f.actor,{provider:"instagram",label:"Synthetic app check",identity:"intended_creator"});
    await assert.rejects(apps.checkInstagram({...f.reader,role:"admin"},{revision:1}),errorCode("forbidden"));
    await assert.rejects(apps.checkInstagram(f.other,{revision:0}),errorCode("not_configured"));
    await assert.rejects(apps.checkInstagram(f.actor,{revision:0}),errorCode("draft_changed"));
    await assert.rejects(apps.checkInstagram(f.actor,{revision:1,clientSecret:"client-controlled"}));assert.equal(calls,0);
    const result=await apps.checkInstagram(f.actor,{revision:1});assert.equal(result.credentialsVerified,true);assert.equal(calls,2);assert.equal(result.ownership.status,"confirmed");assert.doesNotMatch(JSON.stringify(result),/synthetic-private-app-token/);
    const stored=(await f.database.select().from(senderAccounts).where(eq(senderAccounts.id,account.id)))[0];assert.equal(stored.status,"pending");assert.equal(stored.tokenCiphertext,null);
    const saved=(await f.database.select().from(outreachProviderApps))[0];assert.equal(saved.revision,1);assert.doesNotMatch(saved.credentialsCiphertext,/synthetic-private-app-token/);
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

test("workspace app credentials are encrypted, admin-only, tenant scoped and pinned to OAuth and connected accounts",async()=>{
  await withDiscoveryDatabase(async f=>{
    const apps=providerAppService(f.database),input={provider:"google",revision:0,replace:true,clientId:"workspace-client.apps.googleusercontent.com",clientSecret:"workspace-secret",version:""};
    await assert.rejects(apps.save(f.reader,input),errorCode("forbidden"));
    await apps.save(f.actor,input);
    const stored=(await f.database.select().from(outreachProviderApps))[0];assert.ok(!stored.credentialsCiphertext.includes(input.clientSecret));
    const status=await apps.status(f.actor);assert.ok(!JSON.stringify(status).includes(input.clientSecret));assert.equal(status.find(p=>p.provider==="google")?.revision,1);
    assert.equal((await apps.status(f.other)).find(p=>p.provider==="google")?.revision,0);
    const service=accountService(f.database,mock),account=await service.register(f.actor,{provider:"google",label:"Sender",identity:"sender@example.invalid"});
    const first=new URL(await service.begin(f.actor,account.id,"session"));assert.equal(first.searchParams.get("client_id"),input.clientId);
    await service.complete(f.actor,"google",first.searchParams.get("state")!,"session","code");
    const pending=new URL(await service.begin(f.actor,account.id,"session"));
    await assert.rejects(apps.save(f.actor,{...input,revision:1,replace:false}),errorCode("replacement_required"));
    await apps.save(f.actor,{...input,revision:1,clientSecret:"rotated-secret"});
    await assert.rejects(apps.save(f.actor,{...input,revision:1}),errorCode("draft_changed"));
    await assert.rejects(service.complete(f.actor,"google",pending.searchParams.get("state")!,"session","code"),errorCode("oauth_expired"));
    assert.equal((await service.list(f.actor))[0].status,"reconnect");
    await assert.rejects(service.sync(f.actor,account.id),errorCode("reconnect"));
  });
});

test("four reusable templates, signature versions and archives stay within their organization",async()=>{
  await withDiscoveryDatabase(async f=>{
    const svc=templateService(f.database);
    await assert.rejects(svc.installDefaults(f.reader),errorCode("forbidden"));
    await Promise.all([svc.installDefaults(f.actor),svc.installDefaults(f.actor)]);
    const templates=await svc.list(f.actor);assert.equal(templates.length,4);assert.equal(new Set(templates.map(t=>t.layout)).size,4);assert.equal((await svc.list(f.other)).length,0);
    const template=templates[0],saved=await svc.save(f.actor,{...template,name:"Updated"});
    await assert.rejects(svc.save(f.actor,{...template,name:"Stale"}),errorCode("draft_changed"));
    await assert.rejects(svc.archive(f.other,saved.id,saved.revision,true),errorCode("draft_changed"));
    const archived=await svc.archive(f.actor,saved.id,saved.revision,true);assert.ok(archived.archivedAt);
    assert.equal((await svc.archive(f.actor,archived.id,archived.revision,false)).archivedAt,null);
    await svc.saveBranding(f.actor,{...defaultBranding,companyName:"Synthetic company",signature:"Synthetic signature"},0);
    await assert.rejects(svc.saveBranding(f.actor,defaultBranding,0),errorCode("draft_changed"));
    assert.equal((await svc.branding(f.other)).branding.companyName,"");
  });
});

test("drafts preserve their signature snapshot, block unresolved template fields and can safely copy known failures",async()=>{
  await withDiscoveryDatabase(async f=>{
    const {input}=await approvedFixture(f),branding={...defaultBranding,signature:"Original signature"};let sends=0;
    const svc=draftService(f.database,async url=>{if(String(url).includes("userinfo"))return Response.json({sub:"synthetic",email:"sender@example.invalid",email_verified:true});sends++;return new Response("",{status:400});});
    const draft=await svc.save(f.actor,{...input,branding,body:"Hi {{creator}}",template:"proposal",language:"한국어",purpose:"Specific purpose"});
    await assert.rejects(svc.send(f.actor,draft.id,draft.revision,true),errorCode("placeholders_remaining"));assert.equal(sends,0);
    await templateService(f.database).saveBranding(f.actor,{...branding,signature:"Changed signature"},0);
    assert.equal((await svc.get(f.actor,draft.id))?.branding.signature,"Original signature");
    const complete=await svc.save(f.actor,{...draft,body:"Personal message"});
    await assert.rejects(svc.send(f.actor,complete.id,complete.revision,true),errorCode("send_failed"));
    const copy=await svc.duplicate(f.actor,complete.id);assert.notEqual(copy.id,complete.id);assert.equal(copy.fromAddress,"");assert.equal(copy.senderAccountId,null);assert.equal(copy.status,"draft");assert.equal(copy.purpose,"Specific purpose");
    assert.equal((await svc.workspace(f.actor,{status:"failed"})).length,1);assert.equal((await svc.workspace(f.other)).length,0);
    await assert.rejects(f.database.update(outreachDrafts).set({branding:defaultBranding}).where(eq(outreachDrafts.id,complete.id)));
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { withDiscoveryDatabase } from "../discovery-fixture";
import { accountService } from "../../src/lib/outreach/accounts";
import { providerAppService } from "../../src/lib/outreach/provider-apps";
import { senderAccounts,senderOAuthStates } from "../../src/lib/db/outreach-schema";
import { OutreachError } from "../../src/lib/outreach/contracts";
import { unseal } from "../../src/lib/outreach/crypto";

process.env.OUTREACH_ENCRYPTION_KEY="a".repeat(64);
process.env.APP_ORIGIN="http://127.0.0.1:3000";
const app={provider:"instagram",revision:0,clientId:"10000",clientSecret:"synthetic-app-secret",version:"v27.0",instagramLoginMode:"unified",configurationId:"20000"};
const debug={app_id:"10000",type:"SYSTEM_USER",is_valid:true,expires_at:0,scopes:["instagram_basic"]};
const hasCode=(code:string)=>(error:unknown)=>error instanceof OutreachError&&error.code===code;

test("an administrator can connect an assigned first-party Instagram token, encrypted and tenant scoped; old OAuth requests become unusable",async()=>{
 await withDiscoveryDatabase(async f=>{
  await providerAppService(f.database).save(f.actor,app);
  const paths:string[]=[];
  const meta:typeof fetch=async(url,init)=>{
   const u=new URL(String(url));paths.push(u.pathname);assert.equal(u.origin,"https://graph.facebook.com");assert.equal(init?.redirect,"error");
   if(u.pathname.endsWith("/debug_token"))return Response.json({data:debug});
   assert.equal(u.pathname,"/v27.0/me/assigned_instagram_accounts");assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer synthetic-first-party-token");
   return Response.json({data:[{id:"333",username:"intended_creator"}]});
  };
  const svc=accountService(f.database,meta),account=await svc.register(f.actor,{provider:"instagram",label:"Synthetic company",identity:"intended_creator"});
  const oldRequest=new URL(await svc.begin(f.actor,account.id,"synthetic-session"));
  const result=await svc.connectInstagramSystemUser(f.actor,account.id,{accessToken:"synthetic-first-party-token",revision:1,updatedAt:account.updatedAt.toISOString(),confirmed:true});
  assert.equal(result,account.id);assert.ok(!paths.some(path=>path.endsWith("/oauth/access_token")));
  const [stored]=await f.database.select().from(senderAccounts).where(eq(senderAccounts.id,account.id));
  assert.equal(stored.status,"connected");assert.equal(stored.identity,"intended_creator");assert.equal(stored.providerId,"333");assert.equal(stored.expiresAt,null);
  assert.doesNotMatch(stored.tokenCiphertext!,/synthetic-first-party-token/);
  const decrypted=JSON.parse(unseal(stored.tokenCiphertext!,`${f.actor.organizationId}:${account.id}:sender-token`));
  assert.equal(decrypted.accessToken,"synthetic-first-party-token");assert.equal(decrypted.tokenKind,"meta_system_user");
  const publicRows=JSON.stringify(await svc.list(f.actor));assert.doesNotMatch(publicRows,/synthetic-first-party-token|tokenCiphertext|accessToken|synthetic-app-secret/);
  assert.deepEqual(await svc.list(f.other),[]);
  assert.ok((await f.database.select().from(senderOAuthStates))[0].consumedAt);
  await assert.rejects(svc.complete(f.actor,"instagram",oldRequest.searchParams.get("state")!,"synthetic-session","old-code"),hasCode("oauth_expired"));
  await svc.sync(f.actor,account.id);
  await svc.disconnect(f.actor,account.id);assert.equal((await f.database.select().from(senderAccounts))[0].tokenCiphertext,null);
 });
});

test("failed first-party token checks preserve an existing connection and never save the rejected token",async()=>{
 await withDiscoveryDatabase(async f=>{
  await providerAppService(f.database).save(f.actor,app);
  let inspected:unknown=debug,assigned:unknown={data:[{id:"333",username:"intended_creator"}]};
  const svc=accountService(f.database,async url=>Response.json(new URL(String(url)).pathname.endsWith("/debug_token")?{data:inspected}:assigned));
  const account=await svc.register(f.actor,{provider:"instagram",label:"Synthetic company",identity:"intended_creator"});
  await svc.connectInstagramSystemUser(f.actor,account.id,{accessToken:"synthetic-first-party-token",revision:1,updatedAt:account.updatedAt.toISOString(),confirmed:true});
  const [baseline]=await f.database.select().from(senderAccounts).where(eq(senderAccounts.id,account.id));
  for(const [nextDebug,nextAccounts,code] of [[{...debug,type:"USER"},{data:[]},"instagram_token_type"],[{...debug,app_id:"999"},{data:[]},"instagram_app_mismatch"],[{...debug,expires_at:1},{data:[]},"reconnect"],[{...debug,scopes:[]},{data:[]},"permission_missing"],[debug,{data:[]},"instagram_system_user_no_accounts"],[debug,{data:[{id:"444",username:"other_creator"}]},"instagram_system_user_account_mismatch"]] as const){
   inspected=nextDebug;assigned=nextAccounts;
   await assert.rejects(svc.connectInstagramSystemUser(f.actor,account.id,{accessToken:"synthetic-rejected-token",revision:1,updatedAt:baseline.updatedAt.toISOString(),confirmed:true}),hasCode(code));
   assert.deepEqual((await f.database.select().from(senderAccounts).where(eq(senderAccounts.id,account.id)))[0],baseline);
  }
 });
});

test("manual token connection enforces current administrator membership, provider, confirmation and optimistic versions before calling Meta",async()=>{
 await withDiscoveryDatabase(async f=>{
  await providerAppService(f.database).save(f.actor,app);
  let calls=0;
  const svc=accountService(f.database,async()=>{calls++;throw Error("Should not call Meta");});
  const account=await svc.register(f.actor,{provider:"instagram",label:"Synthetic company",identity:"intended_creator"});
  const input={accessToken:"synthetic-first-party-token",revision:1,updatedAt:account.updatedAt.toISOString(),confirmed:true};
  await assert.rejects(svc.connectInstagramSystemUser({...f.reader,role:"admin"},account.id,input),hasCode("forbidden"));
  await f.client.query("update organization_memberships set role='manager' where organization_id=$1 and user_id=$2",[f.reader.organizationId,f.reader.userId]);
  await assert.rejects(svc.connectInstagramSystemUser({...f.reader,role:"admin"},account.id,input),hasCode("forbidden"));
  await assert.rejects(svc.connectInstagramSystemUser(f.other,account.id,input),hasCode("not_found"));
  await assert.rejects(svc.connectInstagramSystemUser(f.actor,account.id,{...input,confirmed:false}));
  await assert.rejects(svc.connectInstagramSystemUser(f.actor,account.id,{...input,revision:2}),hasCode("connection_changed"));
  await assert.rejects(svc.connectInstagramSystemUser(f.actor,account.id,{...input,updatedAt:new Date(0).toISOString()}),hasCode("connection_changed"));
  const email=await svc.register(f.actor,{provider:"google",label:"Synthetic mail",identity:"sender@example.invalid"});
  await assert.rejects(svc.connectInstagramSystemUser(f.actor,email.id,{...input,updatedAt:email.updatedAt.toISOString()}),hasCode("not_found"));
  await providerAppService(f.database).save(f.actor,{...app,revision:1,replace:true,instagramLoginMode:"instagram"});
  await assert.rejects(svc.connectInstagramSystemUser(f.actor,account.id,{...input,revision:2}),hasCode("not_configured"));
  assert.equal(calls,0);assert.equal((await f.database.select().from(senderAccounts).where(eq(senderAccounts.id,account.id)))[0].tokenCiphertext,null);
 });
});

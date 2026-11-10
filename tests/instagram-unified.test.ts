import test from "node:test";
import assert from "node:assert/strict";
import { parseInstagramLoginUrl, providerAppInputSchema } from "../src/lib/outreach/app-contracts";
import { authorizationUrl, exchangeCode, fetchIdentity, providerConfig, refreshTokens } from "../src/lib/outreach/providers";
import { OutreachError, outreachErrorMessage } from "../src/lib/outreach/contracts";
import { InstagramConnectionError } from "../src/lib/outreach/instagram-errors";
import { providerJson, ProviderHttpError } from "../src/lib/outreach/provider-http";
import { checkUnifiedAppCredentials, verifyInstagramSystemUserToken } from "../src/lib/outreach/instagram-unified";
const uri = "https://example.invalid/api/outreach/oauth/instagram/callback";
const config = providerConfig("instagram", { APP_ORIGIN: "https://example.invalid", OUTREACH_ENCRYPTION_KEY: "a".repeat(64), OUTREACH_INSTAGRAM_CLIENT_ID: "10000", OUTREACH_INSTAGRAM_CLIENT_SECRET: "synthetic-secret", OUTREACH_INSTAGRAM_API_VERSION: "v25.0", OUTREACH_INSTAGRAM_LOGIN_MODE: "unified", OUTREACH_INSTAGRAM_CONFIGURATION_ID: "20000" });
const debug = { app_id: "10000", is_valid: true, type: "SYSTEM_USER", expires_at: 0, scopes: ["instagram_basic", "instagram_manage_messages"] };
test("first-party token verification makes no OAuth exchange and rejects wrong token kinds or unassigned assets",async()=>{
  for(const [data,accounts,code] of [[debug,{data:[{id:"333",username:"intended_creator"}]},null],[{...debug,type:"USER"},{data:[]},"instagram_token_type"],[{...debug,app_id:"999"},{data:[]},"instagram_app_mismatch"],[debug,{data:[]},"instagram_system_user_no_accounts"]] as const){
    const paths:string[]=[];
    const fetcher:typeof fetch=async(url,init)=>{const u=new URL(String(url));paths.push(u.pathname);assert.ok(!u.pathname.endsWith("/oauth/access_token"));if(u.pathname.endsWith("/debug_token")){assert.equal(u.searchParams.get("input_token"),"synthetic-first-party-token");return Response.json({data});}assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer synthetic-first-party-token");return Response.json(accounts);};
    if(code)await assert.rejects(verifyInstagramSystemUserToken("synthetic-first-party-token",config,"intended_creator",fetcher),(error:unknown)=>error instanceof InstagramConnectionError&&error.code===code);
    else {const result=await verifyInstagramSystemUserToken("synthetic-first-party-token",config,"intended_creator",fetcher);assert.equal(result.identity,"intended_creator");assert.equal(result.tokens.tokenKind,"meta_system_user");assert.equal(result.tokens.expiresAt,null);}
    assert.ok(paths.length>0);
  }
});
function mock(debugData: unknown = debug, accounts: unknown = { data: [{ id: "333", username: "intended_creator" }] }): typeof fetch {
  return async url => {
    const u = new URL(String(url)); assert.equal(u.hostname, "graph.facebook.com");
    if (u.pathname.endsWith("/oauth/access_token")) return Response.json({ access_token: "synthetic-system-token" });
    if (u.pathname.endsWith("/debug_token")) return Response.json({ data: debugData });
    assert.ok(u.pathname.endsWith("/me/assigned_instagram_accounts"));
    return Response.json(accounts);
  };
}
test("Unified URL imports IDs only; generated login uses fresh state and config, never legacy scopes", () => {
  const url = new URL("https://www.facebook.com/dialog/oauth"); url.search = new URLSearchParams({ client_id: "10000", config_id: "20000", redirect_uri: uri, response_type: "code", state: "<STATE>" }).toString();
  assert.deepEqual(parseInstagramLoginUrl(url.href, uri), { clientId: "10000", configurationId: "20000" });
  for (const invalid of [url.href.replace("www.facebook.com", "evil.invalid"), url.href + "&client_id=999", url.href + "&access_token=synthetic", url.href.replace(encodeURIComponent(uri), encodeURIComponent("https://other.invalid"))]) assert.throws(() => parseInstagramLoginUrl(invalid, uri));
  const generated = new URL(authorizationUrl("instagram", "fresh-session-nonce", "verifier", "intended_creator", false, config));
  assert.equal(generated.origin, "https://www.facebook.com"); assert.equal(generated.searchParams.get("config_id"), "20000"); assert.equal(generated.searchParams.get("state"), "fresh-session-nonce"); assert.equal(generated.searchParams.get("override_default_response_type"), "true"); assert.equal(generated.searchParams.has("scope"), false);
  assert.equal(providerAppInputSchema.safeParse({ provider: "instagram", revision: 0, clientId: "10000", clientSecret: "synthetic", version: "v25.0", instagramLoginMode: "unified" }).success, false);
});
test("Unified connection verifies app, token and paginated target; zero expiry is inspected, not inferred", async () => {
  const paths: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const u = new URL(String(url)); paths.push(u.pathname);
    if (!u.pathname.endsWith("assigned_instagram_accounts")) return mock()(url, init);
    assert.match(u.searchParams.get("appsecret_proof")!, /^[a-f0-9]{64}$/);
    if (!u.searchParams.has("after")) return Response.json({ data: [{ id: "111", username: "another_creator" }], paging: { cursors: { after: "second" }, next: "https://evil.invalid/never-follow" } });
    return Response.json({ data: [{ id: "333", username: "intended_creator" }] });
  };
  const account = await exchangeCode("instagram", "synthetic-code", "verifier", fetcher, config, "@intended_creator");
  assert.equal(account.id, "333"); assert.equal(account.tokens.expiresAt, null); assert.equal(account.tokens.tokenKind, "meta_system_user");
  assert.equal(paths.filter(p => p.endsWith("assigned_instagram_accounts")).length, 2);
  assert.equal(await refreshTokens("instagram", account.tokens, fetcher, config), account.tokens);
  assert.equal((await fetchIdentity("instagram", account.tokens, mock(), config)).id, "333");
  await assert.rejects(fetchIdentity("instagram", { ...account.tokens, instagramAccountId: "999" }, mock(), config), (e: unknown) => e instanceof OutreachError && e.code === "instagram_account_not_shared");
});
test("unverified lifetime, wrong app, expired token, missing grants and unshared targets never connect", async () => {
  for (const data of [{ ...debug, expires_at: undefined }, { ...debug, app_id: "999" }, { ...debug, is_valid: false }, { ...debug, type: "USER" }, { ...debug, expires_at: 1 }, { ...debug, data_access_expires_at: 1 }, { ...debug, scopes: [] }]) await assert.rejects(exchangeCode("instagram", "code", "v", mock(data), config, "intended_creator"));
  await assert.rejects(exchangeCode("instagram", "code", "v", mock(debug, { data: [] }), config, "intended_creator"), (e: unknown) => e instanceof OutreachError && e.code === "instagram_no_accounts");
  await assert.rejects(exchangeCode("instagram", "code", "v", mock(debug, { data: [{ id: "1", username: "other" }] }), config, "intended_creator"));
  await assert.rejects(exchangeCode("instagram", "code", "v", mock(debug, { data: [{ id: "333", username: "intended_creator" }], paging: { cursors: { after: "repeated" } } }), config, "intended_creator"));
});

test("an empty assigned list can resolve an explicitly inspected Instagram target through a verified IG profile on v27",async()=>{
  const paths:string[]=[];
  const fetcher:typeof fetch=async(url,init)=>{
    const u=new URL(String(url));paths.push(u.pathname);assert.equal(u.origin,"https://graph.facebook.com");assert.ok(u.pathname.startsWith("/v27.0/"));
    if(u.pathname.endsWith("/debug_token"))return Response.json({data:{...debug,granular_scopes:[{scope:"ads_management",target_ids:["999"]},{scope:"instagram_basic",target_ids:["333","333"]}]}});
    if(u.pathname.endsWith("/assigned_instagram_accounts"))return Response.json({data:[]});
    if(u.pathname.endsWith("/333")){assert.equal(u.searchParams.get("fields"),"id,username,ig_id");assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer synthetic-system-token");assert.match(u.searchParams.get("appsecret_proof")!,/^[a-f0-9]{64}$/);return Response.json({id:"333",username:"intended_creator",ig_id:"12345"});}
    return mock()(url,init);
  };
  const account=await exchangeCode("instagram","code","v",fetcher,{...config,version:"v27.0"},"@intended_creator");
  assert.equal(account.id,"333");assert.equal(account.identity,"intended_creator");assert.equal(account.tokens.instagramAccountId,"333");assert.equal(paths.filter(p=>p.endsWith("/333")).length,1);assert.ok(!paths.some(p=>p.endsWith("/999")));
  assert.ok(!("targets" in account.tokens));
});

test("a granted Instagram messaging target works without basic target IDs, while ungranted scopes and ad targets cannot authorize a sender",async()=>{
  for(const granted of [true,false]){
    let profileCalls=0;
    const fetcher:typeof fetch=async(url,init)=>{
      const path=new URL(String(url)).pathname;
      if(path.endsWith("/debug_token"))return Response.json({data:{...debug,scopes:granted?debug.scopes:["instagram_basic"],granular_scopes:[{scope:"instagram_basic"},{scope:"instagram_manage_messages",target_ids:["333","333"]},{scope:"ads_management",target_ids:["999"]}]}});
      if(path.endsWith("/333")){profileCalls++;return Response.json({id:"333",username:"intended_creator",ig_id:"12345"});}
      return mock(debug,{data:[]})(url,init);
    };
    if(granted){assert.equal((await exchangeCode("instagram","code","v",fetcher,config,"intended_creator")).id,"333");assert.equal(profileCalls,1);}
    else await assert.rejects(exchangeCode("instagram","code","v",fetcher,config,"intended_creator"),(error:unknown)=>{
      assert.ok(error instanceof InstagramConnectionError);assert.equal(error.code,"instagram_no_accounts");assert.equal(profileCalls,0);
      assert.deepEqual(error.diagnostic.instagramGrants?.basic,{granted:true,entryPresent:true,targetIdsPresent:false,targetCount:0});
      assert.deepEqual(error.diagnostic.instagramGrants?.messages,{granted:false,entryPresent:true,targetIdsPresent:true,targetCount:1});
      assert.doesNotMatch(JSON.stringify(error),/intended_creator|synthetic-system-token|333|999/);return true;
    });
  }
});

test("grant resolution cannot accept Facebook Pages, another account, mismatched IDs or denied profile access",async()=>{
  for(const profile of [Response.json({id:"333",username:"intended_creator"}),Response.json({id:"999",username:"intended_creator",ig_id:"12345"}),Response.json({id:"333",username:"another_creator",ig_id:"12345"}),Response.json({error:{code:200,message:"synthetic-private"}},{status:403})]){
    const fetcher:typeof fetch=async(url,init)=>{const path=new URL(String(url)).pathname;if(path.endsWith("/debug_token"))return Response.json({data:{...debug,granular_scopes:[{scope:"instagram_basic",target_ids:["333"]}]}});if(path.endsWith("/333"))return profile;return mock(debug,{data:[]})(url,init);};
    await assert.rejects(exchangeCode("instagram","code","v",fetcher,config,"intended_creator"));
  }
});

test("missing, malformed and unrelated grants never authorize guessed IDs, and excessive targets stop before profile requests",async()=>{
  for(const grants of [undefined,[],[{scope:"ads_management",target_ids:["333"]}],[{scope:"instagram_basic"}],[{scope:"instagram_basic",target_ids:["https://evil.invalid"]}]]){
    const fetcher:typeof fetch=async(url,init)=>{if(new URL(String(url)).pathname.endsWith("/debug_token"))return Response.json({data:{...debug,granular_scopes:grants}});return mock(debug,{data:[]})(url,init);};
    await assert.rejects(exchangeCode("instagram","code","v",fetcher,config,"intended_creator"),(error:unknown)=>{assert.ok(error instanceof InstagramConnectionError);assert.equal(error.code,"instagram_no_accounts");assert.equal(error.diagnostic.assignedAccountCount,0);assert.equal(error.diagnostic.grantedTargetCount,0);assert.doesNotMatch(JSON.stringify(error),/synthetic-system-token|intended_creator|evil/);return true;});
  }
  const fetcher:typeof fetch=async(url,init)=>new URL(String(url)).pathname.endsWith("/debug_token")?Response.json({data:{...debug,granular_scopes:[{scope:"instagram_basic",target_ids:Array.from({length:21},(_,i)=>String(i+1))}]}}):mock(debug,{data:[]})(url,init);
  await assert.rejects(exchangeCode("instagram","code","v",fetcher,config,"intended_creator"),(error:unknown)=>error instanceof OutreachError&&error.code==="instagram_accounts_incomplete");
});

test("Meta HTTP failures retain the exact failing stage without exposing provider payloads", async () => {
  for (const [suffix, stage] of [["/oauth/access_token", "code_exchange"], ["/debug_token", "token_inspection"], ["/me/assigned_instagram_accounts", "account_lookup"]] as const) {
    const fetcher: typeof fetch = async (url, init) => new URL(String(url)).pathname.endsWith(suffix)
      ? Response.json({ error: { code: 100, error_subcode: 123, message: "synthetic-private-token synthetic-code", error_data: { secret: "synthetic-secret" } } }, { status: 400 }) : mock()(url, init);
    await assert.rejects(exchangeCode("instagram", "synthetic-code", "v", fetcher, config, "intended_creator"), (error: unknown) => {
      assert.ok(error instanceof InstagramConnectionError);
      assert.equal(error.code, `instagram_${stage}_failed`);
      assert.deepEqual(error.diagnostic, { stage, reason: "http_error", httpStatus: 400, graphCode: 100, graphSubcode: 123 });
      assert.doesNotMatch(JSON.stringify(error), /synthetic-(private-token|code|secret)/);
      assert.doesNotMatch(outreachErrorMessage(error), /만료/);
      return true;
    });
  }
});

test("wrong Meta app and token kind are configuration errors, while invalid or expired tokens require reconnect", async () => {
  for (const [data, code, reason] of [
    [{ ...debug, app_id: "999" }, "instagram_app_mismatch", "app_mismatch"],
    [{ ...debug, type: "USER" }, "instagram_token_type", "token_type"],
    [{ ...debug, is_valid: false }, "reconnect", "token_invalid"],
    [{ ...debug, expires_at: 1 }, "reconnect", "token_expired"],
  ] as const) await assert.rejects(exchangeCode("instagram", "code", "v", mock(data), config, "intended_creator"), (error: unknown) => {
    assert.ok(error instanceof InstagramConnectionError); assert.equal(error.code, code); assert.equal(error.diagnostic.reason, reason); return true;
  });
});

test("malformed and oversized provider failures stay bounded, and non-Meta response semantics are preserved", async () => {
  for (const response of [new Response("synthetic-private-body", { status: 403 }), Response.json({ error: { code: "synthetic-secret", error_subcode: -1 } }, { status: 400 }), new Response("x".repeat(1048577), { status: 401 })]) {
    await assert.rejects(providerJson("https://example.invalid", {}, async () => response), (error: unknown) => {
      assert.ok(error instanceof ProviderHttpError); assert.equal(error.code, "reconnect"); assert.equal(error.providerCode, undefined); assert.equal(error.providerSubcode, undefined); assert.doesNotMatch(JSON.stringify(error), /synthetic/); return true;
    });
  }
  assert.deepEqual(await providerJson("https://example.invalid", {}, async () => Response.json({ error: { code: "ok" }, data: { user: {} } })), { error: { code: "ok" }, data: { user: {} } });
  await assert.rejects(exchangeCode("instagram", "code", "v", async () => { throw new Error("synthetic-secret"); }, config, "intended_creator"), (error: unknown) => error instanceof InstagramConnectionError && error.diagnostic.stage === "code_exchange" && error.diagnostic.reason === "unavailable");
});

test("Meta credential checks use the saved app only and never expose the issued app token", async () => {
  const result = await checkUnifiedAppCredentials(config, async (url, init) => {
    const u = new URL(String(url)); assert.equal(u.origin, "https://graph.facebook.com"); assert.equal(u.searchParams.has("code"), false); assert.equal(init?.redirect, "error");
    if(u.pathname.endsWith("/oauth/access_token")) {assert.equal(u.searchParams.get("grant_type"), "client_credentials"); assert.equal(u.searchParams.get("client_id"), "10000"); assert.equal(u.searchParams.get("client_secret"), "synthetic-secret");return Response.json({ access_token: "synthetic-private-app-token" });}
    assert.equal(u.pathname,"/v25.0/10000");assert.equal(u.searchParams.get("fields"),"id,business{id,name}");assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer synthetic-private-app-token");assert.match(u.searchParams.get("appsecret_proof")!,/^[a-f0-9]{64}$/);
    return Response.json({id:"10000",business:{id:"90000",name:"Synthetic owner"},access_token:"never-return-this"});
  });
  assert.deepEqual(result, { credentialsVerified: true, ownership:{status:"confirmed",business:{id:"90000",name:"Synthetic owner"}} });
  await assert.rejects(checkUnifiedAppCredentials(config, async () => Response.json({ error: { message: "Error validating client secret. synthetic-private-secret", code: 1 } }, { status: 400 })), (error: unknown) => {
    assert.ok(error instanceof InstagramConnectionError); assert.equal(error.code, "instagram_client_secret_invalid"); assert.equal(error.diagnostic.stage, "app_credentials"); assert.equal(error.diagnostic.metaReason, "invalid_client_secret"); assert.doesNotMatch(JSON.stringify(error), /synthetic-private/); return true;
  });
});

test("missing and inaccessible app owner metadata never prove an owner is absent or invalidate valid app credentials",async()=>{
  for(const [response,status] of [[Response.json({id:"10000"}),"not_returned"],[Response.json({id:"10000",business:null}),"not_returned"],[Response.json({error:{code:200,message:"synthetic-private"}},{status:403}),"unavailable"],[Response.json({id:"99999",business:{id:"90000",name:"Wrong app owner"}}),"unavailable"]] as const){
    const result=await checkUnifiedAppCredentials(config,async url=>new URL(String(url)).pathname.endsWith("/oauth/access_token")?Response.json({access_token:"synthetic-private-app-token"}):response);
    assert.deepEqual(result,{credentialsVerified:true,ownership:{status,business:null}});assert.doesNotMatch(JSON.stringify(result),/synthetic-private|Wrong app owner/);
  }
});

test("Meta message classification keeps only fixed labels and never guesses from error code 1 alone", async () => {
  for (const [message, expected] of [["Error validating client secret.", "instagram_client_secret_invalid"], ["Invalid App ID", "instagram_client_id_invalid"], ["Error validating verification code. Please make sure your redirect_uri is identical", "instagram_redirect_mismatch"], ["This authorization code has been used.", "oauth_expired"], ["Unknown synthetic-private-provider-response", "instagram_code_exchange_failed"]]) {
    await assert.rejects(exchangeCode("instagram", "synthetic-code", "v", async () => Response.json({ error: { message, code: 1 } }, { status: 400 }), config, "intended_creator"), (error: unknown) => {
      assert.ok(error instanceof InstagramConnectionError); assert.equal(error.code, expected); assert.doesNotMatch(JSON.stringify(error), /synthetic-private/); return true;
    });
  }
});

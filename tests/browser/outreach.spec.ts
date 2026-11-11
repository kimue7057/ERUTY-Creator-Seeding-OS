import "dotenv/config";
import { test,expect,type BrowserContext } from "@playwright/test";
import { createHash,randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { Pool,Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { initializeDiscoveryFixture } from "../discovery-fixture";
import { seedShortlistCandidate,goodShortlistEvaluation } from "../shortlist-samples";
import { shortlistService } from "../../src/lib/evaluation/shortlist";
import { accountService } from "../../src/lib/outreach/accounts";
import { providerAppService } from "../../src/lib/outreach/provider-apps";
import { automaticWorkerService } from "../../src/lib/discovery/automatic-worker";
import { browserWorkerAuth } from "../../src/lib/discovery/remote-auth";
import {outreachExtensionId} from "../../src/lib/outreach/executor-contracts";
import {outreachExecutorService} from '../../src/lib/outreach/executors';
import {chatPreviewService} from '../../src/lib/outreach/chat-previews';
import { senderAccounts } from "../../src/lib/db/outreach-schema";
import { sessions } from "../../src/lib/db/schema";
import * as schema from "../../src/lib/db/schema";
import { eq,inArray } from "drizzle-orm";
const pool=new Pool({connectionString:process.env.DATABASE_URL}),client=new Client({connectionString:process.env.DATABASE_URL}),database=drizzle(pool,{schema});
let f:Awaited<ReturnType<typeof initializeDiscoveryFixture>>,seed:Awaited<ReturnType<typeof seedShortlistCandidate>>;
const hashes:string[]=[];
const artifactDir=process.env.OUTREACH_SCREENSHOT_DIR??".local/qa/outreach";
test.beforeAll(async()=>{
  await client.connect();f=await initializeDiscoveryFixture(database,client);seed=await seedShortlistCandidate(f);
  const shortlist=shortlistService(database);await shortlist.enqueue(f.actor,seed.campaign.id,seed.accountId);
  const assignment=(await shortlist.next(f.actor,seed.worker)).assignment!;
  await shortlist.finish(f.actor,{...seed.worker,assessment_id:assignment.assessment_id,output:goodShortlistEvaluation(seed.ids[0]),error_code:null});
  await shortlist.review(f.actor,seed.campaign.id,{assessment_id:assignment.assessment_id,idempotency_key:crypto.randomUUID(),verdict:"approved",reason:"",acknowledged:true});
  for(const [label,identity] of [["SYNTHETIC 회사 A","sender-a@example.invalid"],["SYNTHETIC 회사 B","sender-b@example.invalid"]]){
    const account=await accountService(database).register(f.actor,{provider:"google",label,identity});
    // Synthetic verified rows exist only in this disposable browser-test DB.
    await database.update(senderAccounts).set({status:"connected",identity,providerId:identity,verifiedAt:new Date(),tokenCiphertext:"synthetic-unusable-token",addresses:[{address:identity,label:"Primary",primary:true},{address:`alias-${identity}`,label:"Approved alias",primary:false}]}).where(eq(senderAccounts.id,account.id));
  }
  await mkdir(artifactDir,{recursive:true});
});

test("first DM queues one approved browser task without inbound conversation and records the real worker API result",async({page,context})=>{
  const accounts=accountService(database);let account=(await accounts.list(f.actor)).find(a=>a.expectedIdentity==="synthetic_browser_company");if(!account)account=await accounts.register(f.actor,{provider:"instagram",label:"SYNTHETIC browser sender",identity:"synthetic_browser_company"});
  const worker={worker_id:crypto.randomUUID(),instance_id:crypto.randomUUID(),name:"SYNTHETIC contact executor",browser_surface:"iab" as const,platforms:["instagram" as const],ready:true,outreach_ready:true},lease={worker_id:worker.worker_id,instance_id:worker.instance_id};await automaticWorkerService(database).heartbeat(f.actor,worker);
  await signIn(context);await page.goto(`/outreach/instagram/new?account=${account.id}`);await expect(page.getByRole("heading",{name:"Instagram 첫 연락",exact:true})).toBeVisible();
  const send=page.getByRole("button",{name:"회사 Instagram으로 첫 DM 보내기",exact:true});await expect(send).toBeDisabled();await page.getByLabel("첫 DM 수신 아이디",{exact:true}).fill("@synthetic_first_contact");await page.getByLabel("첫 DM 본문",{exact:true}).fill("SYNTHETIC first contact proposal");await expect(send).toBeDisabled();await page.getByRole("checkbox",{name:/이 회사 계정으로 위 수신자에게/}).check();await expect(send).toBeEnabled();
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();}await page.screenshot({path:`${artifactDir}/instagram-first-contact.png`,fullPage:true});await send.click();await expect(page.getByText("브라우저 발송 요청을 저장했습니다. 아래에서 진행 상태를 확인하세요.",{exact:true})).toBeVisible();await expect(page.locator(".browser-outreach-receipt")).toHaveCount(1);
  const [operator]=await database.select().from(schema.users).where(eq(schema.users.id,f.actor.userId)),session=await browserWorkerAuth(database).login({email:operator.email,password:"synthetic-shortlist-contract-password"});
  const headers={"content-type":"application/json","x-eruty-outreach":"1",authorization:`Bearer ${session.token}`};
  const assignment=await context.request.post("/api/outreach/browser/next",{headers,data:lease});expect(assignment.status()).toBe(200);const grant=(await assignment.json()).assignment;expect(grant.job_id).toBeTruthy();
  const observation=()=>({sender:"synthetic_browser_company",recipient:"synthetic_first_contact",body:"SYNTHETIC first contact proposal",source_url:"https://www.instagram.com/synthetic_first_contact/",observed_at:new Date().toISOString(),visible_text:"SYNTHETIC rendered outgoing: SYNTHETIC first contact proposal"});
  const arm=await context.request.post("/api/outreach/browser/arm",{headers,data:{...grant,observation:observation()}});expect(arm.status()).toBe(200);expect((await arm.json()).send_permitted).toBe(true);
  const done=await context.request.post("/api/outreach/browser/finish",{headers,data:{...grant,outcome:"sent",reason:"confirmed_on_screen",observation:observation()}});expect(done.status()).toBe(200);
  await page.reload();await expect(page.locator(".browser-outreach-receipt")).toContainText("브라우저 전송 확인");await expect(page.locator(".browser-outreach-receipt")).toHaveCount(1);await page.screenshot({path:`${artifactDir}/instagram-first-contact-receipt.png`,fullPage:true});await browserWorkerAuth(database).logout(session.token);
  await automaticWorkerService(database).heartbeat(f.actor,{...worker,ready:false,outreach_ready:false});await page.reload();await page.getByLabel("첫 DM 수신 아이디",{exact:true}).fill("@synthetic_second");await page.getByLabel("첫 DM 본문",{exact:true}).fill("SYNTHETIC no worker");await page.getByRole("checkbox",{name:/이 회사 계정으로 위 수신자에게/}).check();await expect(send).toBeDisabled();
});
test.afterAll(async()=>{if(hashes.length)await database.delete(sessions).where(inArray(sessions.tokenHash,hashes));await client.end();await pool.end();});
async function signIn(context:BrowserContext,actor=f.actor){
  const token=randomBytes(32).toString("hex"),hash=createHash("sha256").update(token).digest("hex");hashes.push(hash);
  await database.insert(sessions).values({tokenHash:hash,userId:actor.userId,organizationId:actor.organizationId,expiresAt:new Date(Date.now()+600000)});
  await context.addCookies([{name:"eruty_session",value:token,domain:"127.0.0.1",path:"/",httpOnly:true,sameSite:"Lax"}]);
}

test('opened candidate proposal UI queues input only and displays a hash-verified pre-send result',async({page,context})=>{
 const account=await accountService(database).register(f.actor,{provider:'instagram',label:'SYNTHETIC draft preview',identity:'synthetic_draft_company'}),connections=outreachExecutorService(database),service=chatPreviewService(database),pair=await connections.startPair(f.actor,{accountId:account.id,name:'SYNTHETIC draft Chrome',confirmed:true}),credentials=await connections.pair({code:pair.code,extension_id:outreachExtensionId}),identity=await connections.authenticate(credentials.token);await connections.heartbeat(identity,{observed_username:'synthetic_draft_company',reason:'ready'});
 const id=crypto.randomUUID();await service.create(f.actor,{id,accountId:account.id,campaignId:seed.campaign.id,candidateIds:[seed.accountId],goal:1});const source=(await service.next(identity)).assignment!,target=source.targets[0];await service.finish(identity,{job_id:source.job_id,claim_token:source.claim_token,results:[{candidate_id:target.candidate_id,recipient:target.recipient,state:'opened',reason:'chat_opened',source_url:target.profile_url,observed_at:new Date().toISOString()}]});
 await signIn(context);await page.goto('/settings/browser-executor');const card=page.locator(`[data-preview-id="${id}"]`);await card.getByRole('button',{name:'제안문 작성 · 발송 전 준비',exact:true}).click();const form=card.locator('[data-compose-source]'),request=form.getByRole('button',{name:'본문 입력 후 멈추기 · 1명',exact:true});await expect(request).toBeDisabled();const body='SYNTHETIC personalized proposal\nNo transmission';await form.getByRole('textbox').fill(body);await expect(request).toBeEnabled();
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:1100});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();}await form.screenshot({path:`${artifactDir}/composer-preview-input-synthetic.png`});await request.click();await expect(page.getByRole('status').filter({hasText:'본문 입력만 요청했습니다'})).toBeVisible();
 const headers={origin:`chrome-extension://${outreachExtensionId}`,'content-type':'application/json','x-eruty-executor':'1',authorization:`Bearer ${credentials.token}`};const old=await context.request.post('/api/outreach/executor/preview-next',{headers,data:{protocol_version:2}});expect((await old.json()).assignment).toBeNull();const next=await context.request.post('/api/outreach/executor/preview-next',{headers,data:{protocol_version:4}});expect(next.status()).toBe(200);const grant=(await next.json()).assignment;expect(grant.mode).toBe('compose');expect(grant.messages[0].body).toBe(body);
 const done=await context.request.post('/api/outreach/executor/compose-finish',{headers,data:{job_id:grant.job_id,claim_token:grant.claim_token,results:[{candidate_id:target.candidate_id,recipient:target.recipient,state:'drafted',reason:'draft_ready',source_url:target.profile_url,observed_at:new Date().toISOString(),body_sha256:createHash('sha256').update(body).digest('hex'),rendered_body_sha256:createHash('sha256').update(body).digest('hex')}]}});expect(done.status()).toBe(200);await page.reload();const receipt=page.locator(`[data-preview-id="${grant.job_id}"]`);await expect(receipt).toContainText('발송 전 본문 준비 완료');await expect(receipt).toContainText('발송 0건');await receipt.getByText('준비한 문안',{exact:false}).click();await expect(receipt).toContainText(body);await receipt.screenshot({path:`${artifactDir}/composer-preview-result-synthetic.png`});
 expect((await client.query('select count(*)::int count from outreach_browser_sends where account_id=$1',[account.id])).rows[0].count).toBe(0);
});

test("company Chrome setup pairs through the server, returns one scoped send receipt and revokes access",async({page,context,playwright})=>{
  const account=await accountService(database).register(f.actor,{provider:"instagram",label:"SYNTHETIC dedicated extension",identity:"synthetic_extension_company"});
  const external=await playwright.request.newContext({baseURL:"http://127.0.0.1:3000"});const origin=`chrome-extension://${outreachExtensionId}`,baseHeaders={origin,"content-type":"application/json","x-eruty-executor":"1"};let token="";
  await page.exposeBinding("syntheticExtensionPair",async(_source,message:{code:string})=>{const response=await external.post("/api/outreach/executor/pair",{headers:baseHeaders,data:{code:message.code,extension_id:outreachExtensionId}});expect(response.status()).toBe(200);token=(await response.json()).token;return{ok:true};});
  await page.addInitScript(()=>{Object.defineProperty(window,"chrome",{value:{runtime:{sendMessage:(_id:string,message:unknown,callback:(value:unknown)=>void)=>{const binding=(window as unknown as {syntheticExtensionPair:(message:unknown)=>Promise<unknown>}).syntheticExtensionPair;void binding(message).then(callback);}}}});});
  await signIn(context);await page.goto("/settings/browser-executor");await page.getByLabel("실행기 발신 계정",{exact:true}).selectOption(account.id);const connect=page.getByRole("button",{name:"이 Chrome을 회사 발신 계정에 연결",exact:true});await expect(connect).toBeDisabled();await page.getByRole("checkbox",{name:/이 Chrome에 30일간/}).check();await connect.click();await expect(page.getByRole("status").filter({hasText:"Chrome 연결을 등록했습니다"})).toContainText("Chrome 연결을 등록했습니다");expect(token).toMatch(/^[a-f0-9]{64}$/);
  const headers={...baseHeaders,authorization:`Bearer ${token}`};const rejected=await external.post("/api/outreach/executor/next",{headers:{...headers,origin:"https://evil.invalid"},data:{}});expect(rejected.status()).toBe(403);
  const offline=await external.post("/api/outreach/executor/heartbeat",{headers,data:{observed_username:"synthetic_wrong",reason:"ready"}});expect((await offline.json()).ready).toBe(false);await external.post("/api/outreach/executor/heartbeat",{headers,data:{observed_username:"synthetic_extension_company",reason:"ready"}});
  for(const width of[390,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();}await page.screenshot({path:`${artifactDir}/chrome-executor-setup-synthetic.png`,fullPage:true});
  await page.goto(`/outreach/instagram/new?account=${account.id}`);await page.getByLabel("첫 DM 수신 아이디",{exact:true}).fill("synthetic_extension_recipient");await page.getByLabel("첫 DM 본문",{exact:true}).fill("SYNTHETIC dedicated executor test");await page.getByRole("checkbox",{name:/이 회사 계정으로 위 수신자에게/}).check();const send=page.getByRole("button",{name:"회사 Instagram으로 첫 DM 보내기",exact:true});await expect(send).toBeEnabled();await send.click();
  const next=await external.post("/api/outreach/executor/next",{headers,data:{}});expect(next.status()).toBe(200);const grant=(await next.json()).assignment;expect(grant).toBeTruthy();const input={job_id:grant.job_id,claim_token:grant.claim_token};
  const obs=()=>({sender:"synthetic_extension_company",recipient:"synthetic_extension_recipient",body:"SYNTHETIC dedicated executor test",source_url:"https://www.instagram.com/synthetic_extension_recipient/",observed_at:new Date().toISOString(),visible_text:"SYNTHETIC rendered outgoing: SYNTHETIC dedicated executor test"});const arm=await external.post("/api/outreach/executor/arm",{headers,data:{...input,observation:obs()}});expect(arm.status()).toBe(200);expect((await arm.json()).send_permitted).toBe(true);
  const done=await external.post("/api/outreach/executor/finish",{headers,data:{...input,outcome:"sent",reason:"confirmed_on_screen",observation:obs()}});expect(done.status()).toBe(200);await page.reload();await expect(page.locator('.browser-outreach-receipt')).toContainText("브라우저 전송 확인");
  const disconnected=await external.post("/api/outreach/executor/disconnect",{headers,data:{}});expect(disconnected.status()).toBe(200);const denied=await external.post("/api/outreach/executor/next",{headers,data:{}});expect(denied.status()).toBe(403);await external.dispose();
});

test("connection test previews the exact addresses, requires confirmation and displays the send receipt", async ({ page, context }) => {
  await signIn(context);
  const noOrigin = await context.request.post("/api/outreach/test-email", { data: {} }); expect(noOrigin.status()).toBe(403);
  const invalid = await context.request.post("/api/outreach/test-email", { headers: { Origin: "http://127.0.0.1:3000" }, data: { confirmed: false } }); expect(invalid.status()).toBe(422);
  let sends = 0;
  await page.route("**/api/outreach/test-email", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    const data = route.request().postDataJSON(); sends++;
    expect(data.confirmed).toBe(true); expect(data.fromAddress).toBe("alias-sender-a@example.invalid"); expect(data.toAddress).toBe("recipient@example.invalid");
    await route.fulfill({ json: { test: { ...data, status: "sent", errorCode: null, providerMessageId: "synthetic-receipt", createdAt: new Date().toISOString(), sentAt: new Date().toISOString() } } });
  });
  await page.goto("/settings/accounts");
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "SYNTHETIC 회사 A", exact: true }) });
  await card.getByRole("button", { name: "테스트 메일 보내기", exact: true }).click();
  const send = card.getByRole("button", { name: "테스트 메일 1통 발송", exact: true }); await expect(send).toBeDisabled();
  await card.getByLabel("테스트 수신 주소", { exact: true }).fill("recipient@example.invalid");
  const consent = card.getByRole("checkbox", { name: "위 발신·수신 주소와 내용을 확인하고 실제 발송합니다.", exact: true }); await consent.check();
  await card.getByLabel("테스트 발신 주소", { exact: true }).selectOption("alias-sender-a@example.invalid"); await expect(consent).not.toBeChecked(); await expect(send).toBeDisabled();
  await expect(card.getByText("[ERUTY] 이메일 연결 테스트", { exact: true })).toBeVisible();
  await consent.check(); await expect(send).toBeEnabled(); await send.click();
  await expect(card.getByText(/recipient@example.invalid으로 발송했습니다/)).toBeVisible(); expect(sends).toBe(1);
  await expect(card.getByRole("button", { name: "테스트 메일 1통 발송", exact: true })).toHaveCount(0);
  for (const width of [320, 390, 1440]) { await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy(); }
  await page.screenshot({ path: `${artifactDir}/connection-test.png`, fullPage: true });
});
test("Instagram Unified Login imports the generated URL and launches the configured consent flow",async({page,context})=>{
  await signIn(context,f.other);await page.goto("/settings/connections");await page.getByRole("button",{name:"Instagram · 등록 필요",exact:true}).click();
  await expect(page.getByLabel("Instagram 로그인 방식",{exact:true})).toHaveValue("unified");
  const uri="http://127.0.0.1:3000/api/outreach/oauth/instagram/callback",url=new URL("https://www.facebook.com/dialog/oauth");url.search=new URLSearchParams({client_id:"10000",config_id:"20000",redirect_uri:uri,response_type:"code",state:"<STATE>",prompt:"login"}).toString();
  await page.getByLabel("Meta 로그인 URL 가져오기",{exact:true}).fill(url.href);await page.getByRole("button",{name:"로그인 URL에서 가져오기",exact:true}).click();
  await expect(page.getByLabel("Client ID",{exact:true})).toHaveValue("10000");await expect(page.getByLabel("로그인 구성 ID",{exact:true})).toHaveValue("20000");await expect(page.getByLabel("Meta 로그인 URL 가져오기",{exact:true})).toHaveValue("");
  await page.getByLabel("Client secret",{exact:true}).fill("synthetic-meta-secret");await page.getByLabel("Meta 앱의 API 버전",{exact:true}).fill("v25.0");
  await page.getByRole("button",{name:"연결 정보 저장",exact:true}).click();await expect(page.getByRole("button",{name:"Instagram · 등록됨",exact:true})).toBeVisible();await expect(page.getByLabel("Client secret",{exact:true})).toHaveValue("");
  await expect(page.getByRole("button",{name:"저장된 앱 설정 점검",exact:true})).toBeEnabled();
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();}
  await page.screenshot({path:`${artifactDir}/instagram-unified.png`,fullPage:true});
  const account=await accountService(database).register(f.other,{provider:"instagram",label:"SYNTHETIC Unified Instagram",identity:"intended_creator"});
  await page.getByRole("link",{name:"발신 계정 로그인하기 →",exact:true}).click();
  const card=page.locator("article").filter({has:page.getByRole("heading",{name:"SYNTHETIC Unified Instagram",exact:true})});
  await page.route("https://www.facebook.com/**",route=>route.fulfill({contentType:"text/plain",body:"SYNTHETIC consent intercepted; no real login"}));
  await card.getByRole("button",{name:"로그인 연결",exact:true}).click();await expect(page).toHaveURL(/www.facebook.com\/dialog\/oauth/);
  const login=new URL(page.url());expect(login.searchParams.get("config_id")).toBe("20000");expect(login.searchParams.get("client_id")).toBe("10000");expect(login.searchParams.get("state")).not.toBe("<STATE>");expect(login.searchParams.has("scope")).toBe(false);
  expect((await database.select().from(senderAccounts).where(eq(senderAccounts.id,account.id)))[0].status).toBe("pending");
});
test("register multiple sender accounts and show setup dependency without pretending connected",async({page,context})=>{
  await signIn(context);await page.goto("/settings/accounts");await expect(page.getByRole("heading",{name:"발신 계정",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"계정 추가",exact:true}).click();await page.getByLabel("서비스",{exact:true}).selectOption("instagram");await page.getByLabel("구분 이름").fill("SYNTHETIC Instagram");await page.getByLabel("SNS 아이디").fill("synthetic_outreach");await page.getByRole("button",{name:"계정 등록",exact:true}).click();
  await expect(page.getByText("계정을 등록했습니다. 로그인 연결을 진행하세요.")).toBeVisible();
  const card=page.locator("article").filter({has:page.getByRole("heading",{name:"SYNTHETIC Instagram",exact:true})});
  await expect(card.getByText("로그인 연결 필요",{exact:true})).toBeVisible();await expect(card.getByRole("button",{name:"로그인 연결",exact:true})).toBeDisabled();
  await page.screenshot({path:`${artifactDir}/accounts.png`,fullPage:true});
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();}
});
test("selected creator opens four separate stages; sender switching clears stale aliases, previews match and drafts survive reload",async({page,context})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await signIn(context);
  await page.goto(`/campaigns/${seed.campaign.id}?tab=selected`);await page.getByRole("link",{name:"연락하기",exact:true}).click();
  await expect(page.getByRole("heading",{name:"크리에이터 분석",exact:true})).toBeVisible();await page.screenshot({path:`${artifactDir}/step1.png`,fullPage:true});
  await page.getByRole("button",{name:"다음 · 제안 문장",exact:true}).click();
  await page.getByLabel("이메일 제목",{exact:true}).fill("SYNTHETIC 공식 시딩 협업 제안");await page.getByLabel("본문",{exact:true}).fill("SYNTHETIC 예시입니다. 실제 발송하지 않습니다.\n관찰된 콘텐츠에 맞춘 협업을 제안합니다.");await page.screenshot({path:`${artifactDir}/step2.png`,fullPage:true});
  await page.getByRole("button",{name:"다음 · 템플릿·미리보기",exact:true}).click();await page.getByRole("button",{name:"브랜드 소개",exact:true}).click();
  await expect(page.frameLocator("iframe").getByText("SYNTHETIC 예시입니다.",{exact:false})).toBeVisible();await page.screenshot({path:`${artifactDir}/step3.png`,fullPage:true});
  await page.getByRole("button",{name:"다음 · 계정·주소·발송",exact:true}).click();
  const send=page.getByRole("button",{name:"이메일 보내기",exact:true});await expect(send).toBeDisabled();
  const a=await page.getByLabel("회사 계정",{exact:true}).locator("option").filter({hasText:"SYNTHETIC 회사 A"}).getAttribute("value");await page.getByLabel("회사 계정",{exact:true}).selectOption(a!);
  await page.getByLabel("발신 주소",{exact:true}).selectOption("alias-sender-a@example.invalid");
  const b=await page.getByLabel("회사 계정",{exact:true}).locator("option").filter({hasText:"SYNTHETIC 회사 B"}).getAttribute("value");await page.getByLabel("회사 계정",{exact:true}).selectOption(b!);await expect(page.getByLabel("발신 주소",{exact:true})).toHaveValue("sender-b@example.invalid");
  await page.getByLabel("수신 이메일 주소",{exact:true}).fill("creator@example.invalid");await page.getByLabel("연락처를 확인한 페이지",{exact:true}).fill("https://example.invalid/contact");
  await page.getByRole("checkbox").check();await expect(send).toBeEnabled();
  await page.getByLabel("발신 주소",{exact:true}).selectOption("alias-sender-b@example.invalid");await expect(page.getByRole("checkbox")).not.toBeChecked();await expect(send).toBeDisabled();
  await page.getByRole("button",{name:"초안 저장",exact:true}).click();await expect(page.getByText("초안을 저장했습니다. 다른 컴퓨터에서도 이어서 작성할 수 있습니다.")).toBeVisible();
  await page.screenshot({path:`${artifactDir}/step4.png`,fullPage:true});await page.reload();
  await page.getByRole("button",{name:/4.*계정·주소·발송/}).click();await expect(page.getByLabel("발신 주소",{exact:true})).toHaveValue("alias-sender-b@example.invalid");await expect(page.getByLabel("수신 이메일 주소",{exact:true})).toHaveValue("creator@example.invalid");
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();}
  await page.getByRole("button",{name:/1.*크리에이터 분석/}).click();await page.getByLabel("연락 채널").selectOption("tiktok");await page.getByRole("button",{name:/4.*계정·주소·발송/}).click();
  await expect(page.getByRole("button",{name:"TikTok 발송 연결 필요",exact:true})).toBeDisabled();await expect(page.getByText(/TikTok 실제 발송은 Business Messaging 승인과 별도 연결이 필요합니다/)).toBeVisible();
  await page.screenshot({path:`${artifactDir}/tiktok.png`,fullPage:true});expect(errors).toEqual([]);
});
test("reviewer can inspect account status but cannot add or connect senders",async({page,context})=>{
  await signIn(context,f.reader);await page.goto("/settings/accounts");await expect(page.getByRole("heading",{name:"발신 계정",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"계정 추가",exact:true})).toHaveCount(0);
});

test("templates and company signature save, restore and apply without losing text when designs change",async({page,context})=>{
  await signIn(context);await page.goto("/settings/templates");
  await page.getByRole("button",{name:"기본 템플릿 4개 설정",exact:true}).click();await expect(page.locator(".template-library-card")).toHaveCount(4);
  await page.getByRole("button",{name:"회사 서명·브랜드",exact:true}).click();
  await page.getByLabel("회사·브랜드 이름",{exact:true}).fill("SYNTHETIC Studio");await page.getByLabel("회사 서명",{exact:true}).fill("SYNTHETIC Studio\nPartnerships Team");
  await page.getByRole("button",{name:"회사 서명 저장",exact:true}).click();await expect(page.getByText("회사 서명을 저장했습니다.")).toBeVisible();
  await page.screenshot({path:`${artifactDir}/signature.png`,fullPage:true});
  await page.getByRole("button",{name:"메시지 템플릿",exact:true}).click();
  const card=page.locator(".template-library-card").filter({has:page.getByRole("heading",{name:"첫 협업 제안",exact:true})});
  await card.getByRole("button",{name:"편집·미리보기",exact:true}).click();await page.getByLabel("템플릿 이름",{exact:true}).fill("SYNTHETIC 첫 제안");await page.getByRole("button",{name:"템플릿 저장",exact:true}).click();await expect(page.getByText("템플릿을 저장했습니다.")).toBeVisible();
  await page.getByRole("button",{name:"닫기",exact:true}).click();await page.screenshot({path:`${artifactDir}/templates.png`,fullPage:true});
  await page.reload();await expect(page.getByRole("heading",{name:"SYNTHETIC 첫 제안",exact:true})).toBeVisible();
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();}
  await page.goto(`/campaigns/${seed.campaign.id}/outreach/${seed.accountId}?draft=new`);await page.getByRole("button",{name:"다음 · 제안 문장",exact:true}).click();
  await page.getByLabel("메시지 템플릿",{exact:true}).selectOption({label:"SYNTHETIC 첫 제안 · 한국어"});await expect(page.getByRole("button",{name:"이 문장으로 본문 적용",exact:true})).toBeDisabled();
  await page.getByLabel("이 크리에이터에게 제안하는 이유",{exact:true}).fill("SYNTHETIC 관찰 근거를 확인했습니다.");await page.getByRole("button",{name:"이 문장으로 본문 적용",exact:true}).click();
  const text=await page.getByLabel("본문",{exact:true}).inputValue();expect(text).toContain("SYNTHETIC Studio");expect(text).toContain("SYNTHETIC 관찰 근거");expect(text).not.toContain("{{");
  await page.getByRole("button",{name:"다음 · 템플릿·미리보기",exact:true}).click();
  for(const name of ["개인화 레터","브랜드 소개","공식 제안서","짧은 후속 연락"]){await page.getByRole("button",{name,exact:true}).click();await expect(page.frameLocator("iframe").getByText("SYNTHETIC 관찰 근거",{exact:false})).toBeVisible();await expect(page.frameLocator("iframe").getByText("Partnerships Team",{exact:false})).toBeVisible();}
  await page.getByRole("button",{name:/2.*제안 문장/}).click();await expect(page.getByLabel("본문",{exact:true})).toHaveValue(text);
  await page.getByRole("button",{name:"초안 저장",exact:true}).click();await expect(page.getByText("초안을 저장했습니다. 다른 컴퓨터에서도 이어서 작성할 수 있습니다.")).toBeVisible();
  await page.getByRole("link",{name:"초안·발송 기록 →",exact:true}).click();await expect(page.locator(".outreach-record").first()).toContainText("작성 중");await page.screenshot({path:`${artifactDir}/drafts.png`,fullPage:true});
});

test("admin imports web OAuth credentials and login uses the saved app; secrets are never redisplayed",async({page,context})=>{
  await signIn(context);await page.goto("/settings/connections");
  const uri="http://127.0.0.1:3000/api/outreach/oauth/google/callback";
  await expect(page.getByLabel("Google 인증 파일 가져오기",{exact:true})).toBeEnabled();
  await page.getByLabel("Google 인증 파일 가져오기",{exact:true}).setInputFiles({name:"synthetic-oauth.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify({web:{client_id:"synthetic-browser.apps.googleusercontent.com",client_secret:"synthetic-browser-secret",redirect_uris:[uri]}}))});
  await expect(page.getByLabel("Client ID",{exact:true})).toHaveValue("synthetic-browser.apps.googleusercontent.com");await page.getByRole("button",{name:"연결 정보 저장",exact:true}).click();
  await expect(page.getByRole("link",{name:"발신 계정 로그인하기 →",exact:true})).toBeVisible();await expect(page.getByLabel("Client secret",{exact:true})).toHaveValue("");
  await page.screenshot({path:`${artifactDir}/connections.png`,fullPage:true});
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();}
  await page.getByRole("link",{name:"발신 계정 로그인하기 →",exact:true}).click();
  const card=page.locator("article").filter({has:page.getByRole("heading",{name:"SYNTHETIC 회사 A",exact:true})});await expect(card.getByRole("button",{name:"로그인 연결",exact:true})).toBeEnabled();
  await page.route("https://accounts.google.com/**",route=>route.fulfill({contentType:"text/plain",body:"SYNTHETIC OAuth navigation intercepted; no external sign-in"}));
  await card.getByRole("button",{name:"로그인 연결",exact:true}).click();await expect(page).toHaveURL(/accounts.google.com/);const url=new URL(page.url());expect(url.searchParams.get("client_id")).toBe("synthetic-browser.apps.googleusercontent.com");expect(url.searchParams.get("redirect_uri")).toBe(uri);expect(url.searchParams.get("login_hint")).toBe("sender-a@example.invalid");
});

test("company system-user connection is admin-only and clears the secret even when the request cannot reach the server",async({page,context})=>{
  await providerAppService(database).save(f.actor,{provider:"instagram",revision:0,clientId:"10000",clientSecret:"synthetic-app-secret",version:"v27.0",instagramLoginMode:"unified",configurationId:"20000"});
  await accountService(database).register(f.actor,{provider:"instagram",label:"SYNTHETIC system user",identity:"synthetic_company"});
  await signIn(context);await page.goto("/settings/accounts");
  const card=page.locator("article").filter({has:page.getByRole("heading",{name:"SYNTHETIC system user",exact:true})});
  await card.getByText("회사 시스템 사용자 토큰으로 연결",{exact:true}).click();
  const token=card.getByLabel("Meta 시스템 사용자 토큰",{exact:true}),submit=card.getByRole("button",{name:"시스템 사용자 토큰 검증 후 연결",exact:true});
  await expect(token).toHaveAttribute("type","password");await expect(submit).toBeDisabled();
  await token.fill("synthetic-browser-first-party-token");await expect(submit).toBeDisabled();
  await card.getByRole("checkbox",{name:/회사가 관리하는 앱·자산의 토큰/}).check();await expect(submit).toBeEnabled();
  // Intercept before the server action: this smoke test never calls Meta.
  await page.route("**/settings/accounts",route=>route.request().method()==="POST"?route.fulfill({status:503,contentType:"text/plain",body:"Synthetic unavailable action"}):route.continue());
  await submit.click();await expect(token).toHaveValue("");
  await expect(card.getByText("ERUTY에 연결 요청을 전달하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도하세요.",{exact:true})).toBeVisible();
  await expect(card.locator(".badge")).toHaveText("로그인 연결 필요");
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();}
  await page.screenshot({path:`${artifactDir}/instagram-system-user.png`,fullPage:true});
  await signIn(context,f.reader);await page.goto("/settings/accounts");
  await expect(page.getByText("회사 시스템 사용자 토큰으로 연결",{exact:true})).toHaveCount(0);
});

test("system-user form identifies format and account mismatch errors, then submits real server-action fields without real Meta requests",async({page,context})=>{
  const app=providerAppService(database),status=(await app.status(f.actor)).find(s=>s.provider==="instagram")!;
  if(!status.configured)await app.save(f.actor,{provider:"instagram",revision:0,clientId:"10000",clientSecret:"synthetic-app-secret",version:"v27.0",instagramLoginMode:"unified",configurationId:"20000"});
  const service=accountService(database);let account=(await service.list(f.actor)).find(a=>a.provider==="instagram"&&a.expectedIdentity==="synthetic_company");
  if(!account)account=await service.register(f.actor,{provider:"instagram",label:"SYNTHETIC real action",identity:"synthetic_company"});
  await signIn(context);await page.goto("/settings/accounts");
  const card=page.locator("article").filter({has:page.getByText("@synthetic_company",{exact:true})});
  await card.getByText("회사 시스템 사용자 토큰으로 연결",{exact:true}).click();
  const token=card.getByLabel("Meta 시스템 사용자 토큰",{exact:true}),confirm=card.getByRole("checkbox",{name:/회사가 관리하는 앱·자산의 토큰/}),submit=card.getByRole("button",{name:"시스템 사용자 토큰 검증 후 연결",exact:true});
  await token.fill("synthetic browser token with spaces");await confirm.check();await submit.click();
  await expect(card.getByText("토큰 중간에 공백 또는 줄바꿈이 있습니다. Meta의 토큰 복사 기능으로 다시 복사해 붙여넣으세요.",{exact:true})).toBeVisible();await expect(token).toHaveValue("");
  await token.fill("synthetic-browser-meta-other");await confirm.check();await submit.click();
  await expect(card.getByRole("note",{name:"Meta에서 확인된 Instagram 계정"})).toContainText("@another_company");
  await expect(card.getByRole("link",{name:"@another_company ↗",exact:true})).toHaveAttribute("href","https://www.instagram.com/another_company/");
  await expect(card.locator(".badge")).toHaveText("로그인 연결 필요");await expect(token).toHaveValue("");
  await page.screenshot({path:`${artifactDir}/instagram-account-mismatch.png`,fullPage:true});
  await token.fill("synthetic-browser-meta-success");await confirm.check();await submit.click();
  await expect(card.locator(".badge")).toHaveText("계정 연결됨");
  await page.reload();await expect(card.locator(".badge")).toHaveText("계정 연결됨");
});

test("Instagram inbox loads real server actions with synthetic Meta, confirms exact accounts and persists one send receipt",async({page,context})=>{
  const apps=providerAppService(database);if(!(await apps.status(f.actor)).find(s=>s.provider==="instagram")?.configured)await apps.save(f.actor,{provider:"instagram",revision:0,clientId:"10000",clientSecret:"synthetic-app-secret",version:"v27.0",instagramLoginMode:"unified",configurationId:"20000"});
  const mock:typeof fetch=async url=>String(url).includes("/debug_token")?Response.json({data:{app_id:"10000",type:"SYSTEM_USER",is_valid:true,expires_at:0,scopes:["instagram_basic","instagram_manage_messages"]}}):Response.json({data:[{id:"333",username:"synthetic_company"}]});
  const svc=accountService(database,mock);let account=(await svc.list(f.actor)).find(a=>a.expectedIdentity==="synthetic_company");if(!account)account=await svc.register(f.actor,{provider:"instagram",label:"SYNTHETIC DM sender",identity:"synthetic_company"});
  const status=(await apps.status(f.actor)).find(s=>s.provider==="instagram")!;await svc.connectInstagramSystemUser(f.actor,account.id,{accessToken:"synthetic-browser-meta-success",revision:status.revision,updatedAt:account.updatedAt.toISOString(),confirmed:true});
  await signIn(context);await page.goto(`/outreach/instagram?account=${account.id}`);await expect(page.getByRole("heading",{name:"Instagram DM",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"대화 불러오기·새로고침",exact:true}).click();await expect(page.getByRole("button",{name:/@synthetic_recipient.*SYNTHETIC incoming/})).toBeVisible();
  await page.getByRole("button",{name:/@synthetic_recipient.*SYNTHETIC incoming/}).click();await expect(page.getByRole("heading",{name:"@synthetic_recipient",exact:true})).toBeVisible();await expect(page.getByText("SYNTHETIC incoming message",{exact:true}).last()).toBeVisible();
  const send=page.getByRole("button",{name:"Instagram DM 보내기",exact:true});await expect(send).toBeDisabled();await page.getByLabel("Instagram 답장",{exact:true}).fill("SYNTHETIC browser approved reply");await expect(send).toBeDisabled();await page.getByRole("checkbox",{name:/위 발신·수신 계정과 답장을 확인/}).check();await expect(send).toBeEnabled();
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();}
  await page.screenshot({path:`${artifactDir}/instagram-dm-confirm.png`,fullPage:true});await send.click();await expect(page.getByText("Meta가 DM 발송을 접수했습니다. 수신·읽음 여부는 Instagram에서 확인하세요.",{exact:true})).toBeVisible();await expect(page.locator(".instagram-receipts article")).toHaveCount(1);
  await page.reload();await page.getByRole("button",{name:"대화 불러오기·새로고침",exact:true}).click();await expect(page.locator(".instagram-receipts article")).toHaveCount(1);await expect(page.locator(".instagram-receipts article")).toContainText("SYNTHETIC browser approved reply");await page.screenshot({path:`${artifactDir}/instagram-dm-receipt.png`,fullPage:true});
  await signIn(context,f.reader);await page.goto("/outreach/instagram");await expect(page.getByRole("button",{name:"대화 불러오기·새로고침",exact:true})).toBeDisabled();
});

test("selected campaign creator can request a first browser DM without API consent or a prior conversation, then cancel before send",async({page,context})=>{
  const accounts=accountService(database);let account=(await accounts.list(f.actor)).find(a=>a.expectedIdentity==="synthetic_campaign_sender");if(!account)account=await accounts.register(f.actor,{provider:"instagram",label:"SYNTHETIC campaign browser",identity:"synthetic_campaign_sender"});
  const worker={worker_id:crypto.randomUUID(),instance_id:crypto.randomUUID(),name:"SYNTHETIC campaign contact",browser_surface:"iab" as const,platforms:["instagram" as const],ready:true,outreach_ready:true};await automaticWorkerService(database).heartbeat(f.actor,worker);
  await signIn(context);await page.goto(`/campaigns/${seed.campaign.id}/outreach/${seed.accountId}?draft=new`);await page.getByLabel("연락 채널",{exact:true}).selectOption("instagram");await page.getByRole("button",{name:"다음 · 제안 문장",exact:true}).click();await page.getByLabel("메시지",{exact:true}).fill("SYNTHETIC selected creator first proposal");await page.getByRole("button",{name:/4.*계정·주소·발송/}).click();
  await expect(page.getByLabel("Instagram 발송 방식",{exact:true})).toHaveValue("browser");await page.getByLabel("회사 계정",{exact:true}).selectOption(account.id);await expect(page.getByLabel("발신 Instagram 아이디",{exact:true})).toHaveValue("@synthetic_campaign_sender");const send=page.getByRole("button",{name:"회사 계정으로 첫 DM 보내기",exact:true});await expect(send).toBeDisabled();await page.getByRole("checkbox",{name:/발신 계정·수신 주소·메시지를 확인/}).check();await expect(send).toBeEnabled();await send.click();await expect(page.getByText("브라우저 발송 요청을 저장했습니다. 진행 상태에서 실제 결과를 확인하세요.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"전송 전 요청 취소",exact:true})).toBeVisible({timeout:20000});await page.getByRole("button",{name:"전송 전 요청 취소",exact:true}).click();await expect(page.locator(".browser-outreach-receipt")).toContainText("요청 취소");await page.screenshot({path:`${artifactDir}/instagram-campaign-browser-request.png`,fullPage:true});
  await automaticWorkerService(database).heartbeat(f.actor,{...worker,ready:false,outreach_ready:false});
});

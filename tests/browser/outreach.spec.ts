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
test.afterAll(async()=>{if(hashes.length)await database.delete(sessions).where(inArray(sessions.tokenHash,hashes));await client.end();await pool.end();});
async function signIn(context:BrowserContext,actor=f.actor){
  const token=randomBytes(32).toString("hex"),hash=createHash("sha256").update(token).digest("hex");hashes.push(hash);
  await database.insert(sessions).values({tokenHash:hash,userId:actor.userId,organizationId:actor.organizationId,expiresAt:new Date(Date.now()+600000)});
  await context.addCookies([{name:"eruty_session",value:token,domain:"127.0.0.1",path:"/",httpOnly:true,sameSite:"Lax"}]);
}

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
  await expect(page.getByRole("button",{name:"SNS 발송 연결 필요",exact:true})).toBeDisabled();await expect(page.getByText(/현재 버전에서는 SNS 실제 발송이 활성화되지 않았습니다/)).toBeVisible();
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

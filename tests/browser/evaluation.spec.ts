import "dotenv/config";
import {test,expect,type BrowserContext} from "@playwright/test";
import {createHash,randomBytes} from "node:crypto";
import {Client,Pool} from "pg";import {drizzle} from "drizzle-orm/node-postgres";import {inArray} from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";import {initializeDiscoveryFixture} from "../discovery-fixture";
import {localDiscoveryActor,prepareSample,logSample,observationSample} from "../discovery-samples";import {sampleEvaluation} from "../evaluation-samples";
import {discoveryService} from "../../src/lib/discovery/service";
const client=new Client({connectionString:process.env.DATABASE_URL}),pool=new Pool({connectionString:process.env.DATABASE_URL,max:4}),database=drizzle(pool,{schema});
let fixture:Awaited<ReturnType<typeof initializeDiscoveryFixture>>,campaignId:string,accountId:string,evidenceId:string;const hashes:string[]=[];
test.beforeAll(async()=>{
 if(process.env.E2E_ALLOW_WRITES!=="true"||process.env.EVALUATION_ENABLED!=="true"||!["127.0.0.1","localhost"].includes(new URL(process.env.DATABASE_URL!).hostname))throw new Error("Explicit isolated evaluation browser fixture required");
 await client.connect();fixture=await initializeDiscoveryFixture(database,client);const campaign=await fixture.campaign();campaignId=campaign.id;
 const who=localDiscoveryActor(fixture.actor),svc=discoveryService(database),run=await svc.prepare(who,prepareSample(campaignId)),log=await svc.appendLog(who,logSample(run.run_id)),saved=await svc.record(who,observationSample(run.run_id,run.context_sha256,log.log_id));accountId=saved.creator_account_id;evidenceId=saved.evidence_ids[0];
});
test.afterAll(async()=>{if(hashes.length)await database.delete(schema.sessions).where(inArray(schema.sessions.tokenHash,hashes));await client.end();await pool.end();});
async function signIn(context:BrowserContext,actor:typeof fixture.actor){const token=randomBytes(32).toString("hex"),hash=createHash("sha256").update(token).digest("hex");hashes.push(hash);await database.insert(schema.sessions).values({tokenHash:hash,userId:actor.userId,organizationId:actor.organizationId,expiresAt:new Date(Date.now()+600000)});await context.addCookies([{name:"eruty_session",value:token,domain:"127.0.0.1",path:"/",httpOnly:true,sameSite:"Lax"}]);}
test("evaluation JSON import, pending approval guard, hold history and mobile layout persist using synthetic evidence",async({page,context})=>{
 await signIn(context,fixture.actor);await page.goto("/evaluations");await expect(page.getByRole("heading",{name:"검토함"})).toBeVisible();await page.goto(`/evaluations/${campaignId}/${accountId}`);
 await expect(page.getByText("SNS 근거 검토 대기입니다.",{exact:false})).toBeVisible();await expect(page.getByRole("option",{name:/AI 자동 평가/})).toHaveAttribute("disabled", "");
 await page.getByLabel("평가 JSON",{exact:true}).fill(JSON.stringify(sampleEvaluation(evidenceId)));await page.getByLabel("평가 도구·모델").fill("SYNTHETIC browser fixture");await page.getByRole("button",{name:"평가 저장",exact:true}).click();await expect(page.getByRole("status")).toContainText("평가를 저장했습니다");await page.reload();
 await expect(page.getByRole("heading",{name:/확인 가능한 항목 합계 39점/})).toBeVisible();await page.getByText("이 평가 검토하기",{exact:true}).click();await expect(page.getByRole("option",{name:/^승인/})).toHaveAttribute("disabled", "");
 const review=page.getByRole("form",{name:"크리에이터 평가 검토"});await review.getByLabel("판정",{exact:true}).selectOption("hold");await expect(review.getByLabel("검토 메모 · 선택")).toHaveValue("");await review.getByRole("button",{name:"검토 저장",exact:true}).click();await expect(review.getByRole("status")).toContainText("검토 이력을 저장했습니다");await page.reload();await expect(page.getByText("검토 메모 없음")).toBeVisible();
 await expect(page.getByRole("button",{name:"평가 저장",exact:true})).toBeEnabled();await page.screenshot({path:"test-results/evaluation-desktop.png",fullPage:true});await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await page.screenshot({path:"test-results/evaluation-mobile.png",fullPage:true});
});
test("reviewers stay read-only and a foreign organization cannot access evaluation context",async({browser})=>{
 const context=await browser.newContext(),page=await context.newPage();await signIn(context,fixture.reader);await page.goto(`/evaluations/${campaignId}/${accountId}`);await expect(page.getByRole("form",{name:"크리에이터 평가 저장"})).toHaveCount(0);await expect(page.getByRole("form",{name:"크리에이터 평가 검토"})).toHaveCount(0);
 await signIn(context,fixture.other);await page.goto(`/evaluations/${campaignId}/${accountId}`);await expect(page.getByRole("heading",{name:"항목을 찾을 수 없습니다"})).toBeVisible();await context.close();
});

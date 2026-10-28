import "dotenv/config";
import { test, expect, type BrowserContext } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { inArray } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import { initializeDiscoveryFixture } from "../discovery-fixture";
import { seedShortlistCandidate, goodShortlistEvaluation } from "../shortlist-samples";
import { sampleEvaluation } from "../evaluation-samples";
import { shortlistService } from "../../src/lib/evaluation/shortlist";
const client = new Client({ connectionString: process.env.DATABASE_URL }), pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 }), database = drizzle(pool, { schema });
let fixture: Awaited<ReturnType<typeof initializeDiscoveryFixture>>, campaignId: string;
const hashes: string[] = [];
test.beforeAll(async () => {
  if (process.env.E2E_ALLOW_WRITES !== "true" || process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED !== "true" || !["127.0.0.1", "localhost"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Explicit isolated automatic shortlist fixture required");
  await client.connect(); fixture = await initializeDiscoveryFixture(database, client);
  const first = await seedShortlistCandidate(fixture); campaignId = first.campaign.id;
  const second = await seedShortlistCandidate({ ...fixture, campaign: async () => first.campaign });
  const svc = shortlistService(database); await svc.enqueueCampaign(fixture.actor, campaignId);
  for (let i = 0; i < 2; i++) {
    const assignment = (await svc.next(fixture.actor, second.worker)).assignment!;
    const account = assignment.snapshot.creator_account_id === first.accountId ? first : second;
    const output = account === first ? goodShortlistEvaluation(account.ids[0]) : sampleEvaluation(account.ids[0]);
    output.summary = account === first ? "SYNTHETIC recommended creator; no real SNS assessment" : "SYNTHETIC insufficient evidence; no real SNS assessment";
    await svc.finish(fixture.actor, { ...second.worker, assessment_id: assignment.assessment_id, output, error_code: null });
  }
});
test.afterAll(async () => { if (hashes.length) await database.delete(schema.sessions).where(inArray(schema.sessions.tokenHash, hashes)); await client.end(); await pool.end(); });
async function signIn(context: BrowserContext, actor: typeof fixture.actor) {
  const token = randomBytes(32).toString("hex"), hash = createHash("sha256").update(token).digest("hex"); hashes.push(hash);
  await database.insert(schema.sessions).values({ tokenHash: hash, userId: actor.userId, organizationId: actor.organizationId, expiresAt: new Date(Date.now() + 600000) });
  await context.addCookies([{ name: "eruty_session", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
}
test("one campaign workspace requests discovery, filters recommendations and persists final human approval on desktop and mobile", async ({ page, context }) => {
  await signIn(context, fixture.actor); await page.goto(`/campaigns/${campaignId}`);
  await expect(page.getByRole("heading", { name: "발굴 · 자동 평가 · 최종 승인" })).toBeVisible();
  await expect(page.getByRole("button", { name: "승인 대기 · 1", exact: true })).toBeVisible();
  await expect(page.getByText("SYNTHETIC recommended creator; no real SNS assessment")).toBeVisible();
  await expect(page.getByText("SYNTHETIC insufficient evidence; no real SNS assessment")).toHaveCount(0);
  await page.getByRole("button", { name: "추가 확인 · 1", exact: true }).click();
  await expect(page.getByText("SYNTHETIC insufficient evidence; no real SNS assessment")).toBeVisible();
  await expect(page.getByRole("button", { name: "최종 승인", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "승인 대기 · 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "최종 승인", exact: true })).toBeDisabled();
  await page.getByText("점수 근거·미확인 사항 보기", { exact: true }).click();
  await expect(page.getByText("시청자 국가 분포는 별도 확인되지 않았습니다.", { exact: false })).toBeVisible();
  await page.screenshot({ path: "test-results/shortlist-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/shortlist-mobile.png", fullPage: true });
  await page.getByRole("checkbox", { name: "평가와 SNS 원본 근거, 미확인 사항을 확인했습니다." }).check();
  await page.getByRole("button", { name: "최종 승인", exact: true }).click();
  await expect(page.getByText("최종 승인했습니다. 승인 명단에 반영됩니다.")).toBeVisible();
  await page.waitForTimeout(6500); // One real polling interval must preserve feedback and the displayed card.
  await expect(page.getByText("최종 승인했습니다. 승인 명단에 반영됩니다.")).toBeVisible();
  await page.reload(); await page.getByRole("button", { name: "승인됨 · 1", exact: true }).click();
  await expect(page.getByText("사용자 최종 승인 완료")).toBeVisible();
  await page.getByLabel("이번 탐색 인원").fill("2");
  await page.getByRole("button", { name: "발굴·추천 시작", exact: true }).click();
  await expect(page.getByText("요청을 접수했습니다.", { exact: false })).toBeVisible();
  const queued = await client.query("select requested_count from discovery_browser_requests where organization_id=$1 and campaign_id=$2 and state='queued'", [fixture.actor.organizationId, campaignId]);
  expect(queued.rows.map(r => r.requested_count)).toEqual([2]);
});
test("shortlist is read only for reviewers and inaccessible across organizations", async ({ browser }) => {
  const context = await browser.newContext(), page = await context.newPage();
  await signIn(context, fixture.reader); await page.goto(`/campaigns/${campaignId}`);
  await expect(page.getByRole("button", { name: "승인됨 · 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "발굴·추천 시작", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "최종 승인", exact: true })).toHaveCount(0);
  await signIn(context, fixture.other); const response = await page.request.get(`/api/campaigns/shortlist?campaign_id=${campaignId}`); expect(response.status()).toBe(404);
  await context.close();
});

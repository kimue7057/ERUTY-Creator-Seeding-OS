import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { pool, db } from "../../src/lib/db";
import { campaigns, campaignProducts, campaignBriefRevisions, projectAssets } from "../../src/lib/db/schema";
import { saveProject, saveProduct, archiveProduct, listProjects } from "../../src/lib/projects/service";
import { saveCampaign, getCampaign, listCampaigns } from "../../src/lib/campaigns/service";
import { withWorkspace } from "./fixture";
import type { CampaignInput } from "../../src/lib/validation/campaigns";
after(() => pool.end());
const brand = { name: "TEST 리플러츠 (synthetic)", website: "", summary: "Original synthetic brief", usp: "Test USP", brandStyle: "Test style", referenceUrls: [] };
function targeting(projectId: string, productId: string): CampaignInput {
  return { projectId, title: "TEST JP TikTok", productIds: [productId], countryCodes: ["JP"], platforms: ["tiktok"], categories: ["lifestyle"], followerMin: 10000, followerMax: 50000, goalCount: 73, notes: "synthetic-only", exclusions: "", budget: null, currency: "KRW", startsOn: null, endsOn: null, status: "draft" };
}
test("campaigns preserve independent targeting, filters and role/organization isolation", async () => {
  await withWorkspace(async (actor, other) => {
    const project = await saveProject(actor, brand);
    const product = await saveProduct(actor, project.id, { name: "TEST product", features: "synthetic", url: "" });
    const a = targeting(project.id, product.id);
    const first = await saveCampaign(actor, a);
    const b: CampaignInput = { ...a, title: "TEST US Instagram", countryCodes: ["US", "CA"], platforms: ["instagram", "youtube"], followerMin: 50000, followerMax: 200000, goalCount: 300, status: "ready" };
    const second = await saveCampaign(actor, b);
    assert.equal((await listProjects(actor))[0].campaignCount, 2);
    assert.equal((await listProjects(actor))[0].productCount, 1);
    await saveCampaign(actor, { ...a, goalCount: 99 }, first.id);
    assert.deepEqual((await getCampaign(actor, second.id))?.countryCodes, ["US", "CA"]);
    assert.deepEqual((await getCampaign(actor, second.id))?.platforms, ["instagram", "youtube"]);
    assert.equal((await getCampaign(actor, first.id))?.followerMax, 50000);
    assert.equal((await getCampaign(actor, second.id))?.goalCount, 300);
    assert.equal((await listCampaigns(actor, { platform: "tiktok", status: "draft", projectId: project.id })).length, 1);
    assert.equal((await listCampaigns(other)).length, 0);
    assert.equal(await getCampaign(other, first.id), null);
    await assert.rejects(() => saveCampaign(other, a, first.id));
    await assert.rejects(() => saveCampaign({ ...actor, role: "reviewer" }, a));
    await assert.rejects(() => saveCampaign(actor, { ...a, followerMax: 1 }, first.id));
    assert.equal((await getCampaign(actor, first.id))?.goalCount, 99);
  });
});
test("cross-project products/assets are rejected by service and PostgreSQL foreign keys", async () => {
  await withWorkspace(async (actor, other) => {
    const a = await saveProject(actor, brand);
    const b = await saveProject(actor, { ...brand, name: "TEST 베베도르 (synthetic)" });
    const p = await saveProduct(actor, a.id, { name: "TEST product A", features: "", url: "" });
    const q = await saveProduct(actor, b.id, { name: "TEST product B", features: "", url: "" });
    await assert.rejects(() => saveCampaign(actor, targeting(a.id, q.id)));
    const c = await saveCampaign(actor, targeting(a.id, p.id));
    await assert.rejects(() => saveCampaign(actor, { ...targeting(a.id, p.id), projectId: b.id }, c.id));
    await assert.rejects(() => db.insert(campaignProducts).values({ organizationId: actor.organizationId, projectId: a.id, campaignId: c.id, productId: q.id }));
    await assert.rejects(() => db.insert(projectAssets).values({ organizationId: other.organizationId, projectId: a.id, name: "synthetic.pdf", kind: "pdf", objectPath: "test-only/not-uploaded", provenance: { source: "synthetic_test", verificationStatus: "unverified" }, createdBy: other.userId, updatedBy: other.userId }));
    assert.deepEqual((await getCampaign(actor, c.id))?.productIds, [p.id]);
  });
});
test("brief revisions remain immutable, append on product changes and preserve scoped asset references", async () => {
  await withWorkspace(async actor => {
    const project = await saveProject(actor, brand);
    const p = await saveProduct(actor, project.id, { name: "Original product", features: "Original features", url: "" });
    const q = await saveProduct(actor, project.id, { name: "Second product", features: "Other features", url: "" });
    for (const [name, productId] of [["Brand metadata", null], ["Selected product metadata", p.id], ["Unselected product metadata", q.id]] as const) {
      await db.insert(projectAssets).values({ organizationId: actor.organizationId, projectId: project.id, productId, name, kind: "pdf", objectPath: "synthetic-test/no-real-file", version: 1, provenance: { source: "synthetic_test", verificationStatus: "unverified" }, createdBy: actor.userId, updatedBy: actor.userId });
    }
    const input = targeting(project.id, p.id);
    const campaign = await saveCampaign(actor, input);
    await saveProject(actor, { ...brand, summary: "Changed brand" }, project.id);
    await saveProduct(actor, project.id, { name: "Changed product", features: "Changed features", url: "" }, p.id);
    await archiveProduct(actor, project.id, p.id);
    await saveCampaign(actor, { ...input, goalCount: 500 }, campaign.id);
    const unchanged = await getCampaign(actor, campaign.id);
    assert.equal(unchanged?.briefVersion, 1);
    assert.equal(unchanged?.briefSnapshot.project.summary, brand.summary);
    assert.equal(unchanged?.briefSnapshot.products[0].features, "Original features");
    assert.equal(unchanged?.briefSnapshot.assets.length, 2);
    const v2 = await saveCampaign(actor, { ...input, productIds: [q.id] }, campaign.id);
    assert.equal(v2.briefVersion, 2);
    const current = await getCampaign(actor, campaign.id);
    assert.equal(current?.briefs.length, 2);
    assert.equal(current?.briefs[0].snapshot.project.summary, "Changed brand");
    assert.equal(current?.briefs[1].snapshot.project.summary, brand.summary);
    assert.equal(current?.briefSnapshot.project.summary, brand.summary);
    await assert.rejects(() => db.update(campaigns).set({ briefSnapshot: { ...campaign.briefSnapshot, capturedAt: "altered" } }).where(eq(campaigns.id, campaign.id)));
    await assert.rejects(() => db.update(campaignBriefRevisions).set({ updatedAt: new Date() }).where(eq(campaignBriefRevisions.campaignId, campaign.id)));
    await assert.rejects(() => db.update(campaigns).set({ briefVersion: 99 }).where(eq(campaigns.id, campaign.id)));
    await assert.rejects(() => saveCampaign(actor, input, campaign.id)); // newly choosing an archived product is not permitted
    assert.equal((await getCampaign(actor, campaign.id))?.briefVersion, 2);
  });
});

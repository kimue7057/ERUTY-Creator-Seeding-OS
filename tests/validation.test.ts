import { test } from "node:test";
import assert from "node:assert/strict";
import { projectSchema, productSchema } from "../src/lib/validation/projects";
import { campaignSchema } from "../src/lib/validation/campaigns";
const project = { name: "Synthetic brand", website: "https://example.invalid", summary: "", usp: "", brandStyle: "", referenceUrls: [] };
test("project URLs reject javascript/data protocols and blank names", () => {
  assert.equal(projectSchema.safeParse(project).success, true);
  assert.equal(projectSchema.safeParse({ ...project, name: "  " }).success, false);
  assert.equal(projectSchema.safeParse({ ...project, website: "javascript:alert(1)" }).success, false);
  assert.equal(projectSchema.safeParse({ ...project, referenceUrls: ["data:text/html,test"] }).success, false);
  assert.equal(productSchema.safeParse({ name: "test", features: "", url: "ftp://example.invalid" }).success, false);
});
const campaign = { projectId: "00000000-0000-4000-8000-000000000001", title: "Synthetic campaign", productIds: ["00000000-0000-4000-8000-000000000002"], countryCodes: ["JP", "US"], platforms: ["tiktok", "instagram"], categories: ["lifestyle"], followerMin: 10000, followerMax: 100000, goalCount: 73, notes: "", exclusions: "", budget: null, currency: "KRW", startsOn: null, endsOn: null, status: "draft" };
test("campaign accepts multiple countries/platforms and custom goal; rejects invalid targeting", () => {
  assert.equal(campaignSchema.safeParse(campaign).success, true);
  for (const invalid of [
    { countryCodes: [] }, { platforms: [] }, { platforms: ["google"] }, { countryCodes: ["ZZ"] },
    { followerMax: 9999 }, { followerMin: -1 }, { followerMax: 1.5 }, { goalCount: 0 }, { productIds: [] },
    { budget: -1 }, { startsOn: "2026-02-30" }, { startsOn: "2026-10-31", endsOn: "2026-10-01" },
  ]) assert.equal(campaignSchema.safeParse({ ...campaign, ...invalid }).success, false, JSON.stringify(invalid));
});

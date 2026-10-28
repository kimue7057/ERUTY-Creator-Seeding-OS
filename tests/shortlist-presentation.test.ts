import { test } from "node:test";
import assert from "node:assert/strict";
import { candidateGroup, shortlistCounts, campaignHref } from "../src/lib/evaluation/presentation";

test("processing, interruptions and obsolete results never appear as actionable human recommendations", () => {
  const results = ["queued", "running", "failed", "cancelled", "stale", "unassessed"].map(state => ({ state, recommendation: "recommended" as const, verdict: "approved" as const }));
  assert.deepEqual(results.map(candidateGroup), ["processing", "processing", "interrupted", "interrupted", "unassessed", "unassessed"]);
  const counts = shortlistCounts(results);
  assert.equal(counts.recommended, 0); assert.equal(counts.selected, 0); assert.equal(counts.needs_info, 0);
  assert.equal(counts.processing + counts.interrupted + counts.unassessed, counts.discovered);
});
test("current automatic outcomes and human decisions form disjoint task counts", () => {
  const c = (recommendation: "recommended" | "needs_info" | "excluded", verdict: "approved" | "hold" | "rejected" | null = null) => ({ state: "completed", recommendation, verdict });
  const counts = shortlistCounts([c("recommended"), c("needs_info"), c("excluded"), c("recommended", "hold"), c("recommended", "approved"), c("recommended", "rejected")]);
  assert.deepEqual(counts, { discovered: 6, evaluated: 6, recommended: 1, selected: 1, hold: 1, needs_info: 1, excluded: 2, processing: 0, interrupted: 0, unassessed: 0 });
  assert.equal(campaignHref("campaign", "recommended", "creator"), "/campaigns/campaign?tab=recommended&candidate=creator");
});

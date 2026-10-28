import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assessmentFingerprint, campaignConstraintMismatch, shortlistRecommendation } from "../src/lib/evaluation/shortlist-policy";
import { sampleEvaluation } from "./evaluation-samples";
test("shortlist preserves unknown scores and requires supported high scores and source eligibility", () => {
  const output = sampleEvaluation(randomUUID()); output.confidence = 0.85; output.criteria.product_fit.score = 25;
  assert.equal(shortlistRecommendation(output, 70, 1, true), "recommended");
  assert.equal(shortlistRecommendation(output, 70, 1, false), "needs_info");
  assert.equal(shortlistRecommendation(output, 30, 1, true), "needs_info");
  assert.equal(shortlistRecommendation(output, 30, 0, true), "excluded");
  output.confidence = 0.5; assert.equal(shortlistRecommendation(output, 90, 0, true), "needs_info");
});
test("review changes preserve the assessment; targeting, identity and new evidence invalidate it", () => {
  const snapshot = { campaign_id: randomUUID(), creator_account_id: randomUUID(), brief_version: 1, brief: { project: "SYNTHETIC" }, targeting: { country_codes: ["JP"] }, creator: { platform: "youtube", handle: "synthetic", verification_state: "verification_pending" }, evidence: [{ id: randomUUID(), payload_sha256: "a".repeat(64), review: "unreviewed" }] };
  const fingerprint = assessmentFingerprint(snapshot);
  assert.equal(assessmentFingerprint({ ...snapshot, creator: { ...snapshot.creator, verification_state: "direct_sns_verified" }, evidence: snapshot.evidence.map(e => ({ ...e, review: "accepted", browser_execution_review_ids: [randomUUID()] })) }), fingerprint);
  assert.notEqual(assessmentFingerprint({ ...snapshot, targeting: { country_codes: ["SG"] } }), fingerprint);
  assert.notEqual(assessmentFingerprint({ ...snapshot, creator: { ...snapshot.creator, handle: "changed" } }), fingerprint);
  assert.notEqual(assessmentFingerprint({ ...snapshot, evidence: [...snapshot.evidence, { id: randomUUID(), payload_sha256: "b".repeat(64), review: "unreviewed" }] }), fingerprint);
});
test("explicit campaign mismatches are excluded while rounded metrics remain uncertain", () => {
  const snapshot = { creator: { platform: "youtube" }, targeting: { platforms: ["youtube"], country_codes: ["SG"], follower_min: 1000, follower_max: 100000 }, evidence: [{ kind: "profile_observation", observed_at: new Date().toISOString(), facts: { country: { code: null }, metrics: [{ name: "subscribers", value: 999, precision: "rounded" }] } }] };
  assert.equal(campaignConstraintMismatch(snapshot), null);
  snapshot.evidence[0].facts.metrics[0].precision = "exact"; assert.equal(campaignConstraintMismatch(snapshot), "followers_outside_campaign");
});

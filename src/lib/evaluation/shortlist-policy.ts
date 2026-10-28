import { discoveryHash } from "../discovery/contracts";
import type { EvaluationOutput } from "./contracts";

// Reviews are decisions about facts, not new observations. A human review must
// not invalidate the score it approves; changed facts/briefs must invalidate it.
export function assessmentFingerprint(snapshot: Record<string, unknown>) {
  const creator = snapshot.creator as Record<string, unknown>;
  const evidence = snapshot.evidence as Record<string, unknown>[];
  return discoveryHash({
    campaign_id: snapshot.campaign_id, creator_account_id: snapshot.creator_account_id,
    brief_version: snapshot.brief_version, brief: snapshot.brief, targeting: snapshot.targeting,
    creator: { platform: creator.platform, handle: creator.handle, display_name: creator.display_name, profile_url: creator.profile_url },
    evidence: evidence.map(e => ({ id: e.id, kind: e.kind, source_url: e.source_url, observed_at: e.observed_at, published_at: e.published_at,
      payload_sha256: e.payload_sha256, original_sha256: (e.source_material as { sha256?: string } | null)?.sha256 ?? null, method: e.method, execution_source: e.execution_source })).sort((a,b) => String(a.id).localeCompare(String(b.id))),
  });
}
export function automaticAssessmentSnapshot(snapshot: Record<string, unknown>) {
  const omit = (value: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
  return { ...snapshot, assessment_stage: "before_final_human_review", creator: omit(snapshot.creator as Record<string, unknown>, ["verification_state"]),
    evidence: (snapshot.evidence as Record<string, unknown>[]).map(e => omit(e, ["review", "browser_execution_reviewed", "browser_execution_review_ids"])) };
}
export const SHORTLIST_POLICY = { minimum_known_score: 70, minimum_confidence: 0.6, minimum_product_fit: 18 } as const;
export function campaignConstraintMismatch(snapshot: Record<string, unknown>) {
  const creator = snapshot.creator as { platform: string };
  const target = snapshot.targeting as { platforms: string[]; country_codes: string[]; follower_min: number; follower_max: number };
  const evidence = snapshot.evidence as { kind: string; observed_at: string; facts: { country?: { code: string | null }; metrics?: { name: string; value: number | null; precision: string }[] } }[];
  const profile = evidence.filter(e => e.kind === "profile_observation").sort((a,b) => b.observed_at.localeCompare(a.observed_at))[0];
  if (!target.platforms.includes(creator.platform)) return "platform_outside_campaign";
  if (profile?.facts.country?.code && !target.country_codes.includes(profile.facts.country.code)) return "creator_country_outside_campaign";
  const follower = profile?.facts.metrics?.find(m => m.name === (creator.platform === "youtube" ? "subscribers" : "followers"));
  if (follower?.precision === "exact" && follower.value !== null && (follower.value < target.follower_min || follower.value > target.follower_max)) return "followers_outside_campaign";
  return null;
}
export function shortlistRecommendation(output: EvaluationOutput, knownSubtotal: number, unknownCount: number, sourceEligible: boolean) {
  if (!sourceEligible) return "needs_info" as const;
  if (knownSubtotal >= SHORTLIST_POLICY.minimum_known_score && output.confidence >= SHORTLIST_POLICY.minimum_confidence &&
      (output.criteria.product_fit.score ?? -1) >= SHORTLIST_POLICY.minimum_product_fit) return "recommended" as const;
  // Missing evidence is never a zero score or sufficient reason for rejection.
  return unknownCount === 0 && output.confidence >= 0.6 && knownSubtotal < 50 ? "excluded" as const : "needs_info" as const;
}

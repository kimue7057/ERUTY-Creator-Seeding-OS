import { randomUUID } from "node:crypto";
import type { ActorScope } from "../src/lib/auth/permissions";
import type { DiscoveryActor } from "../src/lib/discovery/service";
export const localDiscoveryActor = (actor: ActorScope): DiscoveryActor => ({ ...actor, principalId: actor.userId, executionSource: "codex_test", environmentSha256: "e".repeat(64) });
export const prepareSample = (campaignId: string) => ({ contract_version: 1, campaign_id: campaignId, platform: "instagram", requested_count: 1, execution_source: "codex_test", idempotency_key: randomUUID() });
export const logSample = (runId: string) => ({ contract_version: 1, run_id: runId, idempotency_key: randomUUID(), event_type: "native_search", outcome: "success", occurred_at: new Date().toISOString(), source_url: "https://www.instagram.com/", query: "SYNTHETIC TEST ONLY", failure_code: null, message: "Fixture, not an actual SNS visit" });
export function observationSample(runId: string, hash: string, logId: string, suffix = "a") {
  const now = new Date().toISOString(), profile = `https://www.instagram.com/eruty_synthetic_${suffix}/`, content = `https://www.instagram.com/p/Synthetic_${suffix}/`;
  return { contract_version: 1, run_id: runId, idempotency_key: randomUUID(), expected_context_sha256: hash, search_log_id: logId,
    identity: { platform: "instagram", profile_url: profile, handle: `eruty_synthetic_${suffix}`, platform_account_id: null as string | null, display_name: "SYNTHETIC fixture — not a real creator" },
    profile: { opened_directly: true, observed_at: now, metrics: [{ name: "followers", raw_display: "12,345", value: 12345 as number | null, precision: "exact", observed_at: now, source_url: profile }], match_notes: "Synthetic test observation only", limitations: ["SYNTHETIC — no Work/SNS verification"], country: { code: "JP" as string | null, basis: "Synthetic fixture" }, categories: ["synthetic"] },
    contents: [{ url: content, opened_directly: true, observed_at: now, published_at: now, recent_basis: "Synthetic recency fixture", metrics: [{ name: "views", raw_display: "100", value: 100, precision: "exact", observed_at: now, source_url: content }], note: "Synthetic content only" }], work_trace_reference: null as string | null };
}

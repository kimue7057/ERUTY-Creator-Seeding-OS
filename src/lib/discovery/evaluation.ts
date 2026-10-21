import type { ActorScope } from "../auth/permissions";
import { discoveryQueries } from "./queries";
// Read-only STEP 4 input boundary. No scoring, outreach approval or email action.
export async function getDiscoveryEvaluationInput(actor: ActorScope, campaignId: string, accountId: string, offset = 0) {
  const detail = await discoveryQueries().creator(actor, campaignId, accountId, offset);
  if (!detail) return null;
  return { contract_version: 1, campaign_id: campaignId, creator_account_id: accountId,
    ready_for_step4: detail.link.discoveryState === "direct_sns_verified", verification_state: detail.link.discoveryState,
    evidence: detail.evidence.map(({ evidence, source, briefVersion }) => ({ evidence_id: evidence.id, run_id: evidence.runId, brief_version: briefVersion, payload_sha256: evidence.payloadSha256, source_url: evidence.sourceUrl, observed_at: evidence.observedAt.toISOString(), execution_source: source })),
    next_evidence_offset: detail.nextOffset,
  };
}

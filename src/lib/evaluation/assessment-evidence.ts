import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { discoveryEvidence, discoveryLogs, discoveryRuns } from "../db/discovery-schema";
import { browserCaptureBatches, browserDiscoveryRequests, browserRunReviews } from "../db/browser-schema";
import type { ActorScope } from "../auth/permissions";
import type { EvaluationContext } from "./service";
import { profileIdentity, contentUrl, searchSourceUrl } from "../discovery/urls";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export function hasAdverseEvidence(snapshot: EvaluationContext["snapshot"]) { return snapshot.evidence.some(e => ["rejected", "needs_review"].includes(e.review)); }

// Verify the per-candidate original capture, never silently accept an entire run
// on a human's behalf. Old/manual/synthetic observations cannot pass this gate.
export async function assessmentSourceEligible(tx: Tx, actor: ActorScope, current: EvaluationContext) {
  if (hasAdverseEvidence(current.snapshot)) return false;
  if (current.snapshot.evidence.some(e => e.execution_source !== "codex_browser" || e.method !== "sns_browser")) return false;
  const rows = await tx.select({ e: discoveryEvidence, run: discoveryRuns, log: discoveryLogs }).from(discoveryEvidence)
    .innerJoin(discoveryRuns, and(eq(discoveryRuns.id, discoveryEvidence.runId), eq(discoveryRuns.organizationId, actor.organizationId)))
    .innerJoin(discoveryLogs, and(eq(discoveryLogs.id, discoveryEvidence.searchLogId), eq(discoveryLogs.organizationId, actor.organizationId)))
    .where(and(eq(discoveryEvidence.organizationId, actor.organizationId), eq(discoveryEvidence.campaignId, current.campaign.id), eq(discoveryEvidence.creatorAccountId, current.link.creatorAccountId))).orderBy(desc(discoveryEvidence.observedAt), desc(discoveryEvidence.id));
  const profile = rows.find(r => r.e.kind === "profile_observation");
  if (!profile || profile.run.executionSource !== "codex_browser" || !profile.run.submittedAt || profile.run.status === "cancelled" ||
    profile.e.observationMethod !== "sns_browser" || !profile.e.facts.opened_directly || profile.log.eventType !== "native_search" || profile.log.outcome !== "success") return false;
  const content = rows.find(r => r.e.kind === "content_observation" && r.e.runId === profile.e.runId && r.e.payloadSha256 === profile.e.payloadSha256 && r.e.browserTraceReference === profile.e.browserTraceReference && r.e.facts.opened_directly && r.e.facts.recent_basis);
  if (!content) return false;
  const captureId = profile.e.browserTraceReference?.match(/^\/api\/discovery\/browser\/captures\/([a-f0-9-]{36})$/)?.[1];
  if (!captureId) return false;
  const [original] = await tx.select({ capture: browserCaptureBatches, request: browserDiscoveryRequests }).from(browserCaptureBatches)
    .innerJoin(browserDiscoveryRequests, and(eq(browserDiscoveryRequests.id, browserCaptureBatches.requestId), eq(browserDiscoveryRequests.organizationId, actor.organizationId)))
    .where(and(eq(browserCaptureBatches.id, captureId), eq(browserCaptureBatches.organizationId, actor.organizationId), eq(browserCaptureBatches.runId, profile.e.runId)));
  if (!original || original.request.state === "cancelled") return false;
  const negative = await tx.select().from(browserRunReviews).where(and(eq(browserRunReviews.organizationId, actor.organizationId), eq(browserRunReviews.runId, profile.e.runId))).orderBy(desc(browserRunReviews.createdAt), desc(browserRunReviews.id)).limit(1);
  if (negative[0] && negative[0].verdict !== "accepted") return false;
  const originals = original.capture.originals;
  if (!originals.length || originals.some(o => createHash("sha256").update(o.content, "utf8").digest("hex") !== o.sha256)) return false;
  try {
    // Collection stores canonical URLs; originals deliberately retain the exact
    // browser address, including handle casing and '+' search encoding.
    const urls = originals.map(o => {
      const url = JSON.parse(o.content).source_url;
      return { kind: o.kind, url: o.kind === "profile_open" ? profileIdentity(profile.e.platform, url).url : o.kind === "content_open" ? contentUrl(profile.e.platform, url) : searchSourceUrl(profile.e.platform, url) };
    });
    return urls.some(o => o.kind === "profile_open" && o.url === profile.e.sourceUrl) && urls.some(o => o.kind === "content_open" && o.url === content.e.sourceUrl) && urls.some(o => o.kind === "native_search" && o.url === profile.log.sourceUrl);
  } catch { return false; }
}


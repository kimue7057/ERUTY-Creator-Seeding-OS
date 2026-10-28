import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { db } from "../db";
import { browserCaptureBatches } from "../db/browser-schema";
import type { discoveryEvidence } from "../db/discovery-schema";
import { contentUrl, profileIdentity } from "../discovery/urls";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type AssessmentOriginal = { sha256: string; source_url: string; observed_at: string; visible_text: string; truncated: boolean };
export async function assessmentOriginals(tx: Tx, organizationId: string, evidence: (typeof discoveryEvidence.$inferSelect)[]) {
  const ids = [...new Set(evidence.map(e => e.browserTraceReference?.match(/^\/api\/discovery\/browser\/captures\/([a-f0-9-]{36})$/)?.[1]).filter((id): id is string => !!id))];
  const captures = ids.length ? await tx.select().from(browserCaptureBatches).where(and(eq(browserCaptureBatches.organizationId, organizationId), inArray(browserCaptureBatches.id, ids))) : [];
  const result = new Map<string, AssessmentOriginal>();
  const budget = Math.min(16000, Math.floor(40000 / Math.max(1, evidence.length)));
  for (const e of evidence) {
    const capture = captures.find(c => c.runId === e.runId && e.browserTraceReference === `/api/discovery/browser/captures/${c.id}`);
    if (!capture) continue;
    const kind = e.kind === "profile_observation" ? "profile_open" : e.kind === "content_observation" ? "content_open" : null;
    for (const original of capture.originals.filter(o => o.kind === kind)) {
      if (createHash("sha256").update(original.content, "utf8").digest("hex") !== original.sha256) continue;
      try {
        const raw = JSON.parse(original.content);
        const url = kind === "profile_open" ? profileIdentity(e.platform, raw.source_url).url : contentUrl(e.platform, raw.source_url);
        if (url !== e.sourceUrl || typeof raw.visible_text !== "string" || Date.parse(raw.observed_at) !== e.observedAt.getTime()) continue;
        result.set(e.id, { sha256: original.sha256, source_url: raw.source_url, observed_at: raw.observed_at, visible_text: raw.visible_text.slice(0, budget), truncated: raw.visible_text.length > budget });
      } catch { /* An invalid source is never substituted with generated text. */ }
    }
  }
  return result;
}

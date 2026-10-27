import { createHash } from "node:crypto";
import { z } from "zod";
import { appendLogInput, observationInput, observedTime } from "./contracts";

export const browserBatch = z.strictObject({
  prepare_key: z.uuid(), logs: z.array(z.record(z.string(), z.unknown())).min(1).max(10),
  observation: z.record(z.string(), z.unknown()).optional(),
});
export const originalCapture = z.strictObject({
  kind: z.enum(["native_search", "profile_open", "content_open"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), content: z.string().min(1).max(150000),
});
export const remoteCollection = z.strictObject({ batch: browserBatch, captures: z.array(originalCapture).max(10) });
export const submissionManifest = z.strictObject({
  prepare_key: z.uuid(), submit_key: z.uuid(), expected_lock_version: z.number().int().nonnegative(),
  outcome: z.enum(["submitted", "partial", "blocked", "failed"]), limitations: z.array(z.string().max(2000)).max(20),
});
const capture = z.strictObject({ source_url: z.url(), observed_at: observedTime, visible_text: z.string().min(1).max(100000), query: z.string().max(500).optional() });
const placeholder = "00000000-0000-4000-8000-000000000001";

// Validate the original UTF-8 bytes again on the server, before creating a run.
export function verifyRemoteCollection(input: unknown, platform: string, issued: string, expires: string) {
  const data = remoteCollection.parse(input);
  if (Buffer.byteLength(JSON.stringify(data)) > 524288) throw new Error("Capture batch is too large");
  const logs = data.batch.logs.map(log => appendLogInput.parse({ ...log, contract_version: 1, run_id: placeholder }));
  if (logs.some(log => Date.parse(log.occurred_at) < Date.parse(issued) - 300000 || Date.parse(log.occurred_at) > Date.parse(expires) + 300000)) throw new Error("Capture is outside the claimed execution window");
  const captures = data.captures.map(item => {
    if (createHash("sha256").update(item.content, "utf8").digest("hex") !== item.sha256) throw new Error("Original capture hash mismatch");
    return { ...item, parsed: capture.parse(JSON.parse(item.content)) };
  });
  if (!data.batch.observation) {
    if (logs.some(log => !["failed", "blocked"].includes(log.outcome))) throw new Error("Failure-only batches cannot claim success");
    return data;
  }
  if (logs.filter(log => log.event_type === "native_search" && log.outcome === "success").length !== 1) throw new Error("One native search is required per candidate");
  for (const kind of ["native_search", "profile_open", "content_open"] as const) {
    const entries = logs.filter(log => log.event_type === kind && log.outcome === "success");
    if (!entries.length || entries.some(log => !captures.some(item => item.kind === kind && item.parsed.source_url === log.source_url && item.parsed.observed_at === log.occurred_at && (kind !== "native_search" || item.parsed.query === log.query)))) throw new Error("Search/profile/content logs need matching originals");
  }
  if (data.batch.observation.work_trace_reference) throw new Error("Codex cannot attest Work provenance");
  const observation = observationInput.parse({ ...data.batch.observation, contract_version: 1, run_id: placeholder, expected_context_sha256: "0".repeat(64), search_log_id: placeholder, work_trace_reference: null });
  const profile = captures.find(item => item.kind === "profile_open" && item.parsed.source_url === observation.identity.profile_url && item.parsed.observed_at === observation.profile.observed_at)?.parsed;
  if (observation.identity.platform !== platform || !profile || !observation.contents.length) throw new Error("Direct profile and recent content captures are required");
  for (const metric of observation.profile.metrics) if (metric.observed_at !== profile.observed_at || metric.raw_display && !profile.visible_text.includes(metric.raw_display)) throw new Error("Profile metric is missing from original text");
  for (const content of observation.contents) {
    const original = captures.find(item => item.kind === "content_open" && item.parsed.source_url === content.url && item.parsed.observed_at === content.observed_at)?.parsed;
    if (!original || !logs.some(log => log.event_type === "content_open" && log.outcome === "success" && log.source_url === original.source_url && log.occurred_at === original.observed_at)) throw new Error("Content has no matching original and log");
    for (const metric of content.metrics) if (metric.observed_at !== original.observed_at || metric.raw_display && !original.visible_text.includes(metric.raw_display)) throw new Error("Content metric is missing from original text");
  }
  return data;
}

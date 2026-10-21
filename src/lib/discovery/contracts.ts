import { createHash } from "node:crypto";
import { z } from "zod";
import { DISCOVERY_PLATFORMS, DISCOVERY_SOURCES } from "../db/discovery-schema";

export class DiscoveryError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export const platformSchema = z.enum(DISCOVERY_PLATFORMS);
const note = z.string().trim().max(2000).refine(value => !/\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{20,}|(?:access_token|refresh_token|client_secret|password)\s*[:=]/i.test(value), "Do not store credentials");
export const observedTime = z.iso.datetime({ offset: true }).refine(value => Date.parse(value) <= Date.now() + 300000, "Observation time is in the future").transform(value => new Date(value).toISOString());
export const privateReference = z.string().trim().min(1).max(500).refine(value => !/[?\r\n]|\bBearer\s|\bsk-[A-Za-z0-9_-]{20,}/i.test(value), "Use a private trace reference without credentials or query parameters");
const urlInput = z.string().max(2048).url();
export const contextInput = z.strictObject({ contract_version: z.literal(1), campaign_id: z.uuid(), brief_version: z.number().int().positive().optional() });
export const prepareRunInput = z.strictObject({
  contract_version: z.literal(1), campaign_id: z.uuid(), platform: platformSchema,
  requested_count: z.number().int().min(1).max(500), time_budget_seconds: z.number().int().min(60).max(14400).default(1800),
  execution_source: z.enum(DISCOVERY_SOURCES), work_task_reference: privateReference.nullable().default(null), idempotency_key: z.uuid(),
});
export const appendLogInput = z.strictObject({
  contract_version: z.literal(1), run_id: z.uuid(), idempotency_key: z.uuid(),
  event_type: z.enum(["site_open", "native_search", "profile_open", "content_open", "supplemental_web", "login_required", "captcha", "rate_limit", "access_failed"]),
  outcome: z.enum(["success", "partial", "blocked", "failed"]), occurred_at: observedTime,
  source_url: urlInput.nullable(), query: z.string().trim().max(500).nullable(), parent_log_id: z.uuid().nullable().default(null),
  failure_code: z.enum(["login_required", "captcha", "rate_limit", "access_denied", "not_found", "metric_hidden", "unsupported_ui", "network_error", "unknown"]).nullable(),
  message: note,
}).superRefine((data, ctx) => {
  if (data.event_type === "native_search" && (!data.query || !data.source_url)) ctx.addIssue({ code: "custom", message: "Native search needs an actual query and SNS source URL" });
  if (["blocked", "failed"].includes(data.outcome) && !data.failure_code) ctx.addIssue({ code: "custom", message: "A failed attempt needs a reason" });
  if (["captcha", "login_required", "rate_limit", "access_failed"].includes(data.event_type) && data.outcome === "success") ctx.addIssue({ code: "custom", message: "Access restrictions cannot be reported as success" });
});
export const metricInput = z.strictObject({
  name: z.enum(["followers", "subscribers", "views", "likes", "comments"]), raw_display: z.string().trim().max(100).nullable(),
  value: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(), precision: z.enum(["exact", "rounded", "hidden", "unavailable"]),
  observed_at: observedTime, source_url: urlInput,
}).superRefine((data, ctx) => {
  if (["hidden", "unavailable"].includes(data.precision) ? data.value !== null : data.value === null || !data.raw_display) ctx.addIssue({ code: "custom", message: "Preserve missing/rounded metric precision" });
});
const metrics = z.array(metricInput).max(5).refine(values => new Set(values.map(v => v.name)).size === values.length, "Duplicate metric names").transform(values => values.sort((a, b) => a.name.localeCompare(b.name)));
export const observationInput = z.strictObject({
  contract_version: z.literal(1), run_id: z.uuid(), idempotency_key: z.uuid(), expected_context_sha256: z.string().regex(/^[a-f0-9]{64}$/), search_log_id: z.uuid(),
  identity: z.strictObject({ platform: platformSchema, profile_url: urlInput, handle: z.string().trim().min(1).max(100).nullable(), platform_account_id: z.string().trim().min(1).max(100).nullable(), display_name: note.nullable().default(null) }),
  profile: z.strictObject({ opened_directly: z.boolean(), observed_at: observedTime, metrics, match_notes: note,
    limitations: z.array(note).max(20), country: z.strictObject({ code: z.string().regex(/^[A-Z]{2}$/).nullable(), basis: note }).default({ code: null, basis: "Country not verified" }),
    categories: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  }),
  contents: z.array(z.strictObject({ url: urlInput, opened_directly: z.boolean(), observed_at: observedTime, published_at: observedTime.nullable(), recent_basis: note, metrics, note })).max(3),
  work_trace_reference: privateReference.nullable().default(null), supersedes_evidence_id: z.uuid().nullable().default(null),
});
export const submitRunInput = z.strictObject({ contract_version: z.literal(1), run_id: z.uuid(), expected_lock_version: z.number().int().nonnegative(), outcome: z.enum(["submitted", "partial", "blocked", "failed"]), limitations: z.array(note).max(20), idempotency_key: z.uuid() });
export const readRunInput = z.strictObject({ contract_version: z.literal(1), run_id: z.uuid(), cursor: z.number().int().nonnegative().default(0), evidence_cursor: z.number().int().min(0).max(100000).default(0), limit: z.number().int().min(1).max(100).default(25) });
export const reviewEvidenceInput = z.strictObject({ evidence_id: z.uuid(), campaign_id: z.uuid().optional(), creator_account_id: z.uuid().optional(), verdict: z.enum(["accepted", "rejected", "needs_review"]), reason: note.refine(value => value.length > 0) });
export const reviewRunInput = z.strictObject({ run_id: z.uuid(), campaign_id: z.uuid().optional(), expected_lock_version: z.number().int().nonnegative(), verdict: z.enum(["completed", "partial", "blocked", "failed"]), reason: note.refine(value => value.length > 0) });

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const discoveryHash = (value: unknown) => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

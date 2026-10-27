import "dotenv/config";
import { readFileSync, realpathSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "../src/lib/db";
import { codexBrowserActor, localBrowserAuthorization } from "../src/lib/discovery/local-browser";
import { discoveryService } from "../src/lib/discovery/service";
import { appendLogInput, observationInput, observedTime } from "../src/lib/discovery/contracts";

const root = resolve(".local/discovery/codex-browser");
function privateFile(path: string) {
  const actual = realpathSync(resolve(path)), rel = relative(realpathSync(root), actual);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !statSync(actual).isFile() || statSync(actual).size > 524288) throw new Error("Expected a bounded private evidence file");
  return actual;
}
const read = (path: string): unknown => JSON.parse(readFileSync(privateFile(path), "utf8"));
const batchSchema = z.strictObject({
  prepare_key: z.uuid(), submit_key: z.uuid(), logs: z.array(z.record(z.string(), z.unknown())).min(3).max(10),
  observation: z.record(z.string(), z.unknown()),
  artifacts: z.array(z.strictObject({ kind: z.enum(["native_search", "profile_open", "content_open"]), file: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).min(3).max(6),
});
const captureSchema = z.strictObject({ source_url: z.url(), observed_at: observedTime, visible_text: z.string().min(1).max(100000), query: z.string().optional() });

let stage = "authorization";
try {
  const [action, authPath, batchPath] = process.argv.slice(2);
  const auth = localBrowserAuthorization.parse(read(authPath));
  const actor = codexBrowserActor(auth, process.env.CODEX_DISCOVERY_ENABLED === "true"), service = discoveryService();
  if (action === "context") {
    const result = await service.getContext(actor, { contract_version: 1, campaign_id: auth.campaign_id });
    console.log(JSON.stringify({ campaign_id: result.campaign_id, targeting: result.targeting_snapshot, context_sha256: result.context_sha256, execution_source: actor.executionSource, browser_launched: false }));
  } else if (action === "save") {
    stage = "capture_verification";
    const batch = batchSchema.parse(read(batchPath));
    const captures = batch.artifacts.map(artifact => {
      const bytes = readFileSync(privateFile(artifact.file));
      if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) throw new Error("Private capture hash mismatch");
      return { ...artifact, capture: captureSchema.parse(JSON.parse(bytes.toString("utf8"))) };
    });
    const searches = batch.logs.filter(log => log.event_type === "native_search" && log.outcome === "success");
    if (searches.length !== 1) throw new Error("One actually observed native search is required");
    for (const kind of ["native_search", "profile_open", "content_open"] as const) {
      const log = batch.logs.find(log => log.event_type === kind && log.outcome === "success");
      if (!log || !captures.some(item => item.kind === kind && item.capture.source_url === log.source_url && item.capture.observed_at === log.occurred_at && (kind !== "native_search" || item.capture.query === log.query))) throw new Error("Browser captures must match the observed search/profile/content logs");
    }
    if (batch.observation.work_trace_reference) throw new Error("A local Codex capture cannot claim Work provenance");
    const placeholder = "00000000-0000-4000-8000-000000000001";
    const observationDraft = observationInput.parse({ ...batch.observation, contract_version: 1, run_id: placeholder, expected_context_sha256: "0".repeat(64), search_log_id: placeholder, work_trace_reference: null });
    const profile = captures.find(item => item.kind === "profile_open")!.capture;
    if (observationDraft.identity.platform !== auth.platform || profile.source_url !== observationDraft.identity.profile_url || profile.observed_at !== observationDraft.profile.observed_at || !observationDraft.contents.every(content => captures.some(item => item.kind === "content_open" && item.capture.source_url === content.url && item.capture.observed_at === content.observed_at))) throw new Error("Observation must match its browser captures");
    for (const metric of observationDraft.profile.metrics) if (metric.raw_display && !profile.visible_text.includes(metric.raw_display)) throw new Error("Profile metric text is missing from its browser capture");
    for (const input of batch.logs) appendLogInput.parse({ ...input, contract_version: 1, run_id: placeholder });
    stage = "prepare_run";
    const prepared = await service.prepare(actor, { contract_version: 1, campaign_id: auth.campaign_id, platform: auth.platform, requested_count: 1, time_budget_seconds: 1800, execution_source: "codex_browser", idempotency_key: batch.prepare_key });
    stage = "append_logs";
    let searchId: unknown;
    for (const input of batch.logs) {
      const parsed = appendLogInput.parse({ ...input, contract_version: 1, run_id: prepared.run_id });
      const result = await service.appendLog(actor, parsed);
      if (parsed.event_type === "native_search") searchId = result.log_id;
    }
    const input = observationInput.parse({ ...batch.observation, contract_version: 1, run_id: prepared.run_id, expected_context_sha256: prepared.context_sha256, search_log_id: searchId, work_trace_reference: null, browser_trace_reference: relative(process.cwd(), privateFile(batchPath)).replaceAll(sep, "/") });
    stage = "record_observation";
    const observation = await service.record(actor, input);
    const immediate = await service.getRun(actor, { contract_version: 1, run_id: prepared.run_id });
    if (!immediate.evidence.some(row => row.creatorAccountId === observation.creator_account_id)) throw new Error("Immediate saved observation read-back failed");
    stage = "submit_run";
    const submitted = await service.submit(actor, { contract_version: 1, run_id: prepared.run_id, expected_lock_version: observation.lock_version, outcome: "partial", limitations: ["Codex local browser capture; source evidence and execution provenance await staff review. No hosted Work calls."], idempotency_key: batch.submit_key });
    stage = "read_back";
    const result = await service.getRun(actor, { contract_version: 1, run_id: prepared.run_id });
    const receiptPath = resolve(privateFile(batchPath), "..", `receipt-${batch.prepare_key}.json`);
    const receipt = { saved_at: new Date().toISOString(), authorization_id: auth.authorization_id, artifacts: batch.artifacts, observation, submitted, read: result, hosted_work_called: false };
    if (!existsSync(receiptPath)) writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ execution_source: "codex_browser", run_id: result.run_id, creator_account_id: observation.creator_account_id, evidence_ids: observation.evidence_ids, status: result.status, counts: result.counts, receipt_file: relative(process.cwd(), receiptPath), hosted_work_called: false }));
  } else throw new Error("Use context or save with an explicit private authorization file");
} catch (error) {
  console.error(JSON.stringify({ failed: true, stage, code: error && typeof error === "object" && "code" in error ? error.code : "local_browser_input_or_runtime_error" }));
  process.exitCode = 1;
} finally { await pool.end(); }

import "dotenv/config";
import { readFileSync, realpathSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "../src/lib/db";
import { codexBrowserActor, localBrowserAuthorization } from "../src/lib/discovery/local-browser";
import { discoveryService } from "../src/lib/discovery/service";
import { browserRequestService } from "../src/lib/discovery/browser-requests";
import { assertDiscoveryRuntimeRole } from "../src/lib/discovery/runtime-role";
import { appendLogInput, observationInput, observedTime, discoveryHash, submitRunInput } from "../src/lib/discovery/contracts";

const root = resolve(".local/discovery/codex-browser");
function privateFile(path: string) {
  const actual = realpathSync(resolve(path)), rel = relative(realpathSync(root), actual);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel) || !statSync(actual).isFile() || statSync(actual).size > 524288) throw new Error("Expected a bounded private evidence file");
  return actual;
}
const read = (path: string): unknown => JSON.parse(readFileSync(privateFile(path), "utf8").replace(/^\uFEFF/, ""));
const batchSchema = z.strictObject({
  prepare_key: z.uuid(), submit_key: z.uuid().optional(), logs: z.array(z.record(z.string(), z.unknown())).min(1).max(10),
  observation: z.record(z.string(), z.unknown()).optional(),
  artifacts: z.array(z.strictObject({ kind: z.enum(["native_search", "profile_open", "content_open"]), file: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).max(10).default([]),
});
const captureSchema = z.strictObject({ source_url: z.url(), observed_at: observedTime, visible_text: z.string().min(1).max(100000), query: z.string().optional() });
const placeholder = "00000000-0000-4000-8000-000000000001";
function verifyBatch(batch: z.infer<typeof batchSchema>, platform: string) {
  const logs = batch.logs.map(log => appendLogInput.parse({ ...log, contract_version: 1, run_id: placeholder }));
  if (!batch.observation) {
    if (!logs.length || logs.some(log => !["failed", "blocked"].includes(log.outcome))) throw new Error("A batch without observations must record actual failed or blocked attempts");
    return;
  }
  const captures = batch.artifacts.map(artifact => {
    const bytes = readFileSync(privateFile(artifact.file));
    if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) throw new Error("Private capture hash mismatch");
    return { ...artifact, capture: captureSchema.parse(JSON.parse(bytes.toString("utf8"))) };
  });
  const searches = logs.filter(log => log.event_type === "native_search" && log.outcome === "success");
  if (searches.length !== 1) throw new Error("One actually observed native search is required per candidate batch");
  for (const kind of ["native_search", "profile_open", "content_open"] as const) {
    const entries = logs.filter(log => log.event_type === kind && log.outcome === "success");
    if (!entries.length || entries.some(log => !captures.some(item => item.kind === kind && item.capture.source_url === log.source_url && item.capture.observed_at === log.occurred_at && (kind !== "native_search" || item.capture.query === log.query)))) throw new Error("Browser captures must match actual search/profile/content logs");
  }
  if (batch.observation.work_trace_reference) throw new Error("A local Codex capture cannot claim Work provenance");
  const draft = observationInput.parse({ ...batch.observation, contract_version: 1, run_id: placeholder, expected_context_sha256: "0".repeat(64), search_log_id: placeholder, work_trace_reference: null });
  const profile = captures.find(item => item.kind === "profile_open" && item.capture.source_url === draft.identity.profile_url && item.capture.observed_at === draft.profile.observed_at)?.capture;
  if (draft.identity.platform !== platform || !profile || !logs.some(log => log.event_type === "profile_open" && log.outcome === "success" && log.source_url === profile.source_url && log.occurred_at === profile.observed_at)) throw new Error("Profile observation must match its browser capture and log");
  for (const metric of draft.profile.metrics) if (metric.observed_at !== profile.observed_at || metric.raw_display && !profile.visible_text.includes(metric.raw_display)) throw new Error("Profile metric is missing from its browser capture");
  if (!draft.contents.length) throw new Error("A directly opened recent content observation is required");
  for (const content of draft.contents) {
    const capture = captures.find(item => item.kind === "content_open" && item.capture.source_url === content.url && item.capture.observed_at === content.observed_at)?.capture;
    if (!capture || !logs.some(log => log.event_type === "content_open" && log.outcome === "success" && log.source_url === content.url && log.occurred_at === content.observed_at)) throw new Error("Content observation must match its browser capture and log");
    for (const metric of content.metrics) if (metric.observed_at !== capture.observed_at || metric.raw_display && !capture.visible_text.includes(metric.raw_display)) throw new Error("Content metric is missing from its browser capture");
  }
}
function receipt(path: string, value: unknown) {
  if (!existsSync(path)) writeFileSync(path, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
}

let stage = "runtime_role";
try {
  await assertDiscoveryRuntimeRole(pool);
  const [action, authPath, batchPath, surface, executionReference] = process.argv.slice(2);
  if (action === "requests" || action === "claim") {
    if (process.env.CODEX_DISCOVERY_ENABLED !== "true") throw new Error("Codex discovery is disabled");
    stage = "request_handoff";
    const operator = z.strictObject({ organization_id: z.uuid(), user_id: z.uuid() }).parse(read(authPath));
    const who = { organizationId: operator.organization_id, userId: operator.user_id, role: "manager" as const }, queue = browserRequestService();
    if (action === "requests") {
      console.log(JSON.stringify({ browser_launched: false, requests: (await queue.list(who)).map(({ request: job, run }) => ({ request_id: job.id, campaign_id: job.campaignId, platform: job.platform, requested_count: job.requestedCount, state: job.state, run_id: job.runId, run_status: run?.status ?? null })) }));
    } else {
      const auth = await queue.claim(who, { request_id: batchPath, browser_surface: surface, execution_reference: executionReference });
      const directory = resolve(root, "requests", z.uuid().parse(batchPath));
      mkdirSync(directory, { recursive: true });
      const parent = relative(realpathSync(root), realpathSync(directory));
      if (parent.startsWith("..") || isAbsolute(parent)) throw new Error("Private request directory escaped its root");
      const file = resolve(directory, "authorization.json");
      if (existsSync(file) && discoveryHash(read(file)) !== discoveryHash(auth)) throw new Error("An immutable authorization file already exists");
      receipt(file, auth);
      console.log(JSON.stringify({ request_id: batchPath, authorization_file: relative(process.cwd(), file), max_creators: auth.max_creators, browser_launched: false }));
    }
  } else {
    stage = "authorization";
    const auth = localBrowserAuthorization.parse(read(authPath)), service = discoveryService();
    const actor = codexBrowserActor(auth, process.env.CODEX_DISCOVERY_ENABLED === "true");
    if (action === "context") {
      const result = await service.getContext(actor, { contract_version: 1, campaign_id: auth.campaign_id });
      console.log(JSON.stringify({ campaign_id: result.campaign_id, targeting: result.targeting_snapshot, context_sha256: result.context_sha256, expected_context_sha256: "request_id" in auth ? auth.expected_context_sha256 : null, execution_source: actor.executionSource, browser_launched: false }));
    } else if (action === "submit") {
      const manifest = z.strictObject({ prepare_key: z.uuid(), submit_key: z.uuid(), expected_lock_version: z.number().int().nonnegative(), outcome: submitRunInput.shape.outcome, limitations: submitRunInput.shape.limitations }).parse(read(batchPath));
      if (!("request_id" in auth) || manifest.prepare_key !== auth.request_id) throw new Error("Submission must use its dashboard request");
      stage = "prepare_run";
      const prepared = await service.prepare(actor, { contract_version: 1, campaign_id: auth.campaign_id, platform: auth.platform, requested_count: auth.max_creators, time_budget_seconds: 1800, execution_source: "codex_browser", idempotency_key: manifest.prepare_key });
      stage = "submit_run";
      const collected = await service.getRun(actor, { contract_version: 1, run_id: prepared.run_id });
      if (manifest.outcome === "submitted" && collected.counts.discovered < auth.max_creators) throw new Error("Use a partial or blocked outcome when the requested count was not reached");
      const submitted = await service.submit(actor, { contract_version: 1, run_id: prepared.run_id, expected_lock_version: manifest.expected_lock_version, outcome: manifest.outcome, limitations: manifest.limitations, idempotency_key: manifest.submit_key });
      const result = await service.getRun(actor, { contract_version: 1, run_id: prepared.run_id, limit: 100 });
      receipt(resolve(privateFile(batchPath), "..", "submission-receipt-" + manifest.submit_key + ".json"), { submitted, read: result });
      console.log(JSON.stringify({ run_id: result.run_id, status: result.status, counts: result.counts, hosted_work_called: false }));
    } else if (action === "collect" || action === "save") {
      stage = "capture_verification";
      const batch = batchSchema.parse(read(batchPath));
      if (action === "save" && ("request_id" in auth || !batch.observation || !batch.submit_key)) throw new Error("Use collect then submit for dashboard requests; save is the single-candidate pilot");
      if (action === "collect" && (!("request_id" in auth) || batch.prepare_key !== auth.request_id)) throw new Error("Collection must use its dashboard request");
      verifyBatch(batch, auth.platform);
      if ("request_id" in auth && batch.logs.some(log => Date.parse(String(log.occurred_at)) < Date.parse(auth.issued_at) - 300000 || Date.parse(String(log.occurred_at)) > Date.parse(auth.expires_at) + 300000)) throw new Error("Observation logs must belong to the claimed execution window");
      stage = "prepare_run";
      const prepared = await service.prepare(actor, { contract_version: 1, campaign_id: auth.campaign_id, platform: auth.platform, requested_count: auth.max_creators, time_budget_seconds: 1800, execution_source: "codex_browser", idempotency_key: batch.prepare_key });
      stage = "append_logs";
      let searchId: unknown;
      for (const input of batch.logs) {
        const parsed = appendLogInput.parse({ ...input, contract_version: 1, run_id: prepared.run_id });
        const saved = await service.appendLog(actor, parsed);
        if (parsed.event_type === "native_search" && parsed.outcome === "success") searchId = saved.log_id;
      }
      stage = "record_observation";
      const observation = batch.observation ? await service.record(actor, observationInput.parse({ ...batch.observation, contract_version: 1, run_id: prepared.run_id, expected_context_sha256: prepared.context_sha256, search_log_id: searchId, work_trace_reference: null, browser_trace_reference: relative(process.cwd(), privateFile(batchPath)).replaceAll(sep, "/") })) : null;
      let result = await service.getRun(actor, { contract_version: 1, run_id: prepared.run_id, limit: 100 });
      if (observation && !result.evidence.some(row => row.creatorAccountId === observation.creator_account_id)) throw new Error("Immediate saved observation read-back failed");
      let submitted: unknown = null;
      if (action === "save") {
        stage = "submit_run";
        submitted = await service.submit(actor, { contract_version: 1, run_id: prepared.run_id, expected_lock_version: observation!.lock_version, outcome: "partial", limitations: ["Codex local browser capture; source evidence and execution provenance await staff review. No hosted Work calls."], idempotency_key: batch.submit_key! });
        result = await service.getRun(actor, { contract_version: 1, run_id: prepared.run_id, limit: 100 });
      }
      const receiptPath = resolve(privateFile(batchPath), "..", (action === "save" ? "receipt-" + batch.prepare_key : "collection-receipt-" + (batch.observation?.idempotency_key ?? batch.logs[0].idempotency_key)) + ".json");
      receipt(receiptPath, { saved_at: new Date().toISOString(), authorization_id: auth.authorization_id, artifacts: batch.artifacts, observation, submitted, read: result, hosted_work_called: false });
      console.log(JSON.stringify({ execution_source: "codex_browser", run_id: result.run_id, creator_account_id: observation?.creator_account_id ?? null, evidence_ids: observation?.evidence_ids ?? [], status: result.status, lock_version: result.lock_version, counts: result.counts, remaining: Math.max(0, auth.max_creators - result.counts.discovered), receipt_file: relative(process.cwd(), receiptPath), hosted_work_called: false }));
    } else throw new Error("Use requests, claim, context, collect, submit or legacy save");
  }
} catch (error) {
  console.error(JSON.stringify({ failed: true, stage, code: error && typeof error === "object" && "code" in error ? error.code : "local_browser_input_or_runtime_error" }));
  process.exitCode = 1;
} finally { await pool.end(); }

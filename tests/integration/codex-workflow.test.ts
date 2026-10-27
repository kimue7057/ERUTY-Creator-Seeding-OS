import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { withDiscoveryDatabase, sqlFailure } from "../discovery-fixture";
import { logSample, observationSample, localDiscoveryActor, prepareSample } from "../discovery-samples";
import { sampleEvaluation } from "../evaluation-samples";
import { browserRequestService } from "../../src/lib/discovery/browser-requests";
import { codexBrowserActor } from "../../src/lib/discovery/local-browser";
import { discoveryService } from "../../src/lib/discovery/service";
import { DiscoveryError } from "../../src/lib/discovery/contracts";
import { evaluationService } from "../../src/lib/evaluation/service";
import { campaigns, memberships } from "../../src/lib/db/schema";
const code = (value: string) => (error: unknown) => error instanceof DiscoveryError && error.code === value;
const execution = { browser_surface: "iab", execution_reference: "SYNTHETIC isolated contract; no actual SNS visit" };

test("dashboard request pins context, isolates tenants, claims idempotently and rejects forged/changed/cancelled authorization", async () => {
  await withDiscoveryDatabase(async f => {
    const campaign = await f.campaign(), queue = browserRequestService(f.database), service = discoveryService(f.database), staff = localDiscoveryActor(f.actor);
    const context = await service.getContext(staff, { contract_version: 1, campaign_id: campaign.id });
    const input = { campaign_id: campaign.id, platform: "instagram", requested_count: 2, expected_context_sha256: context.context_sha256, idempotency_key: randomUUID() };
    await assert.rejects(queue.create(f.reader, input), code("insufficient_scope"));
    await assert.rejects(queue.create(f.other, input), code("not_found_or_forbidden"));
    await assert.rejects(queue.create(f.actor, { ...input, expected_context_sha256: "0".repeat(64) }), code("stale_context"));
    const [job, replay] = await Promise.all([queue.create(f.actor, input), queue.create(f.actor, input)]); assert.equal(job.id, replay.id);
    await assert.rejects(queue.create(f.actor, { ...input, requested_count: 3 }), code("idempotency_conflict"));
    assert.equal((await queue.list(f.other)).length, 0);
    const claim = { request_id: job.id, ...execution }, auth = await queue.claim(f.actor, claim);
    assert.deepEqual(await queue.claim(f.actor, claim), auth);
    await assert.rejects(queue.claim(f.actor, { ...claim, execution_reference: "Another execution" }), code("browser_request_claimed"));
    const who = codexBrowserActor(auth, true), prepare = { ...prepareSample(campaign.id), execution_source: "codex_browser", requested_count: 2 };
    await assert.rejects(service.prepare(codexBrowserActor({ ...auth, max_creators: 3 }, true), { ...prepare, requested_count: 3 }), code("browser_request_not_authorized"));
    await f.database.update(campaigns).set({ notes: "SYNTHETIC changed after dashboard request" }).where(eq(campaigns.id, campaign.id));
    await assert.rejects(service.prepare(who, prepare), code("stale_context"));
    await queue.cancel(f.actor, job.id);
    await assert.rejects(service.prepare(who, prepare), code("browser_request_not_authorized"));
    await assert.rejects(f.client.query("delete from discovery_browser_requests"), sqlFailure("23514"));
    assert.equal((await f.client.query("select count(*)::int n from discovery_runs")).rows[0].n, 0);
  });
});

test("two scoped candidates require both evidence and execution review before Codex evaluation approval; revocation invalidates approval", async () => {
  await withDiscoveryDatabase(async f => {
    const campaign = await f.campaign(), queue = browserRequestService(f.database), service = discoveryService(f.database), staff = localDiscoveryActor(f.actor);
    const context = await service.getContext(staff, { contract_version: 1, campaign_id: campaign.id });
    const job = await queue.create(f.actor, { campaign_id: campaign.id, platform: "instagram", requested_count: 2, expected_context_sha256: context.context_sha256, idempotency_key: randomUUID() });
    const who = codexBrowserActor(await queue.claim(f.actor, { request_id: job.id, ...execution }), true);
    const run = await service.prepare(who, { ...prepareSample(campaign.id), execution_source: "codex_browser", requested_count: 2 });
    const log = await service.appendLog(who, logSample(run.run_id)), saved = [];
    for (const suffix of ["one", "two"]) saved.push(await service.record(who, { ...observationSample(run.run_id, run.context_sha256, log.log_id, suffix), browser_trace_reference: ".local/discovery/codex-browser/SYNTHETIC/" + suffix }));
    await assert.rejects(service.record(who, { ...observationSample(run.run_id, run.context_sha256, log.log_id, "three"), browser_trace_reference: "SYNTHETIC third" }), code("quota_exceeded"));
    assert.equal((await queue.list(f.actor))[0].collected, 2);
    const read = await service.getRun(who, { contract_version: 1, run_id: run.run_id });
    const submitted = await service.submit(who, { contract_version: 1, run_id: run.run_id, expected_lock_version: read.lock_version, outcome: "submitted", limitations: ["SYNTHETIC contract only"], idempotency_key: randomUUID() });
    for (const entry of saved) for (const id of entry.evidence_ids) await service.reviewEvidence(staff, { evidence_id: id, verdict: "accepted", reason: "SYNTHETIC fixture review only" });
    const browserReview = { run_id: run.run_id, expected_lock_version: submitted.lock_version, verdict: "accepted", reason: "SYNTHETIC browser execution review contract", browser_evidence_checked: false };
    await assert.rejects(service.reviewBrowserExecution(who, browserReview), code("staff_review_required"));
    await assert.rejects(service.reviewBrowserExecution(staff, browserReview), code("browser_execution_evidence_required"));
    const evaluations = evaluationService(f.database), accountId = saved[0].creator_account_id;
    assert.equal((await evaluations.context(f.actor, campaign.id, accountId)).ready_for_step4, false);
    await service.reviewBrowserExecution(staff, { ...browserReview, browser_evidence_checked: true });
    const ctx = await evaluations.context(f.actor, campaign.id, accountId); assert.equal(ctx.ready_for_step4, true);
    const evaluation = await evaluations.record(f.actor, campaign.id, accountId, { input_sha256: ctx.input_sha256, idempotency_key: randomUUID(), model: "SYNTHETIC Codex output", output: sampleEvaluation(saved[0].evidence_ids[0]) }, "codex_import");
    const approval = { evaluation_id: evaluation.id, idempotency_key: randomUUID(), verdict: "approved", reason: "SYNTHETIC isolated approval only", unknowns_acknowledged: true };
    await evaluations.review(f.actor, campaign.id, accountId, approval); assert.equal((await evaluations.detail(f.actor, campaign.id, accountId)).can_outreach, true);
    const reviewed = await service.getRun(staff, { contract_version: 1, run_id: run.run_id }); assert.equal(reviewed.counts.verified, 2);
    await service.reviewBrowserExecution(staff, { ...browserReview, expected_lock_version: reviewed.lock_version, verdict: "needs_review", reason: "SYNTHETIC request for recheck" });
    assert.equal((await evaluations.detail(f.actor, campaign.id, accountId)).can_outreach, false);
    await assert.rejects(f.client.query("update discovery_browser_run_reviews set verdict='accepted'"), sqlFailure("23514"));
    const again = await service.getRun(staff, { contract_version: 1, run_id: run.run_id });
    await service.reviewBrowserExecution(staff, { ...browserReview, expected_lock_version: again.lock_version, browser_evidence_checked: true });
    assert.equal((await evaluations.detail(f.actor, campaign.id, accountId)).can_outreach, false, "a later acceptance must not revive an old evaluation approval");
    const ready = await service.getRun(staff, { contract_version: 1, run_id: run.run_id });
    const completed = await service.reviewRun(staff, { run_id: run.run_id, expected_lock_version: ready.lock_version, verdict: "completed", reason: "SYNTHETIC all scoped candidates reviewed" });
    assert.equal(completed.status, "completed");
    await f.database.update(memberships).set({ role: "reviewer" }).where(eq(memberships.userId, f.actor.userId));
    await assert.rejects(queue.create(f.actor, { campaign_id: campaign.id, platform: "instagram", requested_count: 1, expected_context_sha256: context.context_sha256, idempotency_key: randomUUID() }), code("insufficient_scope"));
  });
});

test("cancellation and concurrent collection serialize and preserve prior logs while blocking subsequent writes", async () => {
  await withDiscoveryDatabase(async f => {
    const campaign = await f.campaign(), queue = browserRequestService(f.database), service = discoveryService(f.database), staff = localDiscoveryActor(f.actor);
    const ctx = await service.getContext(staff, { contract_version: 1, campaign_id: campaign.id });
    const job = await queue.create(f.actor, { campaign_id: campaign.id, platform: "instagram", requested_count: 2, expected_context_sha256: ctx.context_sha256, idempotency_key: randomUUID() });
    const who = codexBrowserActor(await queue.claim(f.actor, { request_id: job.id, ...execution }), true);
    const run = await service.prepare(who, { ...prepareSample(campaign.id), execution_source: "codex_browser", requested_count: 2 });
    const results = await Promise.allSettled([service.appendLog(who, logSample(run.run_id)), queue.cancel(f.actor, job.id)]);
    assert.equal(results[1].status, "fulfilled");
    const state = await service.getRun(staff, { contract_version: 1, run_id: run.run_id }); assert.equal(state.status, "cancelled");
    await assert.rejects(service.appendLog(who, logSample(run.run_id)), code("browser_request_not_authorized"));
    assert.equal(state.logs.length, results[0].status === "fulfilled" ? 1 : 0);
    assert.equal((await f.client.query("select count(*)::int n from discovery_evidence")).rows[0].n, 0);
  });
});

test("restricted CLI claims a dashboard request, validates captures, collects two candidates and replays submission without duplicate rows", async () => {
  await withDiscoveryDatabase(async f => {
    const campaign = await f.campaign(), service = discoveryService(f.database), queue = browserRequestService(f.database);
    const ctx = await service.getContext(localDiscoveryActor(f.actor), { contract_version: 1, campaign_id: campaign.id });
    const job = await queue.create(f.actor, { campaign_id: campaign.id, platform: "instagram", requested_count: 2, expected_context_sha256: ctx.context_sha256, idempotency_key: randomUUID() });
    const role = "browser_test_" + randomUUID().replaceAll("-", ""), password = randomUUID();
    await f.client.query('CREATE ROLE "' + role + '" LOGIN PASSWORD \'' + password + "'");
    await f.client.query((await readFile("staging/discovery/runtime-grants.sql", "utf8")).replaceAll("eruty_discovery_runtime", role));
    const url = new URL(process.env.DATABASE_URL!); url.username = role; url.password = password; url.pathname = (await f.client.query("select current_database() name")).rows[0].name;
    const directory = resolve(".local/discovery/codex-browser/SYNTHETIC-" + randomUUID()); await mkdir(directory, { recursive: true });
    const operator = resolve(directory, "operator.json"); await writeFile(operator, JSON.stringify({ organization_id: f.actor.organizationId, user_id: f.actor.userId }));
    const command = async (...args: string[]) => JSON.parse((await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/codex-discovery.ts", ...args], { env: { ...process.env, DATABASE_URL: url.href, CODEX_DISCOVERY_ENABLED: "true" }, timeout: 30000 })).stdout.trim());
    const claimed = await command("claim", operator, job.id, "iab", execution.execution_reference), authFile = claimed.authorization_file;
    assert.equal((await command("requests", operator)).requests.length, 1);
    let last;
    for (const suffix of ["cli_one", "cli_two"]) {
      const observation = observationSample(randomUUID(), "0".repeat(64), randomUUID(), suffix);
      const { run_id: _run, expected_context_sha256: _context, search_log_id: _search, ...draft } = observation; void _run; void _context; void _search;
      const at = observation.profile.observed_at, searchUrl = "https://www.instagram.com/";
      const artifacts = [], logs = [];
      for (const [kind, url] of [["native_search", searchUrl], ["profile_open", observation.identity.profile_url], ["content_open", observation.contents[0].url]]) {
        const file = resolve(directory, suffix + "-" + kind + ".json"), bytes = JSON.stringify({ source_url: url, observed_at: at, visible_text: "SYNTHETIC original fixture; followers 12,345; views 100", ...(kind === "native_search" ? { query: "SYNTHETIC TEST ONLY" } : {}) });
        await writeFile(file, bytes); artifacts.push({ kind, file, sha256: createHash("sha256").update(bytes).digest("hex") });
        logs.push({ ...logSample(randomUUID()), event_type: kind, occurred_at: at, source_url: url });
      }
      const batchPath = resolve(directory, suffix + "-batch.json"), batch = { prepare_key: job.id, logs, artifacts, observation: draft };
      await writeFile(batchPath, JSON.stringify({ ...batch, artifacts: artifacts.map((a, i) => i ? a : { ...a, sha256: "0".repeat(64) }) }));
      await assert.rejects(command("collect", authFile, batchPath));
      await writeFile(batchPath, JSON.stringify(batch)); last = await command("collect", authFile, batchPath);
      assert.equal((await command("collect", authFile, batchPath)).creator_account_id, last.creator_account_id);
    }
    assert.equal(last.counts.discovered, 2); assert.equal(last.remaining, 0);
    const manifest = resolve(directory, "submit.json"); await writeFile(manifest, JSON.stringify({ prepare_key: job.id, submit_key: randomUUID(), expected_lock_version: last.lock_version, outcome: "submitted", limitations: ["SYNTHETIC isolated CLI test only"] }));
    const submitted = await command("submit", authFile, manifest), replay = await command("submit", authFile, manifest);
    assert.equal(submitted.run_id, replay.run_id); assert.equal(replay.status, "awaiting_review"); assert.equal(replay.counts.discovered, 2); assert.equal(replay.counts.verified, 0);
    assert.equal((await f.client.query("select count(*)::int n from discovery_evidence")).rows[0].n, 4);
    assert.equal((await f.client.query("select count(*)::int n from discovery_logs")).rows[0].n, 6);
    await assert.rejects(f.client.query("set role " + role + "; insert into discovery_browser_run_reviews default values"));
    await f.client.query("reset role");
  });
});

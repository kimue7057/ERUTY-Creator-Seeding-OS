import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { withDiscoveryDatabase, sqlFailure } from "../discovery-fixture";
import { localDiscoveryActor, logSample, observationSample } from "../discovery-samples";
import { automaticWorkerService } from "../../src/lib/discovery/automatic-worker";
import { browserRequestService } from "../../src/lib/discovery/browser-requests";
import { discoveryService } from "../../src/lib/discovery/service";
import { DiscoveryError } from "../../src/lib/discovery/contracts";
import { codexBrowserActor } from "../../src/lib/discovery/local-browser";
import { users } from "../../src/lib/db/schema";
import { hashPassword } from "../../src/lib/auth/password";
import { browserWorkerAuth } from "../../src/lib/discovery/remote-auth";
import { remoteBrowserService } from "../../src/lib/discovery/remote-browser";
const code = (value: string) => (error: unknown) => error instanceof DiscoveryError && error.code === value;
const host = () => ({ worker_id: randomUUID(), instance_id: randomUUID(), name: "SYNTHETIC isolated worker", browser_surface: "chrome" as const, platforms: ["instagram" as const], ready: true });

test("authenticated automatic assignment accepts real-contract capture batches and submits partial without approving creators", async () => {
  const flag = process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED; process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED = "true";
  try { await withDiscoveryDatabase(async f => {
    const credentials = { email: "synthetic-automatic@example.invalid", password: "synthetic-automatic-fixture-password" };
    await f.database.update(users).set({ email: credentials.email, passwordHash: hashPassword(credentials.password) }).where(eq(users.id, f.actor.userId));
    const token = (await browserWorkerAuth(f.database).login(credentials)).token, remote = remoteBrowserService(f.database), worker = host(), campaign = await f.campaign();
    const context = await discoveryService(f.database).getContext(localDiscoveryActor(f.actor), { contract_version: 1, campaign_id: campaign.id });
    const job = await browserRequestService(f.database).create(f.actor, { campaign_id: campaign.id, platform: "instagram", requested_count: 1, expected_context_sha256: context.context_sha256, idempotency_key: randomUUID() });
    await remote.execute("worker-heartbeat", token, worker);
    const lease = { worker_id: worker.worker_id, instance_id: worker.instance_id }, assigned = await remote.execute("worker-next", token, lease);
    assert.ok("assignment" in assigned && assigned.assignment); const assignment = assigned.assignment;
    const sample = observationSample(randomUUID(), "0".repeat(64), randomUUID(), "automatic"), at = sample.profile.observed_at;
    const { run_id: _run, search_log_id: _search, expected_context_sha256: _context, ...observation } = sample; void _run; void _search; void _context;
    const logs = [], captures = [];
    for (const [kind, url] of [["native_search", "https://www.instagram.com/"], ["profile_open", sample.identity.profile_url], ["content_open", sample.contents[0].url]]) {
      const content = JSON.stringify({ source_url: url, observed_at: at, visible_text: "SYNTHETIC fixture followers 12,345; views 100", ...(kind === "native_search" ? { query: "SYNTHETIC TEST ONLY" } : {}) });
      captures.push({ kind, content, sha256: createHash("sha256").update(content).digest("hex") });
      logs.push({ ...logSample(randomUUID()), event_type: kind, source_url: url, occurred_at: at });
    }
    const saved = await remote.execute("collect", token, { authorization: assignment.authorization, payload: { batch: { prepare_key: job.id, logs, observation }, captures } });
    assert.ok("counts" in saved && saved.counts); assert.equal(saved.counts.discovered, 1); assert.equal(saved.counts.verified, 0);
    await remote.execute("submit", token, { authorization: assignment.authorization, payload: { prepare_key: job.id, submit_key: randomUUID(), expected_lock_version: saved.lock_version, outcome: "partial", limitations: ["SYNTHETIC fixture; no actual browser visit"] } });
    const finished = await remote.execute("worker-finish", token, { ...lease, execution_id: assignment.execution_id, exit_code: 0, error_code: null });
    assert.ok("state" in finished); assert.equal(finished.state, "partial");
    assert.equal((await f.client.query("select count(*)::int n from discovery_browser_run_reviews")).rows[0].n, 0);
  }); } finally { if (flag === undefined) delete process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED; else process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED = flag; }
});

test("automatic worker claims once, recovers lost acknowledgement, isolates tenants and preserves cancellation", async () => {
  await withDiscoveryDatabase(async f => {
    const automatic = automaticWorkerService(f.database), queue = browserRequestService(f.database), worker = host(), second = host();
    const campaign = await f.campaign(), context = await discoveryService(f.database).getContext(localDiscoveryActor(f.actor), { contract_version: 1, campaign_id: campaign.id });
    const job = await queue.create(f.actor, { campaign_id: campaign.id, platform: "instagram", requested_count: 2, expected_context_sha256: context.context_sha256, idempotency_key: randomUUID() });
    await assert.rejects(automatic.heartbeat(f.reader, worker), code("insufficient_scope"));
    await automatic.heartbeat(f.actor, worker); await automatic.heartbeat(f.actor, second);
    await assert.rejects(automatic.heartbeat(f.other, worker), code("worker_scope_denied"));
    await assert.rejects(automatic.heartbeat(f.actor, { ...worker, instance_id: randomUUID() }), code("worker_already_online"));
    const picked = await Promise.all([automatic.next(f.actor, { worker_id: worker.worker_id, instance_id: worker.instance_id }), automatic.next(f.actor, { worker_id: second.worker_id, instance_id: second.instance_id })]);
    assert.equal(picked.filter(x => x.assignment).length, 1);
    const selected = picked[0].assignment ? worker : second, assignment = picked.find(x => x.assignment)!.assignment!;
    assert.equal(assignment.request_id, job.id);
    const lease = { worker_id: selected.worker_id, instance_id: selected.instance_id };
    assert.deepEqual((await automatic.next(f.actor, lease)).assignment, assignment);
    await automatic.event(f.actor, { ...lease, execution_id: assignment.execution_id, phase: "browsing" });
    assert.equal((await automatic.next(f.actor, lease)).assignment, null);
    assert.equal((await automatic.snapshot(f.actor, campaign.id)).requests[0].state, "running");
    assert.equal((await automatic.snapshot(f.other, campaign.id)).requests.length, 0);
    await assert.rejects(f.client.query("update discovery_browser_executions set organization_id=$1", [f.other.organizationId]), sqlFailure("23514"));
    await queue.cancel(f.actor, job.id);
    assert.equal((await automatic.event(f.actor, { ...lease, execution_id: assignment.execution_id, phase: "saving" })).cancelled, true);
    assert.equal((await automatic.finish(f.actor, { ...lease, execution_id: assignment.execution_id, exit_code: -1, error_code: "cli_failed" })).state, "cancelled");
    assert.equal((await f.client.query("select count(*)::int n from creator_accounts")).rows[0].n, 0);
  });
});

test("stale targeting fails visibly without starving later requests, and disconnected workers never imply success", async () => {
  await withDiscoveryDatabase(async f => {
    const automatic = automaticWorkerService(f.database), queue = browserRequestService(f.database), worker = host(), campaign = await f.campaign();
    const context = await discoveryService(f.database).getContext(localDiscoveryActor(f.actor), { contract_version: 1, campaign_id: campaign.id });
    const make = (hash: string) => queue.create(f.actor, { campaign_id: campaign.id, platform: "instagram", requested_count: 1, expected_context_sha256: hash, idempotency_key: randomUUID() });
    const stale = await make(context.context_sha256);
    await f.client.query("update campaigns set follower_max=200000 where id=$1", [campaign.id]);
    const nextContext = await discoveryService(f.database).getContext(localDiscoveryActor(f.actor), { contract_version: 1, campaign_id: campaign.id });
    const valid = await make(nextContext.context_sha256);
    await automatic.heartbeat(f.actor, worker);
    const lease = { worker_id: worker.worker_id, instance_id: worker.instance_id };
    assert.equal((await automatic.next(f.actor, lease)).assignment, null);
    const snapshot = await automatic.snapshot(f.actor, campaign.id);
    assert.equal(snapshot.requests.find(j => j.id === stale.id)?.state, "failed");
    const job = (await automatic.next(f.actor, lease)).assignment!; assert.equal(job.request_id, valid.id);
    await automatic.event(f.actor, { ...lease, execution_id: job.execution_id, phase: "browsing" });
    await f.client.query("update discovery_browser_workers set last_seen_at=now()-interval '1 minute'");
    const offline = await automatic.snapshot(f.actor, campaign.id); assert.equal(offline.online, false); assert.equal(offline.requests.find(j => j.id === valid.id)?.state, "interrupted");
    await automatic.heartbeat(f.actor, { ...worker, instance_id: randomUUID() });
    assert.equal((await automatic.snapshot(f.actor, campaign.id)).requests.find(j => j.id === valid.id)?.state, "interrupted");
    assert.equal((await f.client.query("select count(*)::int n from discovery_evidence")).rows[0].n, 0);
  });
});

test("worker exit cannot claim completion without a submitted run and requested distinct accounts", async () => {
  await withDiscoveryDatabase(async f => {
    const automatic = automaticWorkerService(f.database), queue = browserRequestService(f.database), worker = host(), campaign = await f.campaign();
    const context = await discoveryService(f.database).getContext(localDiscoveryActor(f.actor), { contract_version: 1, campaign_id: campaign.id });
    await queue.create(f.actor, { campaign_id: campaign.id, platform: "instagram", requested_count: 20, expected_context_sha256: context.context_sha256, idempotency_key: randomUUID() });
    await automatic.heartbeat(f.actor, worker); const lease = { worker_id: worker.worker_id, instance_id: worker.instance_id }, job = (await automatic.next(f.actor, lease)).assignment!;
    const result = await automatic.finish(f.actor, { ...lease, execution_id: job.execution_id, exit_code: 0, error_code: null });
    assert.equal(result.state, "failed"); assert.equal((await automatic.snapshot(f.actor, campaign.id)).requests[0].error_code, "result_not_submitted");
    assert.deepEqual(await automatic.finish(f.actor, { ...lease, execution_id: job.execution_id, exit_code: 0, error_code: null }), result);
    await queue.create(f.actor, { campaign_id: campaign.id, platform: "instagram", requested_count: 20, expected_context_sha256: context.context_sha256, idempotency_key: randomUUID() });
    const partial = (await automatic.next(f.actor, lease)).assignment!;
    assert.ok(partial.run_id);
    const who = codexBrowserActor(partial.authorization, true), service = discoveryService(f.database);
    const recorded = await service.appendLog(who, { ...logSample(partial.run_id), event_type: "login_required", outcome: "blocked", failure_code: "login_required" });
    await service.submit(who, { contract_version: 1, run_id: partial.run_id, expected_lock_version: recorded.lock_version, outcome: "partial", limitations: ["SYNTHETIC test; no browser visit or creator"], idempotency_key: randomUUID() });
    assert.equal((await automatic.finish(f.actor, { ...lease, execution_id: partial.execution_id, exit_code: 0, error_code: null })).state, "partial");
  });
});

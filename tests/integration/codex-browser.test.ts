import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { withDiscoveryDatabase } from "../discovery-fixture";
import { prepareSample, logSample, observationSample, localDiscoveryActor } from "../discovery-samples";
import { codexBrowserActor } from "../../src/lib/discovery/local-browser";
import { discoveryService } from "../../src/lib/discovery/service";
import { DiscoveryError } from "../../src/lib/discovery/contracts";
import { memberships } from "../../src/lib/db/schema";
const code = (value: string) => (error: unknown) => error instanceof DiscoveryError && error.code === value;
const authorization = (organizationId: string, userId: string, campaignId: string) => ({ authorization_id: randomUUID(), organization_id: organizationId, user_id: userId, campaign_id: campaignId,
  platform: "instagram", browser_surface: "iab", execution_reference: "SYNTHETIC local browser contract; no real SNS visit", issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString(), max_creators: 1, confirmation: "authorize-one-codex-browser-run" });

test("Codex browser pilot is opt-in, live-role/campaign scoped, single-run and idempotent on PostgreSQL", async () => {
  await withDiscoveryDatabase(async ({ database, actor, reader, campaign, client }) => {
    const a = await campaign(), b = await campaign(), auth = authorization(actor.organizationId, actor.userId, a.id), service = discoveryService(database);
    assert.throws(() => codexBrowserActor(auth, false), code("local_browser_disabled"));
    assert.throws(() => codexBrowserActor({ ...auth, issued_at: new Date(Date.now()-7200000).toISOString(), expires_at: new Date(Date.now()-3600000).toISOString() }, true), code("local_browser_authorization_expired"));
    assert.throws(() => codexBrowserActor({ ...auth, expires_at: new Date(Date.now()+5*3600000).toISOString() }, true));
    const who = codexBrowserActor(auth, true), input = { ...prepareSample(a.id), execution_source: "codex_browser" };
    await assert.rejects(service.prepare({ ...who, localBrowser: undefined }, input), code("local_browser_authorization_required"));
    await assert.rejects(service.prepare(who, { ...input, campaign_id: b.id }), code("not_found_or_forbidden"));
    await assert.rejects(service.prepare(who, { ...input, requested_count: 2 }), code("local_browser_scope_denied"));
    await assert.rejects(service.prepare(who, { ...input, platform: "tiktok" }), code("local_browser_scope_denied"));
    await assert.rejects(service.prepare(who, { ...input, work_task_reference: "fake-work" }), code("local_browser_scope_denied"));
    await assert.rejects(service.prepare(codexBrowserActor({ ...auth, user_id: reader.userId }, true), input), code("insufficient_scope"));
    const [run, replay] = await Promise.all([service.prepare(who, input), service.prepare(who, input)]);
    assert.equal(run.run_id, replay.run_id); assert.notEqual(run.replayed, replay.replayed);
    await assert.rejects(service.prepare(who, { ...input, idempotency_key: randomUUID() }), code("local_browser_authorization_consumed"));
    const row = (await client.query("select execution_source,work_task_reference,capability_receipt_id,environment_snapshot from discovery_runs where id=$1", [run.run_id])).rows[0];
    assert.equal(row.execution_source, "codex_browser"); assert.equal(row.work_task_reference, null); assert.equal(row.capability_receipt_id, null);
    assert.equal(row.environment_snapshot.browser_connection, "unverified"); assert.equal(row.environment_snapshot.local_authorization_id, auth.authorization_id);
    await database.update(memberships).set({ role: "reviewer" }).where(eq(memberships.userId, actor.userId));
    await assert.rejects(service.appendLog(who, logSample(run.run_id as string)), code("insufficient_scope"));
  });
});

test("Codex original-browser observations retain separate provenance and cannot attest Work or final approval", async () => {
  await withDiscoveryDatabase(async ({ database, actor, campaign, client }) => {
    const a = await campaign(), who = codexBrowserActor(authorization(actor.organizationId, actor.userId, a.id), true), service = discoveryService(database);
    const run = await service.prepare(who, { ...prepareSample(a.id), execution_source: "codex_browser" });
    const search = await service.appendLog(who, logSample(run.run_id as string));
    const sample = observationSample(run.run_id as string, run.context_sha256 as string, search.log_id as string);
    await assert.rejects(service.record(who, sample), code("browser_trace_required"));
    const input = { ...sample, browser_trace_reference: ".local/discovery/codex-browser/SYNTHETIC/batch.json" };
    await assert.rejects(service.record(who, { ...input, work_trace_reference: "fake-hosted-work" }), code("browser_trace_required"));
    const saved = await service.record(who, input), replay = await service.record(who, input);
    assert.deepEqual(replay.evidence_ids, saved.evidence_ids); assert.equal(replay.replayed, true);
    const evidence = (await client.query("select observation_method,work_trace_reference,browser_trace_reference from discovery_evidence order by id")).rows;
    assert.equal(evidence.length, 2); assert.ok(evidence.every(row => row.observation_method === "sns_browser" && row.work_trace_reference === null && row.browser_trace_reference === input.browser_trace_reference));
    for (const id of saved.evidence_ids as string[]) await service.reviewEvidence(localDiscoveryActor(actor), { evidence_id: id, verdict: "accepted", reason: "SYNTHETIC test evidence; not a real visit" });
    const read = await service.getRun(who, { contract_version: 1, run_id: run.run_id });
    assert.equal(read.counts.discovered, 1); assert.equal(read.counts.verified, 0);
    const submitted = await service.submit(who, { contract_version: 1, run_id: run.run_id, expected_lock_version: read.lock_version, outcome: "partial", limitations: ["Synthetic contract only"], idempotency_key: randomUUID() });
    assert.equal(submitted.status, "awaiting_review");
    await assert.rejects(service.reviewRun(localDiscoveryActor(actor), { run_id: run.run_id, expected_lock_version: submitted.lock_version, verdict: "completed", reason: "Cannot attest a new source automatically" }), code("insufficient_verified_evidence"));
    assert.equal((await client.query("select count(*)::int n from discovery_capability_receipts")).rows[0].n, 0);
    await assert.rejects(client.query("update discovery_evidence set browser_trace_reference='changed'"));
  });
});

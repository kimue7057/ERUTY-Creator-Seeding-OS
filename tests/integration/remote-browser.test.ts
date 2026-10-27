import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { withDiscoveryDatabase, sqlFailure } from "../discovery-fixture";
import { localDiscoveryActor, logSample, observationSample } from "../discovery-samples";
import { users, memberships, loginAttempts } from "../../src/lib/db/schema";
import { browserWorkerSessions } from "../../src/lib/db/browser-schema";
import { hashPassword } from "../../src/lib/auth/password";
import { browserWorkerAuth } from "../../src/lib/discovery/remote-auth";
import { remoteBrowserService } from "../../src/lib/discovery/remote-browser";
import { browserRequestService } from "../../src/lib/discovery/browser-requests";
import { discoveryService } from "../../src/lib/discovery/service";
import { DiscoveryError } from "../../src/lib/discovery/contracts";
const code = (value: string) => (error: unknown) => error instanceof DiscoveryError && error.code === value;
const credentials = { email: "synthetic-remote@example.invalid", password: "synthetic-remote-test-only-password" };

test("remote worker credentials share login limits, store only token hashes, enforce current roles, expire and revoke", async () => {
  await withDiscoveryDatabase(async f => {
    await f.database.update(users).set({ email: credentials.email, passwordHash: hashPassword(credentials.password) }).where(eq(users.id, f.actor.userId));
    const auth = browserWorkerAuth(f.database);
    for (let i = 0; i < 10; i++) await assert.rejects(auth.login({ ...credentials, password: "wrong" }), code("invalid_credentials"));
    await assert.rejects(auth.login(credentials), code("login_rate_limited"));
    await f.database.update(loginAttempts).set({ windowStartedAt: new Date(Date.now() - 16 * 60000) });
    const session = await auth.login(credentials), actor = await auth.actor(session.token);
    assert.equal(actor.userId, f.actor.userId);
    const [saved] = await f.database.select().from(browserWorkerSessions); assert.notEqual(saved.tokenHash, session.token);
    assert.equal(saved.tokenHash, createHash("sha256").update(session.token).digest("hex"));
    await f.database.update(memberships).set({ role: "reviewer" }).where(eq(memberships.userId, actor.userId));
    await assert.rejects(auth.actor(session.token), code("invalid_worker_session"));
    await assert.rejects(auth.login(credentials), code("insufficient_scope"));
    await f.database.update(memberships).set({ role: "manager" }).where(eq(memberships.userId, actor.userId));
    await auth.logout(session.token); await assert.rejects(auth.actor(session.token), code("invalid_worker_session"));
    const expired = await auth.login(credentials);
    await f.client.query("update discovery_browser_sessions set created_at=now()-interval '9 hours',expires_at=now()-interval '1 hour'");
    await assert.rejects(auth.actor(expired.token), code("invalid_worker_session"));
  });
});

test("remote collection validates originals before writes, isolates requests, preserves immutable captures and requires human review", async () => {
  await withDiscoveryDatabase(async f => {
    await f.database.update(users).set({ email: credentials.email, passwordHash: hashPassword(credentials.password) }).where(eq(users.id, f.actor.userId));
    const token = (await browserWorkerAuth(f.database).login(credentials)).token;
    const remote = remoteBrowserService(f.database), queue = browserRequestService(f.database), service = discoveryService(f.database);
    const campaign = await f.campaign(), context = await service.getContext(localDiscoveryActor(f.actor), { contract_version: 1, campaign_id: campaign.id });
    const job = await queue.create(f.actor, { campaign_id: campaign.id, platform: "instagram", requested_count: 1, expected_context_sha256: context.context_sha256, idempotency_key: randomUUID() });
    const authorization = await queue.claim(f.actor, { request_id: job.id, browser_surface: "iab", execution_reference: "SYNTHETIC isolated remote fixture; no SNS visit" });
    await assert.rejects(remote.execute("context", token, { authorization: { ...authorization, user_id: f.other.userId } }), code("browser_worker_scope_denied"));
    await assert.rejects(remote.execute("context", token, { authorization: { ...authorization, max_creators: 2 } }), code("browser_request_not_authorized"));
    const observation = observationSample(randomUUID(), "0".repeat(64), randomUUID(), "remote"), at = observation.profile.observed_at;
    const { run_id: _run, search_log_id: _search, expected_context_sha256: _context, ...draft } = observation; void _run; void _search; void _context;
    const logs = [], captures = [];
    for (const [kind, url] of [["native_search", "https://www.instagram.com/"], ["profile_open", observation.identity.profile_url], ["content_open", observation.contents[0].url]]) {
      const content = JSON.stringify({ source_url: url, observed_at: at, visible_text: "SYNTHETIC fixture followers 12,345; views 100", ...(kind === "native_search" ? { query: "SYNTHETIC TEST ONLY" } : {}) });
      captures.push({ kind, content, sha256: createHash("sha256").update(content).digest("hex") });
      logs.push({ ...logSample(randomUUID()), event_type: kind, source_url: url, occurred_at: at });
    }
    const payload = { batch: { prepare_key: job.id, logs, observation: draft }, captures };
    await assert.rejects(remote.execute("collect", token, { authorization, payload: { ...payload, captures: captures.map((c, i) => i ? c : { ...c, sha256: "0".repeat(64) }) } }));
    assert.equal((await f.client.query("select count(*)::int n from discovery_runs")).rows[0].n, 0);
    const first = await remote.execute("collect", token, { authorization, payload });
    assert.ok("capture_id" in first); assert.ok(first.counts); assert.equal(first.counts.discovered, 1); assert.equal(first.counts.verified, 0);
    const replay = await remote.execute("collect", token, { authorization, payload }); assert.deepEqual(replay, first);
    await assert.rejects(remote.execute("collect", token, { authorization, payload: { ...payload, batch: { ...payload.batch, logs: payload.batch.logs.map((l, i) => i ? l : { ...l, message: "changed same key" }) } } }), code("idempotency_conflict"));
    assert.equal((await f.client.query("select count(*)::int n from discovery_browser_captures")).rows[0].n, 1);
    assert.equal((await f.client.query("select count(*)::int n from discovery_evidence")).rows[0].n, 2);
    await assert.rejects(f.client.query("delete from discovery_browser_captures"), sqlFailure("23514"));
    const manifest = { prepare_key: job.id, submit_key: randomUUID(), expected_lock_version: first.lock_version, outcome: "submitted", limitations: ["SYNTHETIC remote service test, no real browsing"] };
    const submitted = await remote.execute("submit", token, { authorization, payload: manifest }); assert.ok("status" in submitted); assert.equal(submitted.status, "awaiting_review");
    assert.deepEqual(await remote.execute("submit", token, { authorization, payload: manifest }), submitted);
    await assert.rejects(remote.execute("review", token, { authorization }), code("unknown_worker_action"));
    const read = await service.getRun(localDiscoveryActor(f.actor), { contract_version: 1, run_id: first.run_id });
    assert.equal(read.evidence[0].browserTraceReference, `/api/discovery/browser/captures/${first.capture_id}`);
    assert.equal(read.browser_execution_accepted, false);
  });
});

test("remote failure-only batches and cancellation preserve honest empty results", async () => {
  await withDiscoveryDatabase(async f => {
    await f.database.update(users).set({ email: credentials.email, passwordHash: hashPassword(credentials.password) }).where(eq(users.id, f.actor.userId));
    const token = (await browserWorkerAuth(f.database).login(credentials)).token, remote = remoteBrowserService(f.database), queue = browserRequestService(f.database);
    const campaign = await f.campaign(), context = await discoveryService(f.database).getContext(localDiscoveryActor(f.actor), { contract_version: 1, campaign_id: campaign.id });
    const job = await queue.create(f.actor, { campaign_id: campaign.id, platform: "instagram", requested_count: 1, expected_context_sha256: context.context_sha256, idempotency_key: randomUUID() });
    const authorization = await queue.claim(f.actor, { request_id: job.id, browser_surface: "iab", execution_reference: "SYNTHETIC access failure" });
    const payload = { batch: { prepare_key: job.id, logs: [{ ...logSample(randomUUID()), event_type: "login_required", outcome: "blocked", failure_code: "login_required" }] }, captures: [] };
    const saved = await remote.execute("collect", token, { authorization, payload }); assert.ok("counts" in saved); assert.ok(saved.counts); assert.equal(saved.counts.discovered, 0);
    await assert.rejects(remote.execute("submit", token, { authorization, payload: { prepare_key: job.id, submit_key: randomUUID(), expected_lock_version: saved.lock_version, outcome: "submitted", limitations: [] } }), code("requested_count_incomplete"));
    await queue.cancel(f.actor, job.id);
    await assert.rejects(remote.execute("collect", token, { authorization, payload }), code("browser_request_not_authorized"));
    assert.equal((await f.client.query("select count(*)::int n from creator_accounts")).rows[0].n, 0);
  });
});

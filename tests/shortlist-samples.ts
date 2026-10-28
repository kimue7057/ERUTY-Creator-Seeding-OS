import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { withDiscoveryDatabase } from "./discovery-fixture";
import { localDiscoveryActor, logSample, observationSample } from "./discovery-samples";
import { sampleEvaluation } from "./evaluation-samples";
import { RUBRIC } from "../src/lib/evaluation/contracts";
import { discoveryService } from "../src/lib/discovery/service";
import { browserRequestService } from "../src/lib/discovery/browser-requests";
import { remoteBrowserService } from "../src/lib/discovery/remote-browser";
import { browserWorkerAuth } from "../src/lib/discovery/remote-auth";
import { automaticWorkerService } from "../src/lib/discovery/automatic-worker";
import { users } from "../src/lib/db/schema";
import { hashPassword } from "../src/lib/auth/password";
type Fixture = Parameters<Parameters<typeof withDiscoveryDatabase>[0]>[0];
export async function seedShortlistCandidate(f: Fixture) {
  const campaign = await f.campaign(), discovery = discoveryService(f.database), requests = browserRequestService(f.database), remote = remoteBrowserService(f.database);
  const credentials = { email: `${randomUUID()}@example.invalid`, password: "synthetic-shortlist-contract-password" };
  await f.database.update(users).set({ email: credentials.email, passwordHash: hashPassword(credentials.password) }).where(eq(users.id, f.actor.userId));
  const token = (await browserWorkerAuth(f.database).login(credentials)).token;
  const context = await discovery.getContext(localDiscoveryActor(f.actor), { contract_version: 1, campaign_id: campaign.id });
  const request = await requests.create(f.actor, { campaign_id: campaign.id, platform: "instagram", requested_count: 1, expected_context_sha256: context.context_sha256, idempotency_key: randomUUID() });
  const auth = await requests.claim(f.actor, { request_id: request.id, browser_surface: "chrome", execution_reference: "SYNTHETIC shortlist fixture, no actual browser" });
  const sample = observationSample(randomUUID(), "0".repeat(64), randomUUID(), randomUUID().slice(0,8)), at = sample.profile.observed_at;
  // Original addresses retain casing/tracking while persisted evidence is canonical.
  sample.identity.profile_url = sample.identity.profile_url.replace("eruty_synthetic_", "ERUTY_Synthetic_");
  sample.profile.metrics[0].source_url = sample.identity.profile_url;
  sample.contents[0].url += "?utm_source=synthetic-fixture";
  sample.contents[0].metrics[0].source_url = sample.contents[0].url;
  const { run_id: _run, search_log_id: _log, expected_context_sha256: _context, ...observation } = sample; void _run; void _log; void _context;
  const captures = [], logs = [];
  for (const [kind, url] of [["native_search", "https://www.instagram.com/"], ["profile_open", sample.identity.profile_url], ["content_open", sample.contents[0].url]]) {
    const content = JSON.stringify({ source_url: url, observed_at: at, visible_text: "SYNTHETIC fixture followers 12,345; views 100", ...(kind === "native_search" ? { query: "SYNTHETIC TEST ONLY" } : {}) });
    captures.push({ kind, content, sha256: createHash("sha256").update(content).digest("hex") });
    logs.push({ ...logSample(randomUUID()), event_type: kind, source_url: url, occurred_at: at });
  }
  const saved = await remote.execute("collect", token, { authorization: auth, payload: { batch: { prepare_key: request.id, logs, observation }, captures } });
  assert.ok("creator_account_id" in saved && saved.creator_account_id && saved.evidence_ids);
  await remote.execute("submit", token, { authorization: auth, payload: { prepare_key: request.id, submit_key: randomUUID(), expected_lock_version: saved.lock_version, outcome: "submitted", limitations: ["SYNTHETIC fixture, not real SNS browsing"] } });
  const worker = { worker_id: randomUUID(), instance_id: randomUUID(), name: "SYNTHETIC assessment executor", browser_surface: "chrome" as const, platforms: ["instagram" as const], ready: true };
  await automaticWorkerService(f.database).heartbeat(f.actor, worker);
  return { campaign, accountId: saved.creator_account_id, ids: saved.evidence_ids, worker, discovery, token, remote };
}
export function goodShortlistEvaluation(id: string) {
  const output = sampleEvaluation(id); output.confidence = 0.85;
  for (const [key, max] of Object.entries(RUBRIC)) output.criteria[key as keyof typeof RUBRIC] = { score: max - 1, confidence: 0.85, reason: "SYNTHETIC supported criterion", evidence_ids: [id] };
  output.criteria.target_audience.score = null;
  return output;
}

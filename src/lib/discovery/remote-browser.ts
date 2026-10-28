import { and, eq, or, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { browserCaptureBatches, browserDiscoveryRequests } from "../db/browser-schema";
import type { ActorScope } from "../auth/permissions";
import { browserRequestService } from "./browser-requests";
import { browserWorkerAuth } from "./remote-auth";
import { codexBrowserActor, localBrowserAuthorization } from "./local-browser";
import { submissionManifest, verifyRemoteCollection } from "./browser-captures";
import { discoveryService } from "./service";
import { appendLogInput, observationInput, DiscoveryError, discoveryHash } from "./contracts";
import { automaticWorkerService } from "./automatic-worker";
import { campaignCreators, creatorAccounts, creatorAccountAliases } from "../db/discovery-schema";
import { profileIdentity } from "./urls";
import { shortlistService } from "../evaluation/shortlist";

export function remoteBrowserService(database: typeof db = db) {
  const queue = browserRequestService(database), service = discoveryService(database), authentication = browserWorkerAuth(database);
  async function scoped(actor: ActorScope, input: unknown) {
    const auth = localBrowserAuthorization.parse(input);
    if (!("request_id" in auth) || auth.user_id !== actor.userId || auth.organization_id !== actor.organizationId) throw new DiscoveryError(403, "browser_worker_scope_denied");
    const who = codexBrowserActor(auth, true);
    await service.getContext(who, { contract_version: 1, campaign_id: auth.campaign_id });
    return { auth, who };
  }
  const prepare = (auth: Extract<z.infer<typeof localBrowserAuthorization>, { request_id: string }>, who: ReturnType<typeof codexBrowserActor>) => service.prepare(who, { contract_version: 1, campaign_id: auth.campaign_id, platform: auth.platform, requested_count: auth.max_creators, time_budget_seconds: auth.execution_reference.startsWith("automatic-codex:") ? 10800 : 1800, execution_source: "codex_browser", idempotency_key: auth.request_id });
  return {
    async assessment(action: string, token: string, input: unknown) {
      const actor = await authentication.actor(token);
      if (process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED !== "true" || process.env.EVALUATION_ENABLED !== "true") throw new DiscoveryError(403, "automatic_assessment_disabled");
      const shortlist = shortlistService(database);
      if (action === "worker-assessment-next") return shortlist.next(actor, input);
      if (action === "worker-assessment-event") return shortlist.event(actor, input);
      if (action === "worker-assessment-finish") return shortlist.finish(actor, input);
      throw new DiscoveryError(404, "unknown_worker_action");
    },
    async execute(action: string, token: string, input: unknown) {
      const actor = await authentication.actor(token);
      if (action === "logout") return authentication.logout(token);
      if (action === "requests") return { browser_launched: false, requests: (await queue.list(actor)).map(({ request: job, run }) => ({ request_id: job.id, campaign_id: job.campaignId, platform: job.platform, requested_count: job.requestedCount, state: job.state, run_id: job.runId, run_status: run?.status ?? null })) };
      if (action === "claim") return queue.claim(actor, input);
      if (action.startsWith("worker-")) {
        if (process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED !== "true") throw new DiscoveryError(403, "automatic_discovery_disabled");
        const automatic = automaticWorkerService(database);
        if (action === "worker-heartbeat") return automatic.heartbeat(actor, input);
        if (action === "worker-next") return automatic.next(actor, input);
        if (action === "worker-event") return automatic.event(actor, input);
        if (action === "worker-finish") return automatic.finish(actor, input);
        throw new DiscoveryError(404, "unknown_worker_action");
      }
      const request = z.strictObject({ authorization: z.unknown(), payload: z.unknown().optional() }).parse(input);
      const { auth, who } = await scoped(actor, request.authorization);
      if (action === "context") {
        const existing = await database.select({ platform: creatorAccounts.platform, profile_url: creatorAccounts.canonicalProfileUrl, handle: creatorAccounts.currentHandle }).from(campaignCreators).innerJoin(creatorAccounts, and(eq(creatorAccounts.id, campaignCreators.creatorAccountId), eq(creatorAccounts.organizationId, actor.organizationId))).where(and(eq(campaignCreators.organizationId, actor.organizationId), eq(campaignCreators.campaignId, auth.campaign_id)));
        return { ...await service.getContext(who, { contract_version: 1, campaign_id: auth.campaign_id }), existing_campaign_accounts: existing, remote_execution: "codex_desktop_https_worker", browser_launched: false, hosted_work_called: false };
      }
      if (action === "status") {
        const run = await prepare(auth, who), result = await service.getRun(who, { contract_version: 1, run_id: run.run_id });
        return { run_id: result.run_id, status: result.status, lock_version: result.lock_version, counts: result.counts };
      }
      if (action === "collect") {
        let data: ReturnType<typeof verifyRemoteCollection>;
        try { data = verifyRemoteCollection(request.payload, auth.platform, auth.issued_at, auth.expires_at); }
        catch { throw new DiscoveryError(422, "invalid_browser_capture"); }
        if (data.batch.prepare_key !== auth.request_id) throw new DiscoveryError(403, "browser_worker_scope_denied");
        const run = await prepare(auth, who);
        const key = z.uuid().parse(data.batch.observation?.idempotency_key ?? data.batch.logs[0].idempotency_key), hash = discoveryHash(data);
        const original = await database.transaction(async tx => {
          // The same lock order as collection/cancellation prevents late capture writes.
          const [job] = await tx.select().from(browserDiscoveryRequests).where(and(eq(browserDiscoveryRequests.id, auth.request_id), eq(browserDiscoveryRequests.organizationId, actor.organizationId))).for("update");
          if (!job || job.state !== "claimed" || job.authorizationSha256 !== discoveryHash(auth)) throw new DiscoveryError(403, "browser_request_not_authorized");
          const [previous] = await tx.select().from(browserCaptureBatches).where(and(eq(browserCaptureBatches.requestId, job.id), eq(browserCaptureBatches.batchKey, key)));
          if (previous) { if (previous.payloadSha256 !== hash) throw new DiscoveryError(409, "idempotency_conflict"); return previous; }
          if (data.batch.observation) {
            const identity = observationInput.shape.identity.parse(data.batch.observation.identity), normalized = profileIdentity(auth.platform, identity.profile_url);
            const stableId = identity.platform_account_id ?? normalized.stableId;
            const [existing] = await tx.select({ firstRun: campaignCreators.firstDiscoveryRunId }).from(campaignCreators)
              .innerJoin(creatorAccounts, and(eq(creatorAccounts.id, campaignCreators.creatorAccountId), eq(creatorAccounts.organizationId, actor.organizationId)))
              .leftJoin(creatorAccountAliases, and(eq(creatorAccountAliases.accountId, creatorAccounts.id), eq(creatorAccountAliases.organizationId, actor.organizationId), isNull(creatorAccountAliases.validTo)))
              .where(and(eq(campaignCreators.organizationId, actor.organizationId), eq(campaignCreators.campaignId, auth.campaign_id), eq(creatorAccounts.platform, auth.platform),
                or(eq(creatorAccounts.canonicalProfileUrl, normalized.url), eq(creatorAccountAliases.normalizedUrl, normalized.url), ...(stableId ? [eq(creatorAccounts.platformAccountId, stableId)] : []))))
              .limit(1);
            if (existing && existing.firstRun !== run.run_id) throw new DiscoveryError(409, "candidate_already_in_campaign");
          }
          const [saved] = await tx.insert(browserCaptureBatches).values({ organizationId: actor.organizationId, requestId: job.id, runId: run.run_id, batchKey: key, payloadSha256: hash, originals: data.captures, createdBy: actor.userId }).returning();
          return saved;
        });
        let searchId: string | undefined;
        for (const log of data.batch.logs) {
          const parsed = appendLogInput.parse({ ...log, contract_version: 1, run_id: run.run_id });
          const saved = await service.appendLog(who, parsed);
          if (parsed.event_type === "native_search" && parsed.outcome === "success") searchId = saved.log_id;
        }
        const observation = data.batch.observation ? await service.record(who, observationInput.parse({ ...data.batch.observation, contract_version: 1, run_id: run.run_id, expected_context_sha256: run.context_sha256, search_log_id: searchId, work_trace_reference: null, browser_trace_reference: `/api/discovery/browser/captures/${original.id}` })) : null;
        const result = await service.getRun(who, { contract_version: 1, run_id: run.run_id, limit: 100 });
        if (observation && !result.evidence.some(e => e.creatorAccountId === observation.creator_account_id)) throw new Error("Saved observation read-back failed");
        return { execution_source: "codex_browser", run_id: result.run_id, creator_account_id: observation?.creator_account_id ?? null, evidence_ids: observation?.evidence_ids ?? [], capture_id: original.id, status: result.status, lock_version: result.lock_version, counts: result.counts, remaining: Math.max(0, auth.max_creators - result.counts.discovered), hosted_work_called: false };
      }
      if (action === "submit") {
        const manifest = submissionManifest.parse(request.payload);
        if (manifest.prepare_key !== auth.request_id) throw new DiscoveryError(403, "browser_worker_scope_denied");
        const run = await prepare(auth, who), current = await service.getRun(who, { contract_version: 1, run_id: run.run_id });
        if (manifest.outcome === "submitted" && current.counts.discovered < auth.max_creators) throw new DiscoveryError(409, "requested_count_incomplete");
        await service.submit(who, { contract_version: 1, run_id: run.run_id, expected_lock_version: manifest.expected_lock_version, outcome: manifest.outcome, limitations: manifest.limitations, idempotency_key: manifest.submit_key });
        const result = await service.getRun(who, { contract_version: 1, run_id: run.run_id, limit: 100 });
        if (process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED === "true" && process.env.EVALUATION_ENABLED === "true") {
          const accounts = [...new Set(result.evidence.map(e => e.creatorAccountId))];
          for (let i = 0; i < accounts.length; i += 3) await Promise.all(accounts.slice(i, i + 3).map(account => shortlistService(database).enqueue(actor, auth.campaign_id, account)));
        }
        return { run_id: result.run_id, status: result.status, counts: result.counts, hosted_work_called: false };
      }
      throw new DiscoveryError(404, "unknown_worker_action");
    },
  };
}

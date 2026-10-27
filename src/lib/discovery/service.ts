import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { auditEvents, campaigns, campaignBriefRevisions, memberships } from "../db/schema";
import { discoveryRuns as runs, creatorAccounts as accounts, creatorAccountAliases as aliases, discoveryEvidence as evidence, discoveryLogs as logs, campaignCreators as links, discoveryEvidenceReviews as reviews, discoveryRequests as requests, discoveryCapabilities as capabilities, type TargetingSnapshot, type DiscoveryFacts, type DISCOVERY_SOURCES } from "../db/discovery-schema";
import type { ActorScope } from "../auth/permissions";
import { DiscoveryError, appendLogInput, contextInput, discoveryHash, observationInput, prepareRunInput, readRunInput, reviewEvidenceInput, reviewRunInput, submitRunInput } from "./contracts";
import { contentUrl, profileIdentity, searchSourceUrl } from "./urls";
import { browserDiscoveryRequests, browserRunReviews } from "../db/browser-schema";
import { browserExecutionAccepted } from "./browser-review";

export type DiscoveryTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DiscoveryScope = "discovery:read" | "discovery:observe" | "discovery:submit";
export type DiscoveryActor = ActorScope & {
  principalId: string; executionSource: typeof DISCOVERY_SOURCES[number]; environmentSha256: string;
  campaignIds?: readonly string[];
  requestId?: string;
  localBrowser?: { platform: typeof import("../db/discovery-schema").DISCOVERY_PLATFORMS[number]; surface: "iab" | "chrome"; executionReference: string; maxCreators?: number; requestId?: string; expectedContextSha256?: string };
  reauthorize?: (tx: DiscoveryTransaction, campaignId: string, scope: DiscoveryScope) => Promise<void>;
};
type Run = typeof runs.$inferSelect;
type Tx = DiscoveryTransaction;
type Receipt = { contract_version: 1; actor_id: string; principal_id: string; request_id: string; payload_sha256: string; recorded_at: string; replayed: boolean };
const denied = (): never => { throw new DiscoveryError(404, "not_found_or_forbidden"); };
const principalKey = (actor: DiscoveryActor) => `${actor.executionSource}:${actor.principalId}`;
const fields = (run: Run) => ({ organizationId: run.organizationId, projectId: run.projectId, campaignId: run.campaignId, runId: run.id });
const targetOf = (campaign: typeof campaigns.$inferSelect): TargetingSnapshot => ({ countryCodes: [...campaign.countryCodes].sort(), platforms: [...campaign.platforms].sort(), categories: [...new Set(campaign.categories)].sort(), followerMin: campaign.followerMin, followerMax: campaign.followerMax, goalCount: campaign.goalCount, notes: campaign.notes, exclusions: campaign.exclusions });
const wireRun = (run: Run) => ({ contract_version: 1, run_id: run.id, campaign_id: run.campaignId, project_id: run.projectId, organization_id: run.organizationId, platform: run.platform, status: run.status, execution_source: run.executionSource, brief_version: run.briefVersion, targeting_snapshot: run.targetingSnapshot, targeting_sha256: run.targetingSha256, context_sha256: run.contextSha256, requested_count: run.requestedCount, time_budget_seconds: run.timeBudgetSeconds, lock_version: run.lockVersion, started_at: run.startedAt?.toISOString() ?? null, submitted_at: run.submittedAt?.toISOString() ?? null, ended_at: run.endedAt?.toISOString() ?? null, created_at: run.createdAt.toISOString(), limitations: run.limitations, environment: run.environmentSnapshot });

export function discoveryService(database: Pick<typeof db, "transaction"> = db) {
  const transaction = <T>(action: (tx: Tx) => Promise<T>) => database.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout = '8s'`);
    await tx.execute(sql`set local lock_timeout = '5s'`);
    return action(tx);
  });
  async function authorize(tx: Tx, actor: DiscoveryActor, campaignId: string, scope: DiscoveryScope) {
    if (actor.executionSource === "codex_browser" && (!actor.localBrowser || !actor.reauthorize)) throw new DiscoveryError(403, "local_browser_authorization_required");
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.organizationId, actor.organizationId), eq(memberships.userId, actor.userId))).for("share");
    if (!member || actor.campaignIds && !actor.campaignIds.includes(campaignId)) return denied();
    if (scope !== "discovery:read" && member.role === "reviewer") throw new DiscoveryError(403, "insufficient_scope");
    await actor.reauthorize?.(tx, campaignId, scope);
    const [campaign] = await tx.select().from(campaigns).where(and(eq(campaigns.organizationId, actor.organizationId), eq(campaigns.id, campaignId))).for("share");
    return campaign ?? denied();
  }
  async function loadRun(tx: Tx, actor: DiscoveryActor, id: string, scope: DiscoveryScope, lock = false) {
    const query = tx.select().from(runs).where(and(eq(runs.organizationId, actor.organizationId), eq(runs.id, id)));
    const [initial] = await query;
    if (!initial) return denied();
    await authorize(tx, actor, initial.campaignId, scope);
    // Request lock precedes run lock, matching dashboard cancellation.
    const run = lock ? (await query.for("update"))[0] : initial;
    if (scope !== "discovery:read" && (run.executionSource !== actor.executionSource || run.environmentSnapshot.environment_sha256 !== actor.environmentSha256)) throw new DiscoveryError(403, "principal_context_mismatch");
    return run;
  }
  async function idempotent<T extends Record<string, unknown>>(tx: Tx, actor: DiscoveryActor, tool: string, input: { idempotency_key: string }, action: () => Promise<T>): Promise<T & Receipt> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor.organizationId}), hashtext(${principalKey(actor)}))`);
    const hash = discoveryHash(input);
    const [existing] = await tx.select().from(requests).where(and(eq(requests.organizationId, actor.organizationId), eq(requests.principalKey, principalKey(actor)), eq(requests.tool, tool), eq(requests.idempotencyKey, input.idempotency_key)));
    if (existing) {
      if (existing.payloadSha256 !== hash) throw new DiscoveryError(409, "idempotency_conflict");
      return { ...existing.receipt, replayed: true } as T & Receipt;
    }
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(requests).where(and(eq(requests.organizationId, actor.organizationId), eq(requests.principalKey, principalKey(actor))));
    if (count >= 10000) throw new DiscoveryError(429, "quota_exceeded");
    const requestId = actor.requestId ?? randomUUID();
    const receipt = { ...await action(), contract_version: 1 as const, actor_id: actor.userId, principal_id: actor.principalId, request_id: requestId, payload_sha256: hash, recorded_at: new Date().toISOString(), replayed: false };
    await tx.insert(requests).values({ organizationId: actor.organizationId, actorId: actor.userId, principalKey: principalKey(actor), tool, idempotencyKey: input.idempotency_key, payloadSha256: hash, requestId, receipt });
    await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: requestId, action: `discovery.${tool}` });
    return receipt;
  }
  function writable(run: Run) {
    if (!["prepared", "collecting"].includes(run.status)) throw new DiscoveryError(409, "run_closed");
  }
  async function advance(tx: Tx, actor: DiscoveryActor, run: Run) {
    const [updated] = await tx.update(runs).set({ status: "collecting", startedAt: run.startedAt ?? new Date(), lockVersion: run.lockVersion + 1, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(runs.id, run.id)).returning();
    return updated;
  }
  function accepted(row: typeof evidence.$inferSelect, reviewRows: typeof reviews.$inferSelect[]) {
    const relevant = reviewRows.filter(review => review.evidenceId === row.id);
    if (!relevant.length) return false;
    const latest = Math.max(...relevant.map(review => review.createdAt.getTime()));
    // Conflicting reviews with an identical timestamp fail closed.
    return relevant.filter(review => review.createdAt.getTime() === latest).every(review => review.verdict === "accepted");
  }
  async function runFacts(tx: Tx, run: Run) {
    const observed = await tx.select().from(evidence).where(and(eq(evidence.organizationId, run.organizationId), eq(evidence.runId, run.id)));
    const attempts = await tx.select().from(logs).where(and(eq(logs.organizationId, run.organizationId), eq(logs.runId, run.id)));
    const reviewRows = await tx.select().from(reviews).where(and(eq(reviews.organizationId, run.organizationId), eq(reviews.runId, run.id)));
    const executionReviews = run.executionSource === "codex_browser" ? await tx.select().from(browserRunReviews).where(and(eq(browserRunReviews.organizationId, run.organizationId), eq(browserRunReviews.runId, run.id))) : [];
    const profiles = observed.filter(row => row.kind === "profile_observation").sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime() || b.recordedAt.getTime() - a.recordedAt.getTime());
    const unique = new Set(profiles.map(row => row.creatorAccountId));
    const verifiedAccounts = [...unique].filter(id => {
      const profile = profiles.find(row => row.creatorAccountId === id)!;
      const search = attempts.find(log => log.id === profile.searchLogId);
      const provenance = run.executionSource === "work_manual_task" && run.environmentSnapshot.work_connection === "reviewed" && !!run.capabilityReceiptId && !!run.workTaskReference && !!profile.workTraceReference
        || browserExecutionAccepted(run, executionReviews) && !!profile.browserTraceReference;
      return provenance && profile.observationMethod === "sns_browser" && profile.facts.opened_directly
        && search?.eventType === "native_search" && search.outcome === "success" && accepted(profile, reviewRows)
        && profile.facts.metrics.some(metric => ["followers", "subscribers"].includes(metric.name) && metric.value !== null && !!metric.raw_display)
        && observed.some(row => row.creatorAccountId === id && row.kind === "content_observation" && row.payloadSha256 === profile.payloadSha256 && row.facts.opened_directly && !!row.facts.recent_basis && (run.executionSource !== "codex_browser" || row.browserTraceReference === profile.browserTraceReference) && accepted(row, reviewRows));
    });
    return { verifiedAccounts, counts: { discovered: unique.size, observations: profiles.length, verified: verifiedAccounts.length, duplicate_observations: profiles.length - unique.size, failures: attempts.filter(log => log.eventType !== "staff_review" && ["failed", "blocked"].includes(log.outcome)).length, native_searches: attempts.filter(log => log.eventType === "native_search" && log.outcome === "success").length, content_observations: observed.filter(row => row.kind === "content_observation").length } };
  }
  async function summary(tx: Tx, run: Run) { return (await runFacts(tx, run)).counts; }
  async function projectAccountReview(tx: Tx, actor: DiscoveryActor, row: typeof evidence.$inferSelect) {
    const [latest] = await tx.select().from(evidence).where(and(eq(evidence.organizationId, actor.organizationId), eq(evidence.campaignId, row.campaignId), eq(evidence.creatorAccountId, row.creatorAccountId), eq(evidence.kind, "profile_observation"))).orderBy(desc(evidence.observedAt), desc(evidence.recordedAt), desc(evidence.id)).limit(1);
    if (!latest) return;
    const [run] = await tx.select().from(runs).where(and(eq(runs.organizationId, actor.organizationId), eq(runs.id, latest.runId)));
    const eligible = (await runFacts(tx, run)).verifiedAccounts.includes(row.creatorAccountId);
    await tx.update(links).set({ discoveryState: eligible ? "direct_sns_verified" : "verification_pending", updatedBy: actor.userId, updatedAt: new Date() }).where(and(eq(links.organizationId, actor.organizationId), eq(links.campaignId, row.campaignId), eq(links.creatorAccountId, row.creatorAccountId)));
  }
  async function context(tx: Tx, actor: DiscoveryActor, input: unknown) {
    const data = contextInput.parse(input), campaign = await authorize(tx, actor, data.campaign_id, "discovery:read");
    const version = data.brief_version ?? campaign.briefVersion;
    const [brief] = await tx.select().from(campaignBriefRevisions).where(and(eq(campaignBriefRevisions.organizationId, actor.organizationId), eq(campaignBriefRevisions.campaignId, campaign.id), eq(campaignBriefRevisions.version, version)));
    if (!brief) return denied();
    const targeting = targetOf(campaign), snapshot = brief.snapshot;
    // Storage paths and pre-signed URLs are never returned by the discovery context.
    const safeBrief = { ...snapshot, assets: snapshot.assets.map(asset => ({ id: asset.id, name: asset.name, kind: asset.kind, version: asset.version, version_id: asset.versionId ?? null, sha256: asset.sha256 ?? null, mime_type: asset.mimeType ?? null, byte_size: asset.byteSize ?? null })) };
    return { contract_version: 1, campaign_id: campaign.id, project_id: campaign.projectId, organization_id: actor.organizationId, brief_version: version, brief: safeBrief, targeting_snapshot: targeting, targeting_sha256: discoveryHash(targeting), context_sha256: discoveryHash({ schema_version: 1, brief_version: version, brief: snapshot, targeting }), work_connection: "unverified", remote_execution: "not_supported_or_unverified" };
  }
  return {
    getContext: (actor: DiscoveryActor, input: unknown) => transaction(tx => context(tx, actor, input)),
    prepare: (actor: DiscoveryActor, input: unknown) => transaction(async tx => {
      const data = prepareRunInput.parse(input);
      const campaign = await authorize(tx, actor, data.campaign_id, "discovery:observe");
      if (data.execution_source !== actor.executionSource) throw new DiscoveryError(403, "execution_source_not_allowed");
      return idempotent(tx, actor, "prepare_run", data, async () => {
        if (!campaign.platforms.includes(data.platform) || campaign.status === "archived") throw new DiscoveryError(400, "targeting_platform_mismatch");
        let capabilityId: string | null = null;
        let initialValidation = false;
        if (actor.executionSource === "codex_browser") {
          if (data.work_task_reference || data.platform !== actor.localBrowser?.platform || data.requested_count !== (actor.localBrowser?.requestId ? actor.localBrowser.maxCreators : 1)) throw new DiscoveryError(403, "local_browser_scope_denied");
          const [{ used }] = await tx.select({ used: sql<number>`count(*)::int` }).from(runs).where(and(eq(runs.organizationId, actor.organizationId), eq(runs.executionSource, "codex_browser"), sql`${runs.environmentSnapshot}->>'local_authorization_id' = ${actor.principalId}`));
          if (used) throw new DiscoveryError(409, "local_browser_authorization_consumed");
        }
        if (actor.executionSource === "work_manual_task") {
          if (!data.work_task_reference) throw new DiscoveryError(400, "work_trace_required");
          const checks = await tx.select().from(capabilities).where(and(eq(capabilities.organizationId, actor.organizationId), eq(capabilities.platform, data.platform), eq(capabilities.environmentSha256, actor.environmentSha256))).orderBy(desc(capabilities.createdAt));
          const native = checks.find(c => c.kind === "sns_native_search"), mcp = checks.find(c => c.kind === "work_mcp_write");
          const ready = native && native.verdict !== "blocked" && native.facts.native_search && native.facts.direct_profiles >= 1 && native.facts.recent_content_profiles >= 1 && mcp?.verdict === "verified";
          if (ready) capabilityId = native.id;
          else {
            // A distinct, operator-authorized one-run experiment is not a verified
            // capability. Its grant/environment/campaign stay pinned and every
            // observation remains pending even after ordinary evidence review.
            const permit = checks.find(c => c.kind === "initial_validation" && c.verdict === "partial" && c.facts.initial_validation?.grant_id === actor.principalId && c.facts.initial_validation.campaign_id === campaign.id);
            const limits = permit?.facts.initial_validation;
            if (!actor.reauthorize || native?.verdict === "blocked" || mcp?.verdict === "blocked" || !permit || !limits || !Number.isFinite(Date.parse(limits.expires_at)) || Date.parse(limits.expires_at) <= Date.now() || !Number.isInteger(limits.max_creators) || limits.max_creators < 1 || limits.max_creators > 5 || data.requested_count > limits.max_creators) throw new DiscoveryError(409, "unverified_capability");
            const [{ used }] = await tx.select({ used: sql<number>`count(*)::int` }).from(runs).where(eq(runs.capabilityReceiptId, permit.id));
            if (used) throw new DiscoveryError(409, "initial_validation_consumed");
            capabilityId = permit.id;
            initialValidation = true;
          }
        }
        const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(runs).where(and(eq(runs.organizationId, actor.organizationId), eq(runs.campaignId, campaign.id)));
        if (count >= 1000) throw new DiscoveryError(429, "quota_exceeded");
        const current = await context(tx, actor, { contract_version: 1, campaign_id: campaign.id });
        if (actor.localBrowser?.expectedContextSha256 && current.context_sha256 !== actor.localBrowser.expectedContextSha256) throw new DiscoveryError(409, "stale_context");
        const [run] = await tx.insert(runs).values({ organizationId: actor.organizationId, projectId: campaign.projectId, campaignId: campaign.id, briefVersion: current.brief_version, platform: data.platform, executionSource: actor.executionSource, targetingSnapshot: current.targeting_snapshot, targetingSha256: current.targeting_sha256, contextSha256: current.context_sha256, requestedCount: data.requested_count, timeBudgetSeconds: data.time_budget_seconds, workTaskReference: data.work_task_reference, capabilityReceiptId: capabilityId, environmentSnapshot: { environment_sha256: actor.environmentSha256, work_connection: actor.executionSource === "work_manual_task" && !initialValidation ? "reviewed" : "unverified", ...(initialValidation ? { initial_validation: true } : {}), ...(actor.executionSource === "codex_browser" && actor.localBrowser ? { browser_connection: "unverified" as const, browser_surface: actor.localBrowser.surface, local_authorization_id: actor.principalId, execution_reference: actor.localBrowser.executionReference } : {}) }, createdBy: actor.userId, updatedBy: actor.userId }).returning();
        if (actor.localBrowser?.requestId) await tx.update(browserDiscoveryRequests).set({ runId: run.id, updatedAt: new Date() }).where(and(eq(browserDiscoveryRequests.organizationId, actor.organizationId), eq(browserDiscoveryRequests.id, actor.localBrowser.requestId)));
        return wireRun(run);
      });
    }),
    appendLog: (actor: DiscoveryActor, input: unknown) => transaction(async tx => {
      const data = appendLogInput.parse(input), run = await loadRun(tx, actor, data.run_id, "discovery:observe", true);
      const normalized = { ...data, source_url: data.source_url ? searchSourceUrl(run.platform, data.source_url, data.event_type === "supplemental_web") : null };
      return idempotent(tx, actor, "append_log", normalized, async () => {
        writable(run);
        if (data.parent_log_id) {
          const [parent] = await tx.select().from(logs).where(and(eq(logs.organizationId, actor.organizationId), eq(logs.runId, run.id), eq(logs.id, data.parent_log_id)));
          if (!parent) return denied();
        }
        const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(logs).where(eq(logs.runId, run.id));
        if (count >= 10000) throw new DiscoveryError(429, "quota_exceeded");
        const [log] = await tx.insert(logs).values({ ...fields(run), sequence: count + 1, eventType: data.event_type, outcome: data.outcome, occurredAt: new Date(data.occurred_at), sourceUrl: normalized.source_url, query: data.query, parentLogId: data.parent_log_id, failureCode: data.failure_code, message: data.message, correlationId: actor.requestId ?? randomUUID(), createdBy: actor.userId }).returning();
        const updated = await advance(tx, actor, run);
        return { run_id: run.id, campaign_id: run.campaignId, log_id: log.id, sequence: log.sequence, status: updated.status, lock_version: updated.lockVersion };
      });
    }),
    record: (actor: DiscoveryActor, input: unknown) => transaction(async tx => {
      const data = observationInput.parse(input), run = await loadRun(tx, actor, data.run_id, "discovery:observe", true);
      if (data.identity.platform !== run.platform) throw new DiscoveryError(400, "targeting_platform_mismatch");
      const identity = profileIdentity(run.platform, data.identity.profile_url);
      const stableId = data.identity.platform_account_id ?? identity.stableId;
      if (stableId && !(run.platform === "youtube" ? /^UC[A-Za-z0-9_-]{22}$/ : /^[0-9]{1,30}$/).test(stableId) || identity.stableId && identity.stableId !== stableId) throw new DiscoveryError(400, "invalid_stable_identity");
      if (data.identity.handle && identity.handle && data.identity.handle.replace(/^@/, "").normalize("NFC").toLowerCase() !== identity.handle.toLowerCase()) throw new DiscoveryError(400, "identity_conflict");
      const followerName = run.platform === "youtube" ? "subscribers" : "followers";
      for (const metric of data.profile.metrics) {
        if (metric.name !== followerName || profileIdentity(run.platform, metric.source_url).url !== identity.url) throw new DiscoveryError(400, "metric_source_mismatch");
        metric.source_url = identity.url;
      }
      for (const content of data.contents) {
        content.url = contentUrl(run.platform, content.url);
        if (run.platform === "tiktok" && !content.url.startsWith(`${identity.url}/`)) throw new DiscoveryError(400, "content_account_mismatch");
        for (const metric of content.metrics) {
          if (!["views", "likes", "comments"].includes(metric.name) || contentUrl(run.platform, metric.source_url) !== content.url) throw new DiscoveryError(400, "metric_source_mismatch");
          metric.source_url = content.url;
        }
        if (content.published_at && Date.parse(content.published_at) > Date.parse(content.observed_at) + 300000) throw new DiscoveryError(400, "invalid_published_time");
      }
      if (new Set(data.contents.map(c => c.url)).size !== data.contents.length) throw new DiscoveryError(400, "duplicate_content");
      const normalized = { ...data, identity: { ...data.identity, profile_url: identity.url, platform_account_id: stableId } };
      return idempotent(tx, actor, "record_observation", normalized, async () => {
        writable(run);
        if (data.expected_context_sha256 !== run.contextSha256) throw new DiscoveryError(409, "stale_context");
        const [search] = await tx.select().from(logs).where(and(eq(logs.organizationId, actor.organizationId), eq(logs.runId, run.id), eq(logs.id, data.search_log_id)));
        if (!search || !["native_search", "supplemental_web"].includes(search.eventType)) return denied();
        if (data.profile.opened_directly && search.outcome !== "success") throw new DiscoveryError(400, "search_not_successful");
        if (run.executionSource === "work_manual_task" && !data.work_trace_reference) throw new DiscoveryError(400, "work_trace_required");
        if (run.executionSource === "codex_browser" && (!data.browser_trace_reference || data.work_trace_reference || !data.profile.opened_directly || !data.contents.some(content => content.opened_directly))) throw new DiscoveryError(400, "browser_trace_required");
        if (run.executionSource !== "codex_browser" && data.browser_trace_reference) throw new DiscoveryError(400, "unexpected_browser_trace");
        const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(evidence).where(and(eq(evidence.runId, run.id), eq(evidence.kind, "profile_observation")));
        if (count >= run.requestedCount * 3) throw new DiscoveryError(429, "quota_exceeded");
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor.organizationId}), hashtext(${run.platform}))`);
        const [alias] = await tx.select().from(aliases).where(and(eq(aliases.organizationId, actor.organizationId), eq(aliases.platform, run.platform), eq(aliases.normalizedUrl, identity.url), isNull(aliases.validTo)));
        const [byStable] = stableId ? await tx.select().from(accounts).where(and(eq(accounts.organizationId, actor.organizationId), eq(accounts.platform, run.platform), eq(accounts.platformAccountId, stableId))) : [];
        if (alias && byStable && alias.accountId !== byStable.id) throw new DiscoveryError(409, "identity_conflict");
        const [byAlias] = alias ? await tx.select().from(accounts).where(and(eq(accounts.organizationId, actor.organizationId), eq(accounts.id, alias.accountId))) : [];
        let account = byStable ?? byAlias;
        if (account && (account.identityState === "merged" || account.identityState === "conflict" || stableId && account.platformAccountId && stableId !== account.platformAccountId)) throw new DiscoveryError(409, "identity_conflict");
        const observed = new Date(data.profile.observed_at);
        if (account) {
          [account] = await tx.update(accounts).set({ platformAccountId: account.platformAccountId ?? stableId, identityState: account.platformAccountId || stableId ? "resolved" : "provisional", ...(observed >= account.lastSeenAt ? { canonicalProfileUrl: identity.url, currentHandle: identity.handle, displayName: data.identity.display_name, lastSeenAt: observed } : {}), updatedBy: actor.userId, updatedAt: new Date() }).where(eq(accounts.id, account.id)).returning();
        } else {
          [account] = await tx.insert(accounts).values({ organizationId: actor.organizationId, platform: run.platform, platformAccountId: stableId, canonicalProfileUrl: identity.url, currentHandle: identity.handle, displayName: data.identity.display_name, identityState: stableId ? "resolved" : "provisional", firstSeenAt: observed, lastSeenAt: observed, createdBy: actor.userId, updatedBy: actor.userId }).returning();
        }
        if (run.environmentSnapshot.initial_validation || run.executionSource === "codex_browser") {
          const previous = await tx.selectDistinct({ accountId: evidence.creatorAccountId }).from(evidence).where(and(eq(evidence.runId, run.id), eq(evidence.kind, "profile_observation")));
          if (!previous.some(row => row.accountId === account.id) && previous.length >= run.requestedCount) throw new DiscoveryError(429, "quota_exceeded");
        }
        if (data.supersedes_evidence_id) {
          const [old] = await tx.select().from(evidence).where(and(eq(evidence.organizationId, actor.organizationId), eq(evidence.campaignId, run.campaignId), eq(evidence.creatorAccountId, account.id), eq(evidence.id, data.supersedes_evidence_id)));
          if (!old) return denied();
        }
        const follower = data.profile.metrics.find(m => m.name === followerName);
        const targeting: NonNullable<DiscoveryFacts["targeting"]> = {
          followers: !follower || follower.value === null || follower.precision !== "exact" ? "unknown" : follower.value >= run.targetingSnapshot.followerMin && follower.value <= run.targetingSnapshot.followerMax ? "match" : "outside",
          country: !data.profile.country.code || !data.profile.country.basis ? "unknown" : run.targetingSnapshot.countryCodes.includes(data.profile.country.code) ? "match" : "outside",
          category: data.profile.categories.length === 0 ? "unknown" : data.profile.categories.some(c => run.targetingSnapshot.categories.includes(c)) ? "match" : "outside",
        };
        const method: typeof evidence.$inferInsert.observationMethod = run.executionSource === "codex_test" ? "codex_test" : run.executionSource === "manual_import" ? "manual_import" : data.profile.opened_directly ? "sns_browser" : "supplemental_web";
        const common = { ...fields(run), creatorAccountId: account.id, platform: run.platform, observationMethod: method, profileUrl: identity.url, limitations: data.profile.limitations, searchLogId: search.id, workTraceReference: data.work_trace_reference, browserTraceReference: data.browser_trace_reference ?? null, payloadSha256: discoveryHash(normalized), createdBy: actor.userId };
        const [profile] = await tx.insert(evidence).values({ ...common, kind: "profile_observation", sourceUrl: identity.url, observedAt: observed, supersedesId: data.supersedes_evidence_id, facts: { schema_version: 1, opened_directly: data.profile.opened_directly, identity: { handle: data.identity.handle?.replace(/^@/, "") ?? identity.handle, display_name: data.identity.display_name, platform_account_id: stableId }, metrics: data.profile.metrics, note: data.profile.match_notes, country: data.profile.country, categories: data.profile.categories, audience_country: "unknown", targeting } }).returning();
        const ids = [profile.id];
        for (const content of data.contents) {
          const [row] = await tx.insert(evidence).values({ ...common, kind: "content_observation", sourceUrl: content.url, observedAt: new Date(content.observed_at), publishedAt: content.published_at ? new Date(content.published_at) : null, facts: { schema_version: 1, opened_directly: content.opened_directly, metrics: content.metrics, note: content.note, recent_basis: content.recent_basis, audience_country: "unknown" } }).returning();
          ids.push(row.id);
        }
        if (!alias) await tx.insert(aliases).values({ organizationId: actor.organizationId, platform: run.platform, accountId: account.id, normalizedUrl: identity.url, evidenceId: profile.id, createdBy: actor.userId });
        const [previousLink] = await tx.select().from(links).where(and(eq(links.organizationId, actor.organizationId), eq(links.campaignId, run.campaignId), eq(links.creatorAccountId, account.id)));
        const link = previousLink ?? (await tx.insert(links).values({ organizationId: actor.organizationId, projectId: run.projectId, campaignId: run.campaignId, creatorAccountId: account.id, firstDiscoveryRunId: run.id, firstEvidenceId: profile.id, createdBy: actor.userId, updatedBy: actor.userId }).returning())[0];
        // A newly observed/revised account must be reviewed again; another campaign is unaffected.
        if (previousLink?.discoveryState === "direct_sns_verified") await tx.update(links).set({ discoveryState: "verification_pending", updatedBy: actor.userId, updatedAt: new Date() }).where(eq(links.id, link.id));
        const updated = await advance(tx, actor, run);
        return { run_id: run.id, campaign_id: run.campaignId, creator_account_id: account.id, campaign_creator_id: link.id, evidence_ids: ids, verification_state: "verification_pending", reused_campaign_creator: !!previousLink, targeting, lock_version: updated.lockVersion };
      });
    }),
    submit: (actor: DiscoveryActor, input: unknown) => transaction(async tx => {
      const data = submitRunInput.parse(input), run = await loadRun(tx, actor, data.run_id, "discovery:submit", true);
      return idempotent(tx, actor, "submit_run", data, async () => {
        writable(run);
        if (run.status !== "collecting" || data.expected_lock_version !== run.lockVersion) throw new DiscoveryError(409, "stale_context");
        const counts = await summary(tx, run);
        const limitations = [...data.limitations, ...(data.outcome === "submitted" ? [] : [`Reported outcome: ${data.outcome}`])];
        const [updated] = await tx.update(runs).set({ status: "awaiting_review", submittedAt: new Date(), outcomeSummary: counts, limitations, lockVersion: run.lockVersion + 1, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(runs.id, run.id)).returning();
        return { ...wireRun(updated), counts };
      });
    }),
    getRun: (actor: DiscoveryActor, input: unknown) => transaction(async tx => {
      const data = readRunInput.parse(input), run = await loadRun(tx, actor, data.run_id, "discovery:read");
      const entries = await tx.select().from(logs).where(and(eq(logs.organizationId, actor.organizationId), eq(logs.runId, run.id), sql`${logs.sequence} > ${data.cursor}`)).orderBy(logs.sequence).limit(data.limit + 1);
      const facts = await tx.select().from(evidence).where(and(eq(evidence.organizationId, actor.organizationId), eq(evidence.runId, run.id))).orderBy(evidence.recordedAt, evidence.id).limit(data.limit + 1).offset(data.evidence_cursor);
      await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: run.id, action: "discovery.run_read" });
      const browserReviews = run.executionSource === "codex_browser" ? await tx.select().from(browserRunReviews).where(and(eq(browserRunReviews.organizationId, actor.organizationId), eq(browserRunReviews.runId, run.id))).orderBy(desc(browserRunReviews.createdAt), desc(browserRunReviews.id)) : [];
      return { ...wireRun(run), counts: await summary(tx, run), browser_execution_accepted: browserExecutionAccepted(run, browserReviews), browser_reviews: browserReviews, logs: entries.slice(0, data.limit), next_cursor: entries.length > data.limit ? entries[data.limit - 1].sequence : null, evidence: facts.slice(0, data.limit), next_evidence_cursor: facts.length > data.limit ? data.evidence_cursor + data.limit : null, work_connection: "unverified" };
    }),
    reviewBrowserExecution: (actor: DiscoveryActor, input: unknown) => transaction(async tx => {
      const data = reviewRunInput.omit({ verdict: true }).extend({ verdict: z.enum(["accepted", "rejected", "needs_review"]), browser_evidence_checked: z.boolean() }).parse(input);
      if (actor.reauthorize || actor.principalId !== actor.userId) throw new DiscoveryError(403, "staff_review_required");
      const run = await loadRun(tx, actor, data.run_id, "discovery:read", true);
      if (data.campaign_id && data.campaign_id !== run.campaignId) return denied();
      await authorize(tx, actor, run.campaignId, "discovery:observe");
      if (run.executionSource !== "codex_browser" || run.status !== "awaiting_review" || run.lockVersion !== data.expected_lock_version) throw new DiscoveryError(409, "stale_context");
      const counts = await summary(tx, run);
      if (data.verdict === "accepted" && (!data.browser_evidence_checked || !counts.discovered || !counts.native_searches)) throw new DiscoveryError(409, "browser_execution_evidence_required");
      const [review] = await tx.insert(browserRunReviews).values({ ...fields(run), contextSha256: run.contextSha256, environmentSha256: run.environmentSnapshot.environment_sha256, verdict: data.verdict, reason: data.reason, reviewedBy: actor.userId }).returning();
      await tx.update(runs).set({ lockVersion: run.lockVersion + 1, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(runs.id, run.id));
      const profiles = await tx.select().from(evidence).where(and(eq(evidence.organizationId, actor.organizationId), eq(evidence.runId, run.id), eq(evidence.kind, "profile_observation")));
      for (const row of profiles) await projectAccountReview(tx, actor, row);
      await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: review.id, action: `discovery.browser_execution_${data.verdict}` });
      return { review_id: review.id, verdict: review.verdict };
    }),
    reviewEvidence: (actor: DiscoveryActor, input: unknown) => transaction(async tx => {
      const data = reviewEvidenceInput.parse(input);
      if (actor.reauthorize || actor.principalId !== actor.userId) throw new DiscoveryError(403, "staff_review_required");
      const [row] = await tx.select().from(evidence).where(and(eq(evidence.organizationId, actor.organizationId), eq(evidence.id, data.evidence_id)));
      if (!row) return denied();
      if ((data.campaign_id && data.campaign_id !== row.campaignId) || (data.creator_account_id && data.creator_account_id !== row.creatorAccountId)) return denied();
      const run = await loadRun(tx, actor, row.runId, "discovery:read", true);
      if (!["collecting", "awaiting_review"].includes(run.status)) throw new DiscoveryError(409, "run_closed");
      await authorize(tx, actor, row.campaignId, "discovery:observe");
      const [review] = await tx.insert(reviews).values({ organizationId: row.organizationId, projectId: row.projectId, campaignId: row.campaignId, runId: row.runId, evidenceId: row.id, verdict: data.verdict, reason: data.reason, reviewedBy: actor.userId, createdAt: new Date() }).returning();
      await projectAccountReview(tx, actor, row);
      await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: row.id, action: `discovery.evidence_${data.verdict}` });
      return { review_id: review.id, evidence_id: row.id, verdict: review.verdict, created_at: review.createdAt.toISOString() };
    }),
    reviewRun: (actor: DiscoveryActor, input: unknown) => transaction(async tx => {
      const data = reviewRunInput.parse(input);
      if (actor.reauthorize || actor.principalId !== actor.userId) throw new DiscoveryError(403, "staff_review_required");
      const run = await loadRun(tx, actor, data.run_id, "discovery:read", true);
      if (data.campaign_id && data.campaign_id !== run.campaignId) return denied();
      await authorize(tx, actor, run.campaignId, "discovery:observe");
      if (run.status !== "awaiting_review" || run.lockVersion !== data.expected_lock_version) throw new DiscoveryError(409, "stale_context");
      const counts = await summary(tx, run);
      if (data.verdict === "completed" && (counts.verified < run.requestedCount || counts.verified !== counts.discovered || counts.failures > 0 || counts.native_searches === 0)) throw new DiscoveryError(409, "insufficient_verified_evidence");
      const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(logs).where(eq(logs.runId, run.id));
      await tx.insert(logs).values({ ...fields(run), sequence: count + 1, eventType: "staff_review", outcome: data.verdict === "completed" ? "success" : data.verdict === "partial" ? "partial" : data.verdict, occurredAt: new Date(), message: data.reason, correlationId: randomUUID(), createdBy: actor.userId });
      const [updated] = await tx.update(runs).set({ status: data.verdict, reviewedAt: new Date(), endedAt: new Date(), outcomeSummary: counts, lockVersion: run.lockVersion + 1, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(runs.id, run.id)).returning();
      await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: run.id, action: `discovery.run_reviewed_${data.verdict}` });
      return { ...wireRun(updated), counts };
    }),
  };
}

import { and, desc, eq, inArray, sql, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { auditEvents, campaigns } from "../db/schema";
import { campaignCreators, creatorAccounts, discoveryEvidence, discoveryEvidenceReviews } from "../db/discovery-schema";
import { browserRunReviews, browserDiscoveryRequests } from "../db/browser-schema";
import { discoveryWorkers, discoveryExecutions } from "../db/worker-schema";
import { creatorAssessments as jobs } from "../db/assessment-schema";
import { creatorEvaluations, evaluationReviews } from "../db/evaluation-schema";
import type { ActorScope } from "../auth/permissions";
import { discoveryHash, DiscoveryError } from "../discovery/contracts";
import { EvaluationError, evaluationOutput, evaluationReason, validateScores } from "./contracts";
import { evaluationContext, evaluationMember, type EvaluationContext } from "./service";
import { assessmentFingerprint, automaticAssessmentSnapshot, campaignConstraintMismatch, shortlistRecommendation, SHORTLIST_POLICY } from "./shortlist-policy";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const lease = z.object({ worker_id: z.uuid(), instance_id: z.uuid() });
const scope = (actor: ActorScope, campaignId: string, accountId?: string) => and(eq(jobs.organizationId, actor.organizationId), eq(jobs.campaignId, campaignId), accountId ? eq(jobs.creatorAccountId, accountId) : undefined);
import { assessmentSourceEligible as sourceEligible } from "./assessment-evidence";

export function shortlistService(database: typeof db = db) {
  const transaction = <T>(run: (tx: Tx) => Promise<T>) => database.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout='15s'`); await tx.execute(sql`set local lock_timeout='5s'`); return run(tx);
  });
  async function enqueue(tx: Tx, actor: ActorScope, campaignId: string, accountId: string) {
    const current = await evaluationContext(tx, actor, campaignId, accountId, true);
    if (current.campaign.status === "archived") throw new EvaluationError("evaluation_campaign_archived");
    const fingerprint = assessmentFingerprint(current.snapshot);
    const eligible = await sourceEligible(tx, actor, current);
    const [job] = await tx.insert(jobs).values({ organizationId: actor.organizationId, campaignId, creatorAccountId: accountId,
      inputSha256: fingerprint, inputSnapshot: automaticAssessmentSnapshot(current.snapshot), sourceEligible: eligible ? "yes" : "no", createdBy: actor.userId }).onConflictDoNothing().returning();
    await tx.update(jobs).set({ state: "cancelled", errorCode: "evaluation_stale_input", updatedAt: new Date() }).where(and(scope(actor, campaignId, accountId), eq(jobs.state, "queued"), sql`${jobs.inputSha256}<>${fingerprint}`));
    return job;
  }
  async function host(tx: Tx, actor: ActorScope, data: z.infer<typeof lease>) {
    await evaluationMember(tx, actor, true);
    const [worker] = await tx.select().from(discoveryWorkers).where(and(eq(discoveryWorkers.id, data.worker_id), eq(discoveryWorkers.organizationId, actor.organizationId), eq(discoveryWorkers.userId, actor.userId))).for("update");
    if (!worker || worker.instanceId !== data.instance_id || worker.lastSeenAt.getTime() < Date.now() - 45000) throw new DiscoveryError(409, "worker_lease_expired");
    return worker;
  }
  async function currentJob(tx: Tx, actor: ActorScope, input: unknown) {
    const data = lease.extend({ assessment_id: z.uuid() }).parse(input); await host(tx, actor, data);
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, data.assessment_id), eq(jobs.organizationId, actor.organizationId), eq(jobs.workerId, data.worker_id), eq(jobs.instanceId, data.instance_id))).for("update");
    if (!job) throw new EvaluationError("assessment_not_found");
    return job;
  }
  async function loadBoards(tx: Tx, actor: ActorScope, campaignIds: string[]) {
    z.array(z.uuid()).max(100).parse(campaignIds); await evaluationMember(tx, actor);
    if (!campaignIds.length) return [];
    const selectedCampaigns = await tx.select().from(campaigns).where(and(eq(campaigns.organizationId, actor.organizationId), inArray(campaigns.id, campaignIds)));
    const ranked = tx.select({ campaignId: campaignCreators.campaignId, id: creatorAccounts.id, name: creatorAccounts.displayName, handle: creatorAccounts.currentHandle, platform: creatorAccounts.platform, url: creatorAccounts.canonicalProfileUrl,
      position: sql<number>`row_number() over (partition by ${campaignCreators.campaignId} order by ${creatorAccounts.id})`.as("position") }).from(campaignCreators)
      .innerJoin(creatorAccounts, and(eq(creatorAccounts.id, campaignCreators.creatorAccountId), eq(creatorAccounts.organizationId, actor.organizationId)))
      .where(and(eq(campaignCreators.organizationId, actor.organizationId), inArray(campaignCreators.campaignId, campaignIds))).as("ranked");
    const accounts = await tx.select().from(ranked).where(sql`${ranked.position}<=200`);
    const assessments = await tx.selectDistinctOn([jobs.campaignId, jobs.creatorAccountId], { ...getTableColumns(jobs),
      // Raw original screen text is needed by the worker, not these read views.
      inputSnapshot: sql<(typeof jobs.$inferSelect)["inputSnapshot"]>`jsonb_set(${jobs.inputSnapshot}, '{evidence}', coalesce((select jsonb_agg(item - 'source_material') from jsonb_array_elements(${jobs.inputSnapshot}->'evidence') item), '[]'::jsonb))` }).from(jobs).where(and(eq(jobs.organizationId, actor.organizationId), inArray(jobs.campaignId, campaignIds))).orderBy(jobs.campaignId, jobs.creatorAccountId, desc(jobs.createdAt), desc(jobs.id));
    const ids = assessments.flatMap(job => job.evaluationId ? [job.evaluationId] : []);
    const evaluations = ids.length ? await tx.select().from(creatorEvaluations).where(and(eq(creatorEvaluations.organizationId, actor.organizationId), inArray(creatorEvaluations.id, ids), eq(creatorEvaluations.promptVersion, "campaign-shortlist-v1"))) : [];
    const decisions = ids.length ? await tx.selectDistinctOn([evaluationReviews.evaluationId]).from(evaluationReviews).where(and(eq(evaluationReviews.organizationId, actor.organizationId), inArray(evaluationReviews.evaluationId, ids))).orderBy(evaluationReviews.evaluationId, desc(evaluationReviews.createdAt), desc(evaluationReviews.id)) : [];
    const observations = await tx.select({ campaignId: discoveryEvidence.campaignId, account: discoveryEvidence.creatorAccountId, id: discoveryEvidence.id, payload: discoveryEvidence.payloadSha256, runId: discoveryEvidence.runId }).from(discoveryEvidence).where(and(eq(discoveryEvidence.organizationId, actor.organizationId), inArray(discoveryEvidence.campaignId, campaignIds)));
    const evidenceReviews = await tx.selectDistinctOn([discoveryEvidenceReviews.evidenceId]).from(discoveryEvidenceReviews).where(and(eq(discoveryEvidenceReviews.organizationId, actor.organizationId), inArray(discoveryEvidenceReviews.campaignId, campaignIds))).orderBy(discoveryEvidenceReviews.evidenceId, desc(discoveryEvidenceReviews.createdAt), desc(discoveryEvidenceReviews.id));
    const runReviews = await tx.selectDistinctOn([browserRunReviews.runId]).from(browserRunReviews).where(and(eq(browserRunReviews.organizationId, actor.organizationId), inArray(browserRunReviews.campaignId, campaignIds))).orderBy(browserRunReviews.runId, desc(browserRunReviews.createdAt), desc(browserRunReviews.id));
    const cancelled = await tx.select({ runId: browserDiscoveryRequests.runId }).from(browserDiscoveryRequests).where(and(eq(browserDiscoveryRequests.organizationId, actor.organizationId), inArray(browserDiscoveryRequests.campaignId, campaignIds), eq(browserDiscoveryRequests.state, "cancelled")));
    const byAccount = (campaign: string, account: string) => campaign + "/" + account;
    const jobMap = new Map(assessments.map(job => [byAccount(job.campaignId, job.creatorAccountId), job]));
    const evaluationMap = new Map(evaluations.map(e => [e.id, e]));
    const decisionMap = new Map(decisions.map(d => [d.evaluationId, d]));
    const evidenceMap = new Map<string, typeof observations>();
    for (const e of observations) { const key = byAccount(e.campaignId, e.account!); const group = evidenceMap.get(key) ?? []; group.push(e); evidenceMap.set(key, group); }
    const evidenceVerdicts = new Map(evidenceReviews.map(r => [r.evidenceId, r.verdict]));
    const runVerdicts = new Map(runReviews.map(r => [r.runId, r.verdict]));
    const cancelledRuns = new Set(cancelled.map(r => r.runId));
    return selectedCampaigns.map(campaign => ({ campaign_id: campaign.id, campaign_title: campaign.title, archived: campaign.status === "archived", policy: SHORTLIST_POLICY, candidates: accounts.filter(a => a.campaignId === campaign.id).map(account => {
      const job = jobMap.get(byAccount(campaign.id, account.id)), evaluation = job?.evaluationId ? evaluationMap.get(job.evaluationId) : undefined, decision = evaluation ? decisionMap.get(evaluation.id) : undefined;
      const snapshot = job?.inputSnapshot as EvaluationContext["snapshot"] | undefined;
      const currentEvidence = evidenceMap.get(byAccount(campaign.id, account.id)) ?? [];
      const adverse = currentEvidence.some(e => (evidenceVerdicts.has(e.id) && evidenceVerdicts.get(e.id) !== "accepted") || (runVerdicts.has(e.runId) && runVerdicts.get(e.runId) !== "accepted") || cancelledRuns.has(e.runId));
      const stale = !!snapshot && (job?.inputSnapshot.assessment_stage !== "before_final_human_review" || snapshot.brief_version !== campaign.briefVersion || snapshot.creator.display_name !== account.name || snapshot.creator.handle !== account.handle || snapshot.creator.profile_url !== account.url || discoveryHash(snapshot.targeting) !== discoveryHash({ country_codes: campaign.countryCodes, platforms: campaign.platforms, categories: campaign.categories, follower_min: campaign.followerMin, follower_max: campaign.followerMax, notes: campaign.notes, exclusions: campaign.exclusions }) || currentEvidence.length !== snapshot.evidence.length || currentEvidence.some(e => !snapshot.evidence.some(s => s.id === e.id && s.payload_sha256 === e.payload)));
      const invalidDecision = stale || adverse && decision?.verdict === "approved";
      return { ...account, assessment_id: job?.id ?? null, state: stale ? "stale" : job?.state ?? "unassessed", error_code: job?.errorCode ?? null, retryable: !stale && job?.state === "failed" && job.attempts < 3,
        can_select: !stale && !adverse && campaign.status !== "archived" && job?.state === "completed" && job.sourceEligible === "yes",
        recommendation: adverse ? "needs_info" : job?.recommendation ?? null, verdict: invalidDecision ? null : decision?.verdict ?? null, decision: invalidDecision || !decision ? null : { reason: decision.reason, at: decision.createdAt.toISOString() }, source_warning: adverse, evaluation: evaluation ? { id: evaluation.id, total: evaluation.total, known_subtotal: evaluation.knownSubtotal, unknown_count: evaluation.unknownCount, output: evaluation.output } : null,
        evidence: snapshot?.evidence.map(e => ({ id: e.id, kind: e.kind, url: e.source_url, observed_at: e.observed_at, facts: e.facts, limitations: e.limitations })) ?? [] };
    }) }));
  }
  return {
    enqueue: (actor: ActorScope, campaignId: string, accountId: string) => transaction(tx => enqueue(tx, actor, campaignId, accountId)),
    enqueueCampaign: async (actor: ActorScope, campaignId: string) => {
      z.uuid().parse(campaignId);
      const accounts = await transaction(async tx => { await evaluationMember(tx, actor, true); return tx.select({ id: campaignCreators.creatorAccountId }).from(campaignCreators).where(and(eq(campaignCreators.organizationId, actor.organizationId), eq(campaignCreators.campaignId, campaignId))).limit(200); });
      let queued = 0;
      for (let i = 0; i < accounts.length; i += 3) {
        const results = await Promise.all(accounts.slice(i, i + 3).map(account => transaction(tx => enqueue(tx, actor, campaignId, account.id))));
        queued += results.filter(Boolean).length;
      }
      return { queued };
    },
    next: (actor: ActorScope, input: unknown) => transaction(async tx => {
      const data = lease.parse(input), worker = await host(tx, actor, data);
      const busy = await tx.select().from(discoveryExecutions).where(and(eq(discoveryExecutions.workerId, worker.id), inArray(discoveryExecutions.state, ["starting", "running"])));
      if (busy.length || worker.ready !== "ready") return { assignment: null };
      // Expired leases are visible failures; restarting never silently repeats a
      // paid assessment. A user can explicitly retry a failed item.
      await tx.update(jobs).set({ state: "failed", errorCode: "assessment_interrupted", updatedAt: new Date() }).where(and(eq(jobs.organizationId, actor.organizationId), eq(jobs.state, "running"), sql`${jobs.updatedAt}<now()-interval '2 minutes'`));
      const [active] = await tx.select().from(jobs).where(and(eq(jobs.workerId, worker.id), eq(jobs.state, "running")));
      if (active) return { assignment: null };
      const [cap] = await tx.select().from(jobs).where(and(eq(jobs.organizationId, actor.organizationId), eq(jobs.state, "failed"), eq(jobs.errorCode, "workspace_spend_cap"), sql`${jobs.updatedAt}>now()-interval '30 minutes'`)).orderBy(desc(jobs.updatedAt)).limit(1);
      if (cap) {
        const [resumed] = await tx.select().from(jobs).where(and(eq(jobs.organizationId, actor.organizationId), sql`${jobs.updatedAt}>${cap.updatedAt}`, sql`(${jobs.state}='completed' or (${jobs.state}='queued' and ${jobs.attempts}>0))`)).limit(1);
        if (!resumed) return { assignment: null };
      }
      const [job] = await tx.select().from(jobs).where(and(eq(jobs.organizationId, actor.organizationId), eq(jobs.state, "queued"))).orderBy(jobs.createdAt, jobs.id).limit(1).for("update", { skipLocked: true });
      if (!job) return { assignment: null };
      const current = await evaluationContext(tx, actor, job.campaignId, job.creatorAccountId, true);
      if (current.campaign.status === "archived" || assessmentFingerprint(current.snapshot) !== job.inputSha256 || job.sourceEligible === "yes" && !await sourceEligible(tx, actor, current)) {
        await tx.update(jobs).set({ state: "cancelled", errorCode: "evaluation_stale_input", updatedAt: new Date() }).where(eq(jobs.id, job.id));
        if (current.campaign.status !== "archived") await enqueue(tx, actor, job.campaignId, job.creatorAccountId);
        return { assignment: null };
      }
      await tx.update(jobs).set({ state: "running", workerId: worker.id, instanceId: worker.instanceId, attempts: job.attempts + 1, updatedAt: new Date() }).where(eq(jobs.id, job.id));
      return { assignment: { assessment_id: job.id, snapshot: job.inputSnapshot } };
    }),
    event: (actor: ActorScope, input: unknown) => transaction(async tx => {
      const job = await currentJob(tx, actor, input);
      const current = await evaluationContext(tx, actor, job.campaignId, job.creatorAccountId, true);
      const cancelled = job.state !== "running" || current.campaign.status === "archived" || assessmentFingerprint(current.snapshot) !== job.inputSha256 || job.sourceEligible === "yes" && !await sourceEligible(tx, actor, current);
      if (job.state === "running") await tx.update(jobs).set({ ...(cancelled ? { state: "cancelled" as const, errorCode: "evaluation_stale_input" } : {}), updatedAt: new Date() }).where(eq(jobs.id, job.id));
      return { cancelled };
    }),
    finish: (actor: ActorScope, input: unknown) => transaction(async tx => {
      const data = lease.extend({ assessment_id: z.uuid(), output: z.unknown().optional(), error_code: z.enum(["cli_failed", "workspace_spend_cap", "execution_timeout", "invalid_assessment"]).nullable() }).parse(input);
      const job = await currentJob(tx, actor, data);
      if (job.state === "completed") return { state: job.state, evaluation_id: job.evaluationId };
      if (job.state !== "running") throw new EvaluationError("assessment_closed");
      if (data.error_code) { await tx.update(jobs).set({ state: "failed", errorCode: data.error_code, updatedAt: new Date() }).where(eq(jobs.id, job.id)); return { state: "failed" }; }
      const current = await evaluationContext(tx, actor, job.campaignId, job.creatorAccountId, true);
      if (current.campaign.status === "archived" || assessmentFingerprint(current.snapshot) !== job.inputSha256) throw new EvaluationError("evaluation_stale_input");
      const result = validateScores(data.output, current.snapshot.evidence.map(e => e.id));
      const eligible = await sourceEligible(tx, actor, current);
      const mismatch = campaignConstraintMismatch(current.snapshot);
      const output = evaluationOutput.parse({ ...result.output, risk_flags: [...new Set(["audience_country_unverified", ...(mismatch ? [mismatch] : []), ...(!eligible ? ["source_verification_required"] : []), ...result.output.risk_flags])].slice(0, 15) });
      const [evaluation] = await tx.insert(creatorEvaluations).values({ organizationId: actor.organizationId, projectId: current.campaign.projectId, campaignId: job.campaignId, creatorAccountId: job.creatorAccountId,
        briefVersion: current.campaign.briefVersion, inputSha256: job.inputSha256, inputSnapshot: job.inputSnapshot, payloadSha256: discoveryHash(output), idempotencyKey: job.id,
        source: "codex_import", model: "codex-cli/configured-default", promptVersion: "campaign-shortlist-v1", output, total: result.total, knownSubtotal: result.knownSubtotal, unknownCount: result.unknownCount, createdBy: actor.userId }).returning();
      await tx.update(jobs).set({ state: "completed", recommendation: mismatch ? "excluded" : shortlistRecommendation(output, result.knownSubtotal, result.unknownCount, eligible), evaluationId: evaluation.id, updatedAt: new Date() }).where(eq(jobs.id, job.id));
      await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: evaluation.id, action: "evaluation.automatically_assessed" });
      return { state: "completed", evaluation_id: evaluation.id };
    }),
    retry: (actor: ActorScope, campaignId: string, id: string) => transaction(async tx => {
      await evaluationMember(tx, actor, true); z.uuid().parse(id);
      const [job] = await tx.select().from(jobs).where(and(scope(actor, campaignId), eq(jobs.id, id))).for("update");
      if (!job || job.state !== "failed" || job.attempts >= 3) throw new EvaluationError("assessment_retry_unavailable");
      const current = await evaluationContext(tx, actor, campaignId, job.creatorAccountId, true);
      if (current.campaign.status === "archived") throw new EvaluationError("evaluation_campaign_archived");
      if (assessmentFingerprint(current.snapshot) !== job.inputSha256) { await enqueue(tx, actor, campaignId, job.creatorAccountId); return; }
      await tx.update(jobs).set({ state: "queued", errorCode: null, workerId: null, instanceId: null, updatedAt: new Date() }).where(eq(jobs.id, id));
    }),
    review: (actor: ActorScope, campaignId: string, input: unknown) => transaction(async tx => {
      const data = z.strictObject({ assessment_id: z.uuid(), idempotency_key: z.uuid(), verdict: z.enum(["approved", "hold", "rejected"]), reason: evaluationReason.or(z.literal("")), acknowledged: z.boolean() }).parse(input);
      await evaluationMember(tx, actor, true);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor.organizationId}),hashtext(${actor.userId + data.idempotency_key}))`);
      const payload = discoveryHash({ ...data, campaignId });
      const [saved] = await tx.select().from(evaluationReviews).where(and(eq(evaluationReviews.organizationId, actor.organizationId), eq(evaluationReviews.createdBy, actor.userId), eq(evaluationReviews.idempotencyKey, data.idempotency_key)));
      if (saved) { if (saved.payloadSha256 !== payload) throw new EvaluationError("evaluation_idempotency_conflict"); return saved; }
      const [job] = await tx.select().from(jobs).where(and(scope(actor, campaignId), eq(jobs.id, data.assessment_id)));
      if (!job || job.state !== "completed" || !job.evaluationId) throw new EvaluationError("assessment_not_found");
      const current = await evaluationContext(tx, actor, campaignId, job.creatorAccountId, true);
      const [latest] = await tx.select().from(jobs).where(scope(actor, campaignId, job.creatorAccountId)).orderBy(desc(jobs.createdAt), desc(jobs.id)).limit(1);
      if (current.campaign.status === "archived" || latest.id !== job.id || assessmentFingerprint(current.snapshot) !== job.inputSha256) throw new EvaluationError("evaluation_stale_input");
      if (data.verdict === "approved") {
        if (!data.acknowledged) throw new EvaluationError("evaluation_unknowns_acknowledgement_required");
        if (job.recommendation !== "recommended" && data.reason.trim().length < 5) throw new EvaluationError("evaluation_human_reason_required");
        if (!await sourceEligible(tx, actor, current)) throw new EvaluationError("evaluation_discovery_pending");
      }
      const [decision] = await tx.insert(evaluationReviews).values({ organizationId: actor.organizationId, evaluationId: job.evaluationId, verdict: data.verdict, reason: data.reason || "평가·SNS 원본·미확인 사항을 확인한 사용자 판정입니다.",
        unknownsAcknowledged: data.acknowledged ? "yes" : "no", idempotencyKey: data.idempotency_key, payloadSha256: payload, createdBy: actor.userId }).returning();
      await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: decision.id, action: `evaluation.${data.verdict}` });
      return decision;
    }),
    boards: (actor: ActorScope, campaignIds: string[]) => transaction(tx => loadBoards(tx, actor, campaignIds)),
    board: (actor: ActorScope, campaignId: string) => transaction(async tx => {
      const [board] = await loadBoards(tx, actor, [campaignId]);
      if (!board) throw new EvaluationError("evaluation_not_found");
      return board;
    }),
  };
}
export type ShortlistBoard = Awaited<ReturnType<ReturnType<typeof shortlistService>["board"]>>;

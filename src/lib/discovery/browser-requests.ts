import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { memberships, campaigns, auditEvents } from "../db/schema";
import { browserDiscoveryRequests as jobs } from "../db/browser-schema";
import { discoveryRuns as runs } from "../db/discovery-schema";
import type { ActorScope } from "../auth/permissions";
import { DiscoveryError, discoveryHash, platformSchema, privateReference } from "./contracts";
import { discoveryService, type DiscoveryTransaction } from "./service";
import { discoveryStaff } from "./staff";
import { localBrowserAuthorization } from "./local-browser";

export const browserRequestInput = z.strictObject({ campaign_id: z.uuid(), platform: platformSchema, requested_count: z.number().int().min(1).max(20), expected_context_sha256: z.string().regex(/^[a-f0-9]{64}$/), idempotency_key: z.uuid() });
async function member(tx: DiscoveryTransaction, actor: ActorScope, write = false) {
  const [row] = await tx.select().from(memberships).where(and(eq(memberships.organizationId, actor.organizationId), eq(memberships.userId, actor.userId))).for("share");
  if (!row || write && row.role === "reviewer") throw new DiscoveryError(403, "insufficient_scope");
}
export function browserRequestPrompt(id: string) {
  return `$eruty-codex-discovery 스킬로 발굴 요청 ${id}를 진행해 주세요. 실제 구현 저장소에서 requests/claim 명령으로 요청과 고정 캠페인 조건을 읽고, SNS 내부 검색·프로필·최근 콘텐츠를 직접 확인해 collect로 후보를 순차 저장한 뒤 submit해 주세요. 접근 실패는 그대로 기록하고, 목표를 채우려고 후보나 지표를 만들지 마세요. 사람의 근거 검토·실행 검토·최종 승인과 외부 연락은 수행하지 마세요.`;
}
export function browserRequestService(database: Pick<typeof db, "transaction"> = db) {
  const transaction = <T>(action: (tx: DiscoveryTransaction) => Promise<T>) => database.transaction(async tx => { await tx.execute(sql`set local statement_timeout='8s'`); await tx.execute(sql`set local lock_timeout='5s'`); return action(tx); });
  const read = async (tx: DiscoveryTransaction, actor: ActorScope, id: string, lock = false) => {
    z.uuid().parse(id); await member(tx, actor, lock);
    const query = tx.select().from(jobs).where(and(eq(jobs.organizationId, actor.organizationId), eq(jobs.id, id)));
    const [job] = await (lock ? query.for("update") : query);
    if (!job) throw new DiscoveryError(404, "not_found_or_forbidden"); return job;
  };
  return {
    list: (actor: ActorScope, campaignId?: string) => transaction(async tx => {
      await member(tx, actor); if (campaignId) z.uuid().parse(campaignId);
      return tx.select({ request: jobs, run: runs, collected: sql<number>`(select count(distinct creator_account_id)::int from discovery_evidence where organization_id=${jobs.organizationId} and run_id=${jobs.runId} and kind='profile_observation')` }).from(jobs).leftJoin(runs, and(eq(runs.organizationId, jobs.organizationId), eq(runs.id, jobs.runId))).where(and(eq(jobs.organizationId, actor.organizationId), campaignId ? eq(jobs.campaignId, campaignId) : undefined)).orderBy(desc(jobs.createdAt)).limit(30);
    }),
    create: async (actor: ActorScope, input: unknown) => {
      const data = browserRequestInput.parse(input);
      return transaction(async tx => {
        await member(tx, actor, true);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor.organizationId}), hashtext(${actor.userId + data.idempotency_key}))`);
        const [old] = await tx.select().from(jobs).where(and(eq(jobs.organizationId, actor.organizationId), eq(jobs.createdBy, actor.userId), eq(jobs.idempotencyKey, data.idempotency_key)));
        if (old) {
          if (old.campaignId !== data.campaign_id || old.platform !== data.platform || old.requestedCount !== data.requested_count || old.contextSha256 !== data.expected_context_sha256) throw new DiscoveryError(409, "idempotency_conflict");
          return old;
        }
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor.organizationId}), hashtext(${data.campaign_id + ":browser-queue"}))`);
        // Use this transaction for the context so a campaign edit cannot race request creation.
        const current = await discoveryService({ transaction: async action => action(tx) }).getContext(discoveryStaff(actor), { contract_version: 1, campaign_id: data.campaign_id });
        const [campaign] = await tx.select().from(campaigns).where(and(eq(campaigns.organizationId, actor.organizationId), eq(campaigns.id, data.campaign_id)));
        if (campaign.status === "archived" || !campaign.platforms.includes(data.platform)) throw new DiscoveryError(400, "targeting_platform_mismatch");
        if (current.context_sha256 !== data.expected_context_sha256) throw new DiscoveryError(409, "stale_context");
        const [{ active }] = await tx.select({ active: sql<number>`count(*)::int` }).from(jobs).where(and(eq(jobs.organizationId, actor.organizationId), eq(jobs.campaignId, campaign.id), eq(jobs.state, "queued")));
        if (active >= 20) throw new DiscoveryError(429, "quota_exceeded");
        const [job] = await tx.insert(jobs).values({ organizationId: actor.organizationId, projectId: campaign.projectId, campaignId: campaign.id, platform: data.platform, requestedCount: data.requested_count, contextSha256: current.context_sha256, targetingSnapshot: current.targeting_snapshot, idempotencyKey: data.idempotency_key, createdBy: actor.userId }).returning();
        await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: job.id, action: "discovery.browser_requested" }); return job;
      });
    },
    claim: (actor: ActorScope, input: unknown) => transaction(async tx => {
      const data = z.strictObject({ request_id: z.uuid(), browser_surface: z.enum(["iab", "chrome"]), execution_reference: privateReference }).parse(input);
      const job = await read(tx, actor, data.request_id, true);
      if (job.state === "cancelled") throw new DiscoveryError(409, "browser_request_cancelled");
      if (job.state === "claimed" && (job.claimedBy !== actor.userId || job.browserSurface !== data.browser_surface || job.executionReference !== data.execution_reference)) throw new DiscoveryError(409, "browser_request_claimed");
      const now = new Date(), expires = job.expiresAt ?? new Date(now.getTime() + 4 * 3600000), issued = job.claimedAt ?? now;
      if (expires <= now) throw new DiscoveryError(403, "local_browser_authorization_expired");
      const auth = localBrowserAuthorization.parse({ authorization_id: job.id, request_id: job.id, organization_id: actor.organizationId, user_id: actor.userId, campaign_id: job.campaignId, platform: job.platform, browser_surface: data.browser_surface, execution_reference: data.execution_reference, issued_at: issued.toISOString(), expires_at: expires.toISOString(), max_creators: job.requestedCount, expected_context_sha256: job.contextSha256, confirmation: "authorize-codex-browser-request" });
      if (job.state === "queued") {
        await tx.update(jobs).set({ state: "claimed", claimedBy: actor.userId, claimedAt: issued, expiresAt: expires, browserSurface: data.browser_surface, executionReference: data.execution_reference, authorizationSha256: discoveryHash(auth), updatedAt: now }).where(eq(jobs.id, job.id));
        await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: job.id, action: "discovery.browser_claimed" });
      }
      return auth;
    }),
    cancel: (actor: ActorScope, id: string) => transaction(async tx => {
      const job = await read(tx, actor, id, true); if (job.state === "cancelled") return job;
      if (job.runId) {
        const [run] = await tx.select().from(runs).where(and(eq(runs.organizationId, actor.organizationId), eq(runs.id, job.runId))).for("update");
        if (!["prepared", "collecting"].includes(run.status)) throw new DiscoveryError(409, "run_closed");
        await tx.update(runs).set({ status: "cancelled", endedAt: new Date(), lockVersion: run.lockVersion + 1, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(runs.id, run.id));
      }
      const [saved] = await tx.update(jobs).set({ state: "cancelled", updatedAt: new Date() }).where(eq(jobs.id, job.id)).returning();
      await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: job.id, action: "discovery.browser_cancelled" }); return saved;
    }),
  };
}

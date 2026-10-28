import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { memberships } from "../db/schema";
import { discoveryWorkers as workers, discoveryExecutions as executions } from "../db/worker-schema";
import { browserDiscoveryRequests as jobs } from "../db/browser-schema";
import { discoveryRuns as runs } from "../db/discovery-schema";
import type { ActorScope } from "../auth/permissions";
import { DiscoveryError, platformSchema } from "./contracts";
import { browserRequestService } from "./browser-requests";
import { discoveryService, type DiscoveryTransaction } from "./service";
import { codexBrowserActor } from "./local-browser";
const lease = z.strictObject({ worker_id: z.uuid(), instance_id: z.uuid() });
const active = ["starting", "running"] as const;
const fresh = (at: Date) => at.getTime() > Date.now() - 45000;
export function automaticWorkerService(database: typeof db = db) {
  async function member(tx: DiscoveryTransaction, actor: ActorScope, write = true) {
    const [row] = await tx.select().from(memberships).where(and(eq(memberships.organizationId, actor.organizationId), eq(memberships.userId, actor.userId))).for("share");
    if (!row || write && row.role === "reviewer") throw new DiscoveryError(403, "insufficient_scope");
  }
  async function worker(tx: DiscoveryTransaction, actor: ActorScope, input: z.infer<typeof lease>) {
    await member(tx, actor);
    const [row] = await tx.select().from(workers).where(and(eq(workers.id, input.worker_id), eq(workers.organizationId, actor.organizationId), eq(workers.userId, actor.userId))).for("update");
    if (!row || row.instanceId !== input.instance_id || !fresh(row.lastSeenAt)) throw new DiscoveryError(409, "worker_lease_expired");
    return row;
  }
  return {
    heartbeat: (actor: ActorScope, input: unknown) => database.transaction(async tx => {
      const data = lease.extend({ name: z.string().trim().min(1).max(80), browser_surface: z.enum(["iab", "chrome"]), platforms: z.array(platformSchema).min(1).max(3), ready: z.boolean() }).parse(input);
      await member(tx, actor);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"codex-worker"}), hashtext(${data.worker_id}))`);
      const [old] = await tx.select().from(workers).where(eq(workers.id, data.worker_id)).for("update");
      if (old && (old.organizationId !== actor.organizationId || old.userId !== actor.userId)) throw new DiscoveryError(403, "worker_scope_denied");
      if (old && old.instanceId !== data.instance_id && fresh(old.lastSeenAt)) throw new DiscoveryError(409, "worker_already_online");
      if (old && old.instanceId !== data.instance_id) await tx.update(executions).set({ state: "interrupted", errorCode: "worker_restarted", finishedAt: new Date(), updatedAt: new Date() }).where(and(eq(executions.workerId, old.id), inArray(executions.state, [...active])));
      const values = { organizationId: actor.organizationId, userId: actor.userId, instanceId: data.instance_id, name: data.name, browserSurface: data.browser_surface, platforms: [...new Set(data.platforms)], ready: data.ready ? "ready" as const : "unavailable" as const, lastSeenAt: new Date() };
      await tx.insert(workers).values({ id: data.worker_id, ...values }).onConflictDoUpdate({ target: workers.id, set: values });
      return { online: data.ready };
    }),
    next: (actor: ActorScope, input: unknown) => database.transaction(async tx => {
      const data = lease.parse(input), host = await worker(tx, actor, data);
      if (host.ready !== "ready") throw new DiscoveryError(409, "browser_unavailable");
      const [busy] = await tx.select().from(executions).where(and(eq(executions.workerId, host.id), inArray(executions.state, [...active])));
      if (busy) {
        const [currentJob] = await tx.select().from(jobs).where(eq(jobs.id, busy.requestId));
        if (currentJob.state === "cancelled") {
          await tx.update(executions).set({ state: "cancelled", finishedAt: new Date(), updatedAt: new Date() }).where(eq(executions.id, busy.id));
          return { assignment: null, busy: false };
        }
        if (busy.instanceId === host.instanceId && busy.state === "starting") {
          const authorization = await browserRequestService({ transaction: async action => action(tx) }).claim(actor, { request_id: busy.requestId, browser_surface: host.browserSurface, execution_reference: `automatic-codex:${busy.id}` });
          const [job] = await tx.select().from(jobs).where(eq(jobs.id, busy.requestId));
          return { assignment: { execution_id: busy.id, request_id: job.id, authorization, run_id: job.runId }, busy: true };
        }
        return { assignment: null, busy: true };
      }
      const [job] = await tx.select().from(jobs).where(and(eq(jobs.organizationId, actor.organizationId), eq(jobs.state, "queued"), inArray(jobs.platform, host.platforms as ("instagram" | "tiktok" | "youtube")[]), sql`not exists(select 1 from discovery_browser_executions where request_id=${jobs.id})`)).orderBy(jobs.createdAt).limit(1).for("update", { skipLocked: true });
      if (!job) return { assignment: null, busy: false };
      const id = randomUUID();
      let assigned;
      try { assigned = await tx.transaction(async nested => {
        const adapter = { transaction: async <T>(fn: (tx: DiscoveryTransaction) => Promise<T>) => fn(nested) };
        const authorization = await browserRequestService(adapter).claim(actor, { request_id: job.id, browser_surface: host.browserSurface, execution_reference: `automatic-codex:${id}` });
        const run = await discoveryService(adapter).prepare(codexBrowserActor(authorization, true), { contract_version: 1, campaign_id: job.campaignId, platform: job.platform, requested_count: job.requestedCount, time_budget_seconds: 10800, execution_source: "codex_browser", idempotency_key: job.id });
        return { authorization, run };
      }); } catch (error) {
        if (!(error instanceof DiscoveryError)) throw error;
        await tx.insert(executions).values({ id, organizationId: actor.organizationId, requestId: job.id, workerId: host.id, instanceId: host.instanceId, state: "failed", errorCode: error.code, finishedAt: new Date() });
        return { assignment: null, busy: false };
      }
      const { authorization, run } = assigned;
      await tx.insert(executions).values({ id, organizationId: actor.organizationId, requestId: job.id, workerId: host.id, instanceId: host.instanceId });
      return { assignment: { execution_id: id, request_id: job.id, authorization, run_id: run.run_id }, busy: true };
    }),
    event: (actor: ActorScope, input: unknown) => database.transaction(async tx => {
      const data = lease.extend({ execution_id: z.uuid(), phase: z.enum(["preparing", "browsing", "saving", "finishing"]) }).parse(input);
      const host = await worker(tx, actor, data);
      const [row] = await tx.select().from(executions).where(and(eq(executions.id, data.execution_id), eq(executions.workerId, host.id), eq(executions.organizationId, actor.organizationId), eq(executions.instanceId, host.instanceId))).for("update");
      if (!row || !active.includes(row.state as typeof active[number])) throw new DiscoveryError(409, "execution_closed");
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, row.requestId));
      if (job.state === "cancelled") return { cancelled: true };
      await tx.update(executions).set({ state: "running", phase: data.phase, updatedAt: new Date() }).where(eq(executions.id, row.id));
      return { cancelled: false };
    }),
    finish: (actor: ActorScope, input: unknown) => database.transaction(async tx => {
      const data = lease.extend({ execution_id: z.uuid(), exit_code: z.number().int(), error_code: z.enum(["cli_failed", "execution_timeout", "browser_unavailable", "result_not_submitted"]).nullable() }).parse(input);
      const host = await worker(tx, actor, data);
      const [row] = await tx.select().from(executions).where(and(eq(executions.id, data.execution_id), eq(executions.workerId, host.id), eq(executions.organizationId, actor.organizationId), eq(executions.instanceId, host.instanceId))).for("update");
      if (!row) throw new DiscoveryError(404, "not_found_or_forbidden");
      if (!active.includes(row.state as typeof active[number])) return { state: row.state };
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, row.requestId));
      const [run] = await tx.select().from(runs).where(and(eq(runs.id, job.runId!), eq(runs.organizationId, actor.organizationId)));
      const [{ collected }] = await tx.execute(sql`select count(distinct creator_account_id)::int collected from discovery_evidence where organization_id=${actor.organizationId} and run_id=${job.runId} and kind='profile_observation'`).then(r => r.rows as {collected: number}[]);
      const reported = run?.limitations.find(x => x.startsWith("Reported outcome: "))?.replace("Reported outcome: ", "");
      const state = job.state === "cancelled" ? "cancelled" : run?.status === "awaiting_review" ? reported === "blocked" ? "blocked" : reported === "failed" ? "failed" : collected < job.requestedCount ? "partial" : "completed" : ["blocked", "failed", "partial"].includes(run?.status) ? run.status as "blocked" | "failed" | "partial" : "failed";
      await tx.update(executions).set({ state, phase: "finishing", finishedAt: new Date(), updatedAt: new Date(), errorCode: state === "failed" ? data.error_code ?? (data.exit_code ? "cli_failed" : "result_not_submitted") : null }).where(eq(executions.id, row.id));
      return { state };
    }),
    snapshot: async (actor: ActorScope, campaignId: string) => {
      z.uuid().parse(campaignId);
      const requests = await browserRequestService(database).list(actor, campaignId);
      const hosts = await database.select().from(workers).where(eq(workers.organizationId, actor.organizationId)).orderBy(desc(workers.lastSeenAt));
      const attempts = await database.select().from(executions).where(and(eq(executions.organizationId, actor.organizationId), requests.length ? inArray(executions.requestId, requests.map(x => x.request.id)) : sql`false`));
      return { online: hosts.some(h => fresh(h.lastSeenAt) && h.ready === "ready"), workers: hosts.map(h => ({ name: h.name, online: fresh(h.lastSeenAt) && h.ready === "ready" })), requests: requests.map(({ request: job, run, collected }) => {
        const attempt = attempts.find(x => x.requestId === job.id), disconnected = attempt && active.includes(attempt.state as typeof active[number]) && !hosts.some(h => h.id === attempt.workerId && h.instanceId === attempt.instanceId && fresh(h.lastSeenAt));
        return { id: job.id, platform: job.platform, requested: job.requestedCount, collected, run_id: job.runId, run_status: run?.status ?? null, state: job.state === "cancelled" ? "cancelled" : disconnected ? "interrupted" : attempt?.state ?? (run?.submittedAt ? collected >= job.requestedCount ? "completed" : "partial" : job.state === "claimed" ? "running" : "queued"), phase: attempt?.phase ?? null, error_code: disconnected ? "worker_disconnected" : attempt?.errorCode ?? null };
      }) };
    },
  };
}

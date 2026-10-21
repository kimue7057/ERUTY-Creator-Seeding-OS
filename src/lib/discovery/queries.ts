import { and, desc, eq, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { campaigns, projects, memberships } from "../db/schema";
import { discoveryRuns, discoveryEvidence, discoveryEvidenceReviews, discoveryCapabilities, creatorAccounts, campaignCreators, type DiscoveryFacts, type DiscoveryPlatform } from "../db/discovery-schema";
import type { ActorScope } from "../auth/permissions";
import { DiscoveryError, platformSchema } from "./contracts";
export const discoveryFilters = z.strictObject({ platform: platformSchema.optional(), category: z.string().trim().max(100).optional(), state: z.enum(["verification_pending", "direct_sns_verified", "blocked", "duplicate"]).optional(), source: z.enum(["work_manual_task", "manual_import", "codex_test"]).optional(), min: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), max: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), page: z.coerce.number().int().min(1).max(100000).default(1) }).refine(value => value.min === undefined || value.max === undefined || value.min <= value.max, "Maximum followers must be at least minimum");
export type DiscoveryFilters = z.infer<typeof discoveryFilters>;
export type CreatorRow = { account_id: string; campaign_creator_id: string; platform: DiscoveryPlatform; profile_url: string; handle: string | null; display_name: string | null; state: typeof campaignCreators.$inferSelect.discoveryState; run_id: string; execution_source: typeof discoveryRuns.$inferSelect.executionSource; evidence_id: string; observed_at: Date; facts: DiscoveryFacts; followers: string | null; follower_precision: string | null; total_count: number };
const PAGE_SIZE = 25;
export function discoveryQueries(database: Pick<typeof db, "transaction"> = db) {
  const transaction = <T>(actor: ActorScope, run: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) => database.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout = '8s'`);
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.organizationId, actor.organizationId), eq(memberships.userId, actor.userId))).for("share");
    if (!member) throw new DiscoveryError(404, "not_found_or_forbidden");
    return run(tx);
  });
  return {
    campaigns: (actor: ActorScope) => transaction(actor, tx => tx.select({ id: campaigns.id, title: campaigns.title, projectName: projects.name, platforms: campaigns.platforms,
      runCount: sql<number>`(select count(*)::int from discovery_runs r where r.organization_id = ${campaigns.organizationId} and r.campaign_id = ${campaigns.id})`,
      creatorCount: sql<number>`(select count(*)::int from campaign_creators c where c.organization_id = ${campaigns.organizationId} and c.campaign_id = ${campaigns.id})`,
    }).from(campaigns).innerJoin(projects, and(eq(projects.id, campaigns.projectId), eq(projects.organizationId, campaigns.organizationId))).where(eq(campaigns.organizationId, actor.organizationId)).orderBy(desc(campaigns.updatedAt)).limit(100)),
    dashboard: (actor: ActorScope, campaignId: string, input: unknown = {}) => transaction(actor, async tx => {
      z.uuid().parse(campaignId); const filters = discoveryFilters.parse(input);
      const [campaign] = await tx.select().from(campaigns).where(and(eq(campaigns.organizationId, actor.organizationId), eq(campaigns.id, campaignId)));
      if (!campaign) return null;
      const result = await tx.execute<CreatorRow>(sql`
        select a.id as account_id,c.id as campaign_creator_id,a.platform,e.profile_url,a.current_handle as handle,a.display_name,c.discovery_state as state,
          r.id as run_id,r.execution_source,e.id as evidence_id,e.observed_at,e.facts,
          m.followers,m.precision as follower_precision,count(*) over()::int as total_count
        from campaign_creators c
        join creator_accounts a on a.organization_id=c.organization_id and a.id=c.creator_account_id
        join lateral (select x.* from discovery_evidence x where x.organization_id=c.organization_id and x.campaign_id=c.campaign_id and x.creator_account_id=a.id and x.kind='profile_observation' order by x.observed_at desc,x.recorded_at desc,x.id desc limit 1) e on true
        join discovery_runs r on r.organization_id=c.organization_id and r.campaign_id=c.campaign_id and r.id=e.run_id
        left join lateral (select case when jsonb_typeof(v->'value')='number' then v->>'value' else null end as followers,v->>'precision' as precision from jsonb_array_elements(case when jsonb_typeof(e.facts->'metrics')='array' then e.facts->'metrics' else '[]'::jsonb end) v where v->>'name' in ('followers','subscribers') limit 1) m on true
        where c.organization_id=${actor.organizationId} and c.campaign_id=${campaign.id}
        ${filters.platform ? sql`and a.platform=${filters.platform}` : sql``}
        ${filters.state ? sql`and c.discovery_state=${filters.state}` : sql``}
        ${filters.source ? sql`and r.execution_source=${filters.source}` : sql``}
        ${filters.category ? sql`and e.facts->'categories' ? ${filters.category}` : sql``}
        ${filters.min !== undefined ? sql`and m.followers::numeric >= ${filters.min}` : sql``}
        ${filters.max !== undefined ? sql`and m.followers::numeric <= ${filters.max}` : sql``}
        order by e.observed_at desc,c.id limit ${PAGE_SIZE} offset ${(filters.page - 1) * PAGE_SIZE}`);
      const runRows = await tx.select({ run: discoveryRuns,
        // Literal outer qualifiers avoid single-table SELECT dequalifying nested columns.
        discovered: sql<number>`(select count(distinct e.creator_account_id)::int from discovery_evidence e where e.organization_id=discovery_runs.organization_id and e.run_id=discovery_runs.id and e.kind='profile_observation')`,
        failures: sql<number>`(select count(*)::int from discovery_logs l where l.organization_id=discovery_runs.organization_id and l.run_id=discovery_runs.id and l.event_type<>'staff_review' and l.outcome in ('blocked','failed'))`,
      }).from(discoveryRuns).where(and(eq(discoveryRuns.organizationId, actor.organizationId), eq(discoveryRuns.campaignId, campaign.id))).orderBy(desc(discoveryRuns.createdAt)).limit(25);
      const { rows: [counts] } = await tx.execute<{ total: number; verified: number; observations: number; failures: number; work_runs: number; synthetic_runs: number }>(sql`
        select (select count(*)::int from campaign_creators where organization_id=${actor.organizationId} and campaign_id=${campaign.id}) as total,
          (select count(*)::int from campaign_creators where organization_id=${actor.organizationId} and campaign_id=${campaign.id} and discovery_state='direct_sns_verified') as verified,
          (select count(*)::int from discovery_evidence where organization_id=${actor.organizationId} and campaign_id=${campaign.id} and kind='profile_observation') as observations,
          (select count(*)::int from discovery_logs where organization_id=${actor.organizationId} and campaign_id=${campaign.id} and event_type<>'staff_review' and outcome in ('blocked','failed')) as failures,
          (select count(*)::int from discovery_runs where organization_id=${actor.organizationId} and campaign_id=${campaign.id} and execution_source='work_manual_task') as work_runs,
          (select count(*)::int from discovery_runs where organization_id=${actor.organizationId} and campaign_id=${campaign.id} and execution_source='codex_test') as synthetic_runs`);
      const capabilityRows = await tx.select({ platform: discoveryCapabilities.platform, kind: discoveryCapabilities.kind, verdict: discoveryCapabilities.verdict, facts: discoveryCapabilities.facts, environment: discoveryCapabilities.environmentSha256, createdAt: discoveryCapabilities.createdAt }).from(discoveryCapabilities).where(eq(discoveryCapabilities.organizationId, actor.organizationId)).orderBy(desc(discoveryCapabilities.createdAt)).limit(100);
      return { campaign, creators: result.rows, totalFiltered: result.rows[0]?.total_count ?? 0, runs: runRows, counts: { ...counts, duplicates: Math.max(0, counts.observations - counts.total) }, capabilities: capabilityRows, filters, pageSize: PAGE_SIZE };
    }),
    creator: (actor: ActorScope, campaignId: string, accountId: string, offset = 0) => transaction(actor, async tx => {
      z.uuid().parse(campaignId); z.uuid().parse(accountId); z.number().int().min(0).max(100000).parse(offset);
      const [link] = await tx.select({ link: campaignCreators, account: creatorAccounts }).from(campaignCreators).innerJoin(creatorAccounts, and(eq(creatorAccounts.id, campaignCreators.creatorAccountId), eq(creatorAccounts.organizationId, campaignCreators.organizationId))).where(and(eq(campaignCreators.organizationId, actor.organizationId), eq(campaignCreators.campaignId, campaignId), eq(campaignCreators.creatorAccountId, accountId)));
      if (!link) return null;
      const rows = await tx.select({ evidence: discoveryEvidence, source: discoveryRuns.executionSource, runStatus: discoveryRuns.status, briefVersion: discoveryRuns.briefVersion }).from(discoveryEvidence).innerJoin(discoveryRuns, and(eq(discoveryRuns.organizationId, discoveryEvidence.organizationId), eq(discoveryRuns.id, discoveryEvidence.runId)))
        .where(and(eq(discoveryEvidence.organizationId, actor.organizationId), eq(discoveryEvidence.campaignId, campaignId), eq(discoveryEvidence.creatorAccountId, accountId))).orderBy(desc(discoveryEvidence.observedAt), desc(discoveryEvidence.recordedAt), desc(discoveryEvidence.id)).limit(PAGE_SIZE + 1).offset(offset);
      const ids = rows.slice(0, PAGE_SIZE).map(row => row.evidence.id);
      const reviews = ids.length ? await tx.select().from(discoveryEvidenceReviews).where(and(eq(discoveryEvidenceReviews.organizationId, actor.organizationId), inArray(discoveryEvidenceReviews.evidenceId, ids))).orderBy(desc(discoveryEvidenceReviews.createdAt), desc(discoveryEvidenceReviews.id)) : [];
      return { ...link, evidence: rows.slice(0, PAGE_SIZE), reviews, nextOffset: rows.length > PAGE_SIZE ? offset + PAGE_SIZE : null };
    }),
  };
}

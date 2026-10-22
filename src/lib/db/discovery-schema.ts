import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, jsonb, unique, uniqueIndex, foreignKey, check, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { organizations, users, memberships, campaigns, campaignBriefRevisions, projectAssetVersions } from "./schema";

export const DISCOVERY_PLATFORMS = ["instagram", "tiktok", "youtube"] as const;
export const DISCOVERY_RUN_STATES = ["prepared", "collecting", "awaiting_review", "completed", "partial", "blocked", "failed", "cancelled"] as const;
export const DISCOVERY_SOURCES = ["work_manual_task", "manual_import", "codex_test"] as const;
export type DiscoveryPlatform = typeof DISCOVERY_PLATFORMS[number];
export type TargetingSnapshot = { countryCodes: string[]; platforms: string[]; categories: string[]; followerMin: number; followerMax: number; goalCount: number; notes: string; exclusions: string };
export type DiscoveryMetric = { name: "followers" | "subscribers" | "views" | "likes" | "comments"; raw_display: string | null; value: number | null; precision: "exact" | "rounded" | "hidden" | "unavailable"; observed_at: string; source_url: string };
export type DiscoveryFacts = { schema_version: 1; opened_directly: boolean; metrics: DiscoveryMetric[]; note: string; recent_basis?: string; country?: { code: string | null; basis: string }; categories?: string[]; audience_country: "unknown"; targeting?: { followers: "match" | "outside" | "unknown"; country: "match" | "outside" | "unknown"; category: "match" | "outside" | "unknown" } };
const times = () => ({ createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull() });
const actors = () => ({ createdBy: uuid("created_by").notNull().references(() => users.id), updatedBy: uuid("updated_by").notNull().references(() => users.id) });
const scope = () => ({ organizationId: uuid("organization_id").notNull(), projectId: uuid("project_id").notNull(), campaignId: uuid("campaign_id").notNull() });
const enumCheck = (name: string, column: AnyPgColumn, values: readonly string[]) => check(name, sql`${column} in (${sql.join(values.map(v => sql.raw(`'${v}'`)), sql`, `)})`);

// Reviewed private experiment references only. No success records are seeded by migration.
export const discoveryCapabilities = pgTable("discovery_capability_receipts", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  platform: text({ enum: DISCOVERY_PLATFORMS }).notNull(), kind: text({ enum: ["sns_native_search", "work_mcp_write", "initial_validation"] }).notNull(),
  verdict: text({ enum: ["partial", "verified", "blocked"] }).notNull(),
  environmentSha256: text("environment_sha256").notNull(), privateEvidenceReference: text("private_evidence_reference").notNull(),
  facts: jsonb().$type<{ native_search: boolean; direct_profiles: number; recent_content_profiles: number; limitations: string[]; initial_validation?: { grant_id: string; campaign_id: string; max_creators: number; expires_at: string } }>().notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  reviewedBy: uuid("reviewed_by").notNull().references(() => users.id), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [unique("discovery_capability_scope").on(t.organizationId, t.platform, t.id),
  enumCheck("discovery_capability_platform", t.platform, DISCOVERY_PLATFORMS), enumCheck("discovery_capability_kind", t.kind, ["sns_native_search", "work_mcp_write", "initial_validation"]),
  enumCheck("discovery_capability_verdict", t.verdict, ["partial", "verified", "blocked"]),
  check("discovery_initial_validation_unverified", sql`${t.kind} <> 'initial_validation' or ${t.verdict} = 'partial'`),
  check("discovery_capability_hash", sql`${t.environmentSha256} ~ '^[a-f0-9]{64}$'`),
  index("discovery_capability_latest").on(t.organizationId, t.platform, t.kind, t.createdAt),
]);
export const discoveryRuns = pgTable("discovery_runs", {
  id: uuid().defaultRandom().primaryKey(), ...scope(), briefVersion: integer("brief_version").notNull(),
  platform: text({ enum: DISCOVERY_PLATFORMS }).notNull(), executionSource: text("execution_source", { enum: DISCOVERY_SOURCES }).notNull(),
  status: text({ enum: DISCOVERY_RUN_STATES }).default("prepared").notNull(),
  targetingSnapshot: jsonb("targeting_snapshot").$type<TargetingSnapshot>().notNull(), targetingSha256: text("targeting_sha256").notNull(),
  contextSha256: text("context_sha256").notNull(), snapshotSchemaVersion: integer("snapshot_schema_version").default(1).notNull(),
  requestedCount: integer("requested_count").notNull(), timeBudgetSeconds: integer("time_budget_seconds").default(1800).notNull(),
  workTaskReference: text("work_task_reference"), capabilityReceiptId: uuid("capability_receipt_id"),
  environmentSnapshot: jsonb("environment_snapshot").$type<{ environment_sha256: string; work_connection: "unverified" | "reviewed"; initial_validation?: boolean }>().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }), submittedAt: timestamp("submitted_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }), endedAt: timestamp("ended_at", { withTimezone: true }),
  outcomeSummary: jsonb("outcome_summary").$type<Record<string, number>>().default({}).notNull(), limitations: text().array().default(sql`'{}'::text[]`).notNull(),
  lockVersion: integer("lock_version").default(0).notNull(), ...actors(), ...times(),
}, t => [unique("discovery_run_scope").on(t.organizationId, t.projectId, t.campaignId, t.id),
  unique("discovery_run_platform_scope").on(t.organizationId, t.projectId, t.campaignId, t.platform, t.id),
  foreignKey({ name: "discovery_run_brief_fk", columns: [t.organizationId, t.projectId, t.campaignId, t.briefVersion], foreignColumns: [campaignBriefRevisions.organizationId, campaignBriefRevisions.projectId, campaignBriefRevisions.campaignId, campaignBriefRevisions.version] }),
  foreignKey({ name: "discovery_run_capability_fk", columns: [t.organizationId, t.platform, t.capabilityReceiptId], foreignColumns: [discoveryCapabilities.organizationId, discoveryCapabilities.platform, discoveryCapabilities.id] }),
  enumCheck("discovery_run_platform", t.platform, DISCOVERY_PLATFORMS), enumCheck("discovery_run_source", t.executionSource, DISCOVERY_SOURCES), enumCheck("discovery_run_status", t.status, DISCOVERY_RUN_STATES),
  check("discovery_run_hashes", sql`${t.targetingSha256} ~ '^[a-f0-9]{64}$' and ${t.contextSha256} ~ '^[a-f0-9]{64}$'`),
  check("discovery_run_bounds", sql`${t.requestedCount} between 1 and 500 and ${t.timeBudgetSeconds} between 60 and 14400 and ${t.snapshotSchemaVersion} = 1 and ${t.lockVersion} >= 0`),
  check("discovery_run_work_provenance", sql`${t.executionSource} <> 'work_manual_task' or (${t.workTaskReference} is not null and ${t.capabilityReceiptId} is not null)`),
  index("discovery_runs_campaign_time").on(t.organizationId, t.campaignId, t.createdAt),
]);
export const creatorAccounts = pgTable("creator_accounts", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  platform: text({ enum: DISCOVERY_PLATFORMS }).notNull(), platformAccountId: text("platform_account_id"),
  canonicalProfileUrl: text("canonical_profile_url").notNull(), currentHandle: text("current_handle"), displayName: text("display_name"),
  identityState: text("identity_state", { enum: ["provisional", "resolved", "conflict", "merged"] }).default("provisional").notNull(),
  mergedIntoId: uuid("merged_into_id"), firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(), lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }), ...actors(), ...times(),
}, t => [unique("creator_account_scope").on(t.organizationId, t.platform, t.id),
  uniqueIndex("creator_stable_identity").on(t.organizationId, t.platform, t.platformAccountId).where(sql`${t.platformAccountId} is not null`),
  enumCheck("creator_platform", t.platform, DISCOVERY_PLATFORMS), enumCheck("creator_identity_state", t.identityState, ["provisional", "resolved", "conflict", "merged"]),
  index("creator_org_last_seen").on(t.organizationId, t.lastSeenAt),
]);
export const discoveryLogs = pgTable("discovery_logs", {
  id: uuid().defaultRandom().primaryKey(), ...scope(), runId: uuid("run_id").notNull(), sequence: integer().notNull(),
  eventType: text("event_type").notNull(), outcome: text({ enum: ["success", "partial", "blocked", "failed"] }).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(), recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  sourceUrl: text("source_url"), query: text(), parentLogId: uuid("parent_log_id"), failureCode: text("failure_code"), message: text().notNull(),
  correlationId: uuid("correlation_id").notNull(), createdBy: uuid("created_by").notNull().references(() => users.id),
}, t => [unique("discovery_log_sequence").on(t.runId, t.sequence), unique("discovery_log_scope").on(t.organizationId, t.projectId, t.campaignId, t.runId, t.id),
  foreignKey({ name: "discovery_log_run_fk", columns: [t.organizationId, t.projectId, t.campaignId, t.runId], foreignColumns: [discoveryRuns.organizationId, discoveryRuns.projectId, discoveryRuns.campaignId, discoveryRuns.id] }),
  enumCheck("discovery_log_outcome", t.outcome, ["success", "partial", "blocked", "failed"]), check("discovery_log_sequence_positive", sql`${t.sequence} > 0`),
]);
export const discoveryEvidence = pgTable("discovery_evidence", {
  id: uuid().defaultRandom().primaryKey(), ...scope(), runId: uuid("run_id").notNull(), creatorAccountId: uuid("creator_account_id").notNull(),
  platform: text({ enum: DISCOVERY_PLATFORMS }).notNull(), kind: text({ enum: ["profile_observation", "content_observation", "metric_observation", "identity_observation"] }).notNull(),
  observationMethod: text("observation_method", { enum: ["sns_browser", "supplemental_web", "manual_import", "codex_test"] }).notNull(),
  sourceUrl: text("source_url").notNull(), profileUrl: text("profile_url").notNull(), platformContentId: text("platform_content_id"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(), recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }), facts: jsonb().$type<DiscoveryFacts>().notNull(),
  limitations: text().array().notNull(), searchLogId: uuid("search_log_id").notNull(), workTraceReference: text("work_trace_reference"),
  captureAssetVersionId: uuid("capture_asset_version_id"), supersedesId: uuid("supersedes_id"), payloadSha256: text("payload_sha256").notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
}, t => [unique("discovery_evidence_scope").on(t.organizationId, t.projectId, t.campaignId, t.runId, t.id),
  unique("discovery_evidence_account_scope").on(t.organizationId, t.projectId, t.campaignId, t.runId, t.creatorAccountId, t.id),
  unique("discovery_evidence_identity_scope").on(t.organizationId, t.platform, t.creatorAccountId, t.id),
  foreignKey({ name: "discovery_evidence_run_fk", columns: [t.organizationId, t.projectId, t.campaignId, t.platform, t.runId], foreignColumns: [discoveryRuns.organizationId, discoveryRuns.projectId, discoveryRuns.campaignId, discoveryRuns.platform, discoveryRuns.id] }),
  foreignKey({ name: "discovery_evidence_creator_fk", columns: [t.organizationId, t.platform, t.creatorAccountId], foreignColumns: [creatorAccounts.organizationId, creatorAccounts.platform, creatorAccounts.id] }),
  foreignKey({ name: "discovery_evidence_log_fk", columns: [t.organizationId, t.projectId, t.campaignId, t.runId, t.searchLogId], foreignColumns: [discoveryLogs.organizationId, discoveryLogs.projectId, discoveryLogs.campaignId, discoveryLogs.runId, discoveryLogs.id] }),
  foreignKey({ name: "discovery_evidence_asset_fk", columns: [t.organizationId, t.projectId, t.captureAssetVersionId], foreignColumns: [projectAssetVersions.organizationId, projectAssetVersions.projectId, projectAssetVersions.id] }),
  enumCheck("discovery_evidence_kind", t.kind, ["profile_observation", "content_observation", "metric_observation", "identity_observation"]),
  enumCheck("discovery_evidence_method", t.observationMethod, ["sns_browser", "supplemental_web", "manual_import", "codex_test"]),
  check("discovery_evidence_hash", sql`${t.payloadSha256} ~ '^[a-f0-9]{64}$'`),
  index("discovery_evidence_account_time").on(t.organizationId, t.creatorAccountId, t.observedAt),
]);
export const creatorAccountAliases = pgTable("creator_account_aliases", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull(), platform: text({ enum: DISCOVERY_PLATFORMS }).notNull(),
  accountId: uuid("account_id").notNull(), normalizedUrl: text("normalized_url").notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true }).defaultNow().notNull(), validTo: timestamp("valid_to", { withTimezone: true }),
  evidenceId: uuid("evidence_id").notNull(), createdBy: uuid("created_by").notNull().references(() => users.id),
}, t => [foreignKey({ name: "creator_alias_account_fk", columns: [t.organizationId, t.platform, t.accountId], foreignColumns: [creatorAccounts.organizationId, creatorAccounts.platform, creatorAccounts.id] }),
  foreignKey({ name: "creator_alias_evidence_fk", columns: [t.organizationId, t.platform, t.accountId, t.evidenceId], foreignColumns: [discoveryEvidence.organizationId, discoveryEvidence.platform, discoveryEvidence.creatorAccountId, discoveryEvidence.id] }),
  uniqueIndex("creator_active_alias").on(t.organizationId, t.platform, t.normalizedUrl).where(sql`${t.validTo} is null`),
  index("creator_alias_account").on(t.organizationId, t.accountId), check("creator_alias_dates", sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
]);
export const campaignCreators = pgTable("campaign_creators", {
  id: uuid().defaultRandom().primaryKey(), ...scope(), creatorAccountId: uuid("creator_account_id").notNull(),
  firstDiscoveryRunId: uuid("first_discovery_run_id").notNull(), firstEvidenceId: uuid("first_evidence_id").notNull(),
  discoveryState: text("discovery_state", { enum: ["verification_pending", "direct_sns_verified", "blocked", "duplicate"] }).default("verification_pending").notNull(),
  ...actors(), ...times(),
}, t => [unique("campaign_creator_identity").on(t.organizationId, t.campaignId, t.creatorAccountId),
  foreignKey({ name: "campaign_creator_campaign_fk", columns: [t.organizationId, t.projectId, t.campaignId], foreignColumns: [campaigns.organizationId, campaigns.projectId, campaigns.id] }),
  foreignKey({ name: "campaign_creator_evidence_fk", columns: [t.organizationId, t.projectId, t.campaignId, t.firstDiscoveryRunId, t.creatorAccountId, t.firstEvidenceId], foreignColumns: [discoveryEvidence.organizationId, discoveryEvidence.projectId, discoveryEvidence.campaignId, discoveryEvidence.runId, discoveryEvidence.creatorAccountId, discoveryEvidence.id] }),
  enumCheck("campaign_creator_state", t.discoveryState, ["verification_pending", "direct_sns_verified", "blocked", "duplicate"]), index("campaign_creator_account").on(t.organizationId, t.creatorAccountId),
]);
export const discoveryEvidenceReviews = pgTable("discovery_evidence_reviews", {
  id: uuid().defaultRandom().primaryKey(), ...scope(), runId: uuid("run_id").notNull(), evidenceId: uuid("evidence_id").notNull(),
  verdict: text({ enum: ["accepted", "rejected", "needs_review"] }).notNull(), reason: text().notNull(),
  reviewedBy: uuid("reviewed_by").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [foreignKey({ name: "discovery_review_evidence_fk", columns: [t.organizationId, t.projectId, t.campaignId, t.runId, t.evidenceId], foreignColumns: [discoveryEvidence.organizationId, discoveryEvidence.projectId, discoveryEvidence.campaignId, discoveryEvidence.runId, discoveryEvidence.id] }),
  foreignKey({ name: "discovery_review_member_fk", columns: [t.organizationId, t.reviewedBy], foreignColumns: [memberships.organizationId, memberships.userId] }),
  enumCheck("discovery_evidence_verdict", t.verdict, ["accepted", "rejected", "needs_review"]), index("discovery_evidence_review_latest").on(t.evidenceId, t.createdAt),
]);
export const discoveryRequests = pgTable("discovery_requests", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull(), actorId: uuid("actor_id").notNull(),
  principalKey: text("principal_key").notNull(), tool: text().notNull(), idempotencyKey: uuid("idempotency_key").notNull(),
  payloadSha256: text("payload_sha256").notNull(), receipt: jsonb().$type<Record<string, unknown>>().notNull(), requestId: uuid("request_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [unique("discovery_request_idempotency").on(t.organizationId, t.principalKey, t.tool, t.idempotencyKey),
  foreignKey({ name: "discovery_request_member_fk", columns: [t.organizationId, t.actorId], foreignColumns: [memberships.organizationId, memberships.userId] }),
  check("discovery_request_hash", sql`${t.payloadSha256} ~ '^[a-f0-9]{64}$'`),
]);

// Separate from synthetic probe grants. No memberships or grants are auto-enrolled.
export const discoveryMcpGrants = pgTable("discovery_mcp_grants", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull(), userId: uuid("user_id").notNull(),
  issuer: text().notNull(), subject: text().notNull(), environmentSha256: text("environment_sha256").notNull(),
  executionSource: text("execution_source", { enum: ["work_manual_task", "codex_test"] }).notNull(), scopes: text().array().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull().references(() => users.id), ...times(),
}, t => [uniqueIndex("discovery_mcp_principal").on(t.organizationId, t.issuer, t.subject).where(sql`${t.revokedAt} is null`), unique("discovery_mcp_grant_scope").on(t.organizationId, t.id),
  foreignKey({ name: "discovery_mcp_member_fk", columns: [t.organizationId, t.userId], foreignColumns: [memberships.organizationId, memberships.userId] }),
  enumCheck("discovery_mcp_source", t.executionSource, ["work_manual_task", "codex_test"]),
  check("discovery_mcp_scopes", sql`cardinality(${t.scopes}) > 0 and ${t.scopes} <@ ARRAY['discovery:read','discovery:observe','discovery:submit']::text[] and ${t.scopes} @> ARRAY['discovery:read']::text[]`),
  check("discovery_mcp_environment_hash", sql`${t.environmentSha256} ~ '^[a-f0-9]{64}$'`),
  check("discovery_mcp_expiry", sql`${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '24 hours'`),
]);
export const discoveryGrantCampaigns = pgTable("discovery_grant_campaigns", {
  ...scope(), grantId: uuid("grant_id").notNull(),
}, t => [unique("discovery_grant_campaign_identity").on(t.grantId, t.campaignId),
  foreignKey({ name: "discovery_grant_campaign_fk", columns: [t.organizationId, t.projectId, t.campaignId], foreignColumns: [campaigns.organizationId, campaigns.projectId, campaigns.id] }),
  foreignKey({ name: "discovery_grant_identity_fk", columns: [t.organizationId, t.grantId], foreignColumns: [discoveryMcpGrants.organizationId, discoveryMcpGrants.id] }),
]);

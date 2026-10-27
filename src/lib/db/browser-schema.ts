import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, jsonb, unique, foreignKey, check, index } from "drizzle-orm/pg-core";
import { campaigns, memberships, users } from "./schema";
import { discoveryRuns, DISCOVERY_PLATFORMS, type TargetingSnapshot } from "./discovery-schema";

export const browserDiscoveryRequests = pgTable("discovery_browser_requests", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull(), projectId: uuid("project_id").notNull(), campaignId: uuid("campaign_id").notNull(),
  platform: text({ enum: DISCOVERY_PLATFORMS }).notNull(), requestedCount: integer("requested_count").notNull(),
  contextSha256: text("context_sha256").notNull(), targetingSnapshot: jsonb("targeting_snapshot").$type<TargetingSnapshot>().notNull(),
  state: text({ enum: ["queued", "claimed", "cancelled"] }).default("queued").notNull(),
  idempotencyKey: uuid("idempotency_key").notNull(), createdBy: uuid("created_by").notNull().references(() => users.id),
  claimedBy: uuid("claimed_by"), claimedAt: timestamp("claimed_at", { withTimezone: true }), expiresAt: timestamp("expires_at", { withTimezone: true }),
  browserSurface: text("browser_surface", { enum: ["iab", "chrome"] }), executionReference: text("execution_reference"), authorizationSha256: text("authorization_sha256"),
  runId: uuid("run_id"), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  foreignKey({ name: "browser_request_campaign_fk", columns: [t.organizationId, t.projectId, t.campaignId], foreignColumns: [campaigns.organizationId, campaigns.projectId, campaigns.id] }),
  foreignKey({ name: "browser_request_creator_fk", columns: [t.organizationId, t.createdBy], foreignColumns: [memberships.organizationId, memberships.userId] }),
  foreignKey({ name: "browser_request_claimant_fk", columns: [t.organizationId, t.claimedBy], foreignColumns: [memberships.organizationId, memberships.userId] }),
  foreignKey({ name: "browser_request_run_fk", columns: [t.organizationId, t.projectId, t.campaignId, t.platform, t.runId], foreignColumns: [discoveryRuns.organizationId, discoveryRuns.projectId, discoveryRuns.campaignId, discoveryRuns.platform, discoveryRuns.id] }),
  unique("browser_request_key").on(t.organizationId, t.createdBy, t.idempotencyKey), unique("browser_request_run").on(t.runId),
  check("browser_request_bounds", sql`${t.requestedCount} between 1 and 20 and ${t.contextSha256} ~ '^[a-f0-9]{64}$'`),
  check("browser_request_platform", sql`${t.platform} in ('instagram','tiktok','youtube')`),
  check("browser_request_state", sql`${t.state} in ('queued','claimed','cancelled')`),
  check("browser_request_claim", sql`${t.state} <> 'claimed' or (${t.claimedBy} is not null and ${t.claimedAt} is not null and ${t.expiresAt} is not null and ${t.expiresAt} > ${t.claimedAt} and ${t.expiresAt} <= ${t.claimedAt} + interval '4 hours' and ${t.browserSurface} is not null and ${t.browserSurface} in ('iab','chrome') and ${t.executionReference} is not null and ${t.authorizationSha256} is not null and ${t.authorizationSha256} ~ '^[a-f0-9]{64}$')`),
  index("browser_request_campaign_time").on(t.organizationId, t.campaignId, t.createdAt),
]);

export const browserRunReviews = pgTable("discovery_browser_run_reviews", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull(), projectId: uuid("project_id").notNull(), campaignId: uuid("campaign_id").notNull(), runId: uuid("run_id").notNull(),
  contextSha256: text("context_sha256").notNull(), environmentSha256: text("environment_sha256").notNull(),
  verdict: text({ enum: ["accepted", "rejected", "needs_review"] }).notNull(), reason: text().notNull(), reviewedBy: uuid("reviewed_by").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  foreignKey({ name: "browser_review_run_fk", columns: [t.organizationId, t.projectId, t.campaignId, t.runId], foreignColumns: [discoveryRuns.organizationId, discoveryRuns.projectId, discoveryRuns.campaignId, discoveryRuns.id] }),
  foreignKey({ name: "browser_review_member_fk", columns: [t.organizationId, t.reviewedBy], foreignColumns: [memberships.organizationId, memberships.userId] }),
  check("browser_review_verdict", sql`${t.verdict} in ('accepted','rejected','needs_review')`),
  check("browser_review_hash", sql`${t.contextSha256} ~ '^[a-f0-9]{64}$' and ${t.environmentSha256} ~ '^[a-f0-9]{64}$'`),
  index("browser_review_latest").on(t.organizationId, t.runId, t.createdAt),
]);

// These credentials authorize only the browser worker API, never dashboard actions.
export const browserWorkerSessions = pgTable("discovery_browser_sessions", {
  tokenHash: text("token_hash").primaryKey(), organizationId: uuid("organization_id").notNull(), userId: uuid("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [foreignKey({ columns: [t.organizationId, t.userId], foreignColumns: [memberships.organizationId, memberships.userId] }).onDelete("cascade"), check("browser_session_expiry", sql`${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '8 hours'`)]);

export const browserCaptureBatches = pgTable("discovery_browser_captures", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull(), requestId: uuid("request_id").notNull().references(() => browserDiscoveryRequests.id),
  runId: uuid("run_id").notNull().references(() => discoveryRuns.id), batchKey: uuid("batch_key").notNull(), payloadSha256: text("payload_sha256").notNull(),
  originals: jsonb().$type<{ kind: string; sha256: string; content: string }[]>().notNull(),
  createdBy: uuid("created_by").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [unique("browser_capture_batch").on(t.requestId, t.batchKey), foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [memberships.organizationId, memberships.userId] }), check("browser_capture_bounds", sql`${t.payloadSha256} ~ '^[a-f0-9]{64}$' and octet_length(${t.originals}::text) <= 524288`)]);

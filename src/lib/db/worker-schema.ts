import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, foreignKey, check, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { memberships } from "./schema";
import { browserDiscoveryRequests } from "./browser-schema";
export const discoveryWorkers = pgTable("discovery_browser_workers", {
  id: uuid().primaryKey(), organizationId: uuid("organization_id").notNull(), userId: uuid("user_id").notNull(), instanceId: uuid("instance_id").notNull(),
  name: text().notNull(), browserSurface: text("browser_surface", { enum: ["iab", "chrome"] }).notNull(), platforms: text().array().notNull(),
  ready: text({ enum: ["ready", "unavailable"] }).notNull(), lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [unique("browser_worker_scope").on(t.organizationId, t.id), foreignKey({ columns: [t.organizationId, t.userId], foreignColumns: [memberships.organizationId, memberships.userId] }), check("browser_worker_config", sql`${t.browserSurface} in ('iab','chrome') and ${t.ready} in ('ready','unavailable') and cardinality(${t.platforms}) between 1 and 3 and ${t.platforms} <@ ARRAY['instagram','tiktok','youtube']::text[]`)]);
export const discoveryExecutions = pgTable("discovery_browser_executions", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull(), requestId: uuid("request_id").notNull().unique().references(() => browserDiscoveryRequests.id),
  workerId: uuid("worker_id").notNull(), instanceId: uuid("instance_id").notNull(),
  state: text({ enum: ["starting", "running", "completed", "partial", "blocked", "failed", "cancelled", "interrupted"] }).default("starting").notNull(),
  phase: text({ enum: ["preparing", "browsing", "saving", "finishing"] }).default("preparing").notNull(), errorCode: text("error_code"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(), finishedAt: timestamp("finished_at", { withTimezone: true }),
}, t => [foreignKey({ columns: [t.organizationId, t.workerId], foreignColumns: [discoveryWorkers.organizationId, discoveryWorkers.id] }), uniqueIndex("browser_worker_one_active").on(t.workerId).where(sql`${t.state} in ('starting','running')`), check("browser_execution_state", sql`${t.state} in ('starting','running','completed','partial','blocked','failed','cancelled','interrupted') and ${t.phase} in ('preparing','browsing','saving','finishing')`)]);

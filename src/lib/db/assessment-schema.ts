import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, jsonb, unique, foreignKey, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { memberships } from "./schema";
import { campaignCreators } from "./discovery-schema";
import { creatorEvaluations } from "./evaluation-schema";
import { discoveryWorkers } from "./worker-schema";

export const creatorAssessments = pgTable("creator_assessment_jobs", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull(), campaignId: uuid("campaign_id").notNull(),
  creatorAccountId: uuid("creator_account_id").notNull(), inputSha256: text("input_sha256").notNull(),
  inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>().notNull(),
  state: text({ enum: ["queued", "running", "completed", "failed", "cancelled"] }).default("queued").notNull(),
  recommendation: text({ enum: ["recommended", "needs_info", "excluded"] }),
  sourceEligible: text("source_eligible", { enum: ["yes", "no"] }).notNull(),
  workerId: uuid("worker_id"), instanceId: uuid("instance_id"), attempts: integer().default(0).notNull(), errorCode: text("error_code"),
  evaluationId: uuid("evaluation_id"), createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  unique("assessment_input").on(t.organizationId, t.campaignId, t.creatorAccountId, t.inputSha256),
  foreignKey({ columns: [t.organizationId, t.campaignId, t.creatorAccountId], foreignColumns: [campaignCreators.organizationId, campaignCreators.campaignId, campaignCreators.creatorAccountId] }),
  foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [memberships.organizationId, memberships.userId] }),
  foreignKey({ columns: [t.organizationId, t.workerId], foreignColumns: [discoveryWorkers.organizationId, discoveryWorkers.id] }),
  foreignKey({ columns: [t.organizationId, t.campaignId, t.creatorAccountId, t.evaluationId], foreignColumns: [creatorEvaluations.organizationId, creatorEvaluations.campaignId, creatorEvaluations.creatorAccountId, creatorEvaluations.id] }),
  check("assessment_state", sql`${t.state} in ('queued','running','completed','failed','cancelled') and ${t.sourceEligible} in ('yes','no') and ${t.attempts} between 0 and 3`),
  check("assessment_result", sql`(${t.state}='completed') = (${t.evaluationId} is not null and ${t.recommendation} is not null) and (${t.recommendation} is null or ${t.recommendation} in ('recommended','needs_info','excluded'))`),
  uniqueIndex("assessment_worker_active").on(t.workerId).where(sql`${t.state}='running'`),
  index("assessment_queue").on(t.organizationId, t.state, t.createdAt),
]);

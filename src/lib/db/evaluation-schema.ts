import {sql} from "drizzle-orm";
import {pgTable,uuid,text,timestamp,integer,jsonb,unique,foreignKey,check,index} from "drizzle-orm/pg-core";
import {campaigns,campaignBriefRevisions,users} from "./schema";
import {campaignCreators} from "./discovery-schema";
import type {EvaluationOutput} from "../evaluation/contracts";
const scope=()=>({organizationId:uuid("organization_id").notNull(),projectId:uuid("project_id").notNull(),campaignId:uuid("campaign_id").notNull(),creatorAccountId:uuid("creator_account_id").notNull()});
export const creatorEvaluations=pgTable("creator_evaluations",{
 id:uuid().defaultRandom().primaryKey(),...scope(),briefVersion:integer("brief_version").notNull(),
 inputSha256:text("input_sha256").notNull(),payloadSha256:text("payload_sha256").notNull(),idempotencyKey:uuid("idempotency_key").notNull(),
 source:text({enum:["work_import","openai_api"]}).notNull(),model:text().notNull(),promptVersion:text("prompt_version").notNull(),
 inputSnapshot:jsonb("input_snapshot").$type<Record<string,unknown>>().notNull(),output:jsonb().$type<EvaluationOutput>().notNull(),
 total:integer(),knownSubtotal:integer("known_subtotal").notNull(),unknownCount:integer("unknown_count").notNull(),
 createdBy:uuid("created_by").notNull().references(()=>users.id),createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
},t=>[unique("evaluation_identity").on(t.organizationId,t.id),unique("evaluation_request_identity").on(t.organizationId,t.createdBy,t.idempotencyKey),
 foreignKey({name:"evaluation_campaign_fk",columns:[t.organizationId,t.projectId,t.campaignId],foreignColumns:[campaigns.organizationId,campaigns.projectId,campaigns.id]}),
 foreignKey({name:"evaluation_creator_fk",columns:[t.organizationId,t.campaignId,t.creatorAccountId],foreignColumns:[campaignCreators.organizationId,campaignCreators.campaignId,campaignCreators.creatorAccountId]}),
 foreignKey({name:"evaluation_brief_fk",columns:[t.organizationId,t.projectId,t.campaignId,t.briefVersion],foreignColumns:[campaignBriefRevisions.organizationId,campaignBriefRevisions.projectId,campaignBriefRevisions.campaignId,campaignBriefRevisions.version]}),
 check("evaluation_source",sql`${t.source} in ('work_import','openai_api')`),check("evaluation_scores",sql`${t.knownSubtotal} between 0 and 100 and ${t.unknownCount} between 0 and 6 and (${t.total} is null or (${t.unknownCount}=0 and ${t.total}=${t.knownSubtotal}))`),
 check("evaluation_hashes",sql`${t.inputSha256} ~ '^[a-f0-9]{64}$' and ${t.payloadSha256} ~ '^[a-f0-9]{64}$'`),index("evaluation_campaign_time").on(t.organizationId,t.campaignId,t.createdAt),]);
export const evaluationReviews=pgTable("creator_evaluation_reviews",{
 id:uuid().defaultRandom().primaryKey(),organizationId:uuid("organization_id").notNull(),evaluationId:uuid("evaluation_id").notNull(),
 verdict:text({enum:["approved","hold","rejected"]}).notNull(),reason:text().notNull(),unknownsAcknowledged:text("unknowns_acknowledged").notNull(),
 idempotencyKey:uuid("idempotency_key").notNull(),payloadSha256:text("payload_sha256").notNull(),createdBy:uuid("created_by").notNull().references(()=>users.id),createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
},t=>[foreignKey({name:"evaluation_review_fk",columns:[t.organizationId,t.evaluationId],foreignColumns:[creatorEvaluations.organizationId,creatorEvaluations.id]}),
 unique("evaluation_review_request").on(t.organizationId,t.createdBy,t.idempotencyKey),check("evaluation_review_verdict",sql`${t.verdict} in ('approved','hold','rejected')`),check("evaluation_review_ack",sql`${t.unknownsAcknowledged} in ('yes','no')`),check("evaluation_review_reason",sql`length(trim(${t.reason})) between 1 and 2000`)]);
export const evaluationRequests=pgTable("evaluation_requests",{
 id:uuid().defaultRandom().primaryKey(),...scope(),idempotencyKey:uuid("idempotency_key").notNull(),inputSha256:text("input_sha256").notNull(),model:text().notNull(),
 state:text({enum:["started","succeeded","failed"]}).notNull(),errorCode:text("error_code"),createdBy:uuid("created_by").notNull().references(()=>users.id),createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),updatedAt:timestamp("updated_at",{withTimezone:true}).defaultNow().notNull(),
},t=>[unique("evaluation_generation_key").on(t.organizationId,t.createdBy,t.idempotencyKey),foreignKey({name:"evaluation_request_creator_fk",columns:[t.organizationId,t.campaignId,t.creatorAccountId],foreignColumns:[campaignCreators.organizationId,campaignCreators.campaignId,campaignCreators.creatorAccountId]}),check("evaluation_request_state",sql`${t.state} in ('started','succeeded','failed')`)]);

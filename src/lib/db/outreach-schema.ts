import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, jsonb, unique, foreignKey, check, integer } from "drizzle-orm/pg-core";
import { memberships } from "./schema";
import { campaignCreators } from "./discovery-schema";
import type { SenderAddress } from "../outreach/contracts";
import type { MailBranding } from "../outreach/template-contracts";
import type { DmSelection } from "../outreach/instagram-dm-contracts";
import type { BrowserObservation,BrowserSendState } from "../outreach/browser-contracts";
import { discoveryWorkers } from "./worker-schema";
const dates = () => ({ createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull() });
export const senderAccounts = pgTable("outreach_sender_accounts", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull(),
  provider: text({ enum: ["google", "instagram", "tiktok"] }).notNull(), label: text().notNull(), expectedIdentity: text("expected_identity").notNull(),
  providerId: text("provider_id"), identity: text(), addresses: jsonb().$type<SenderAddress[]>().notNull().default([]), scopes: text().array().notNull().default(sql`'{}'::text[]`),
  status: text({ enum: ["pending", "connected", "reconnect", "disconnected"] }).notNull().default("pending"),
  tokenCiphertext: text("token_ciphertext"), appFingerprint: text("app_fingerprint"), expiresAt: timestamp("expires_at", { withTimezone: true }), verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(), updatedBy: uuid("updated_by").notNull(), ...dates(),
}, t => [unique("sender_scope").on(t.organizationId, t.id), unique("sender_expected").on(t.organizationId,t.provider,t.expectedIdentity), unique("sender_provider_identity").on(t.organizationId,t.provider,t.providerId),
  foreignKey({ columns:[t.organizationId,t.createdBy], foreignColumns:[memberships.organizationId,memberships.userId] }),
  foreignKey({ columns:[t.organizationId,t.updatedBy], foreignColumns:[memberships.organizationId,memberships.userId] }),
  check("sender_provider", sql`${t.provider} in ('google','instagram','tiktok')`), check("sender_status", sql`${t.status} in ('pending','connected','reconnect','disconnected')`),
  check("sender_connected", sql`${t.status}<>'connected' or (${t.providerId} is not null and ${t.identity} is not null and ${t.tokenCiphertext} is not null and ${t.verifiedAt} is not null)`),
]);
export const outreachConnectionTests = pgTable("outreach_connection_tests", {
  id: uuid().primaryKey(), organizationId: uuid("organization_id").notNull(), accountId: uuid("account_id").notNull(),
  fromAddress: text("from_address").notNull(), toAddress: text("to_address").notNull(), subject: text().notNull(), body: text().notNull(),
  status: text({ enum: ["sending", "sent", "failed", "unknown"] }).notNull().default("sending"),
  errorCode: text("error_code"), providerMessageId: text("provider_message_id"), sentAt: timestamp("sent_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(), ...dates(),
}, t => [foreignKey({ columns: [t.organizationId, t.accountId], foreignColumns: [senderAccounts.organizationId, senderAccounts.id] }),
  foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [memberships.organizationId, memberships.userId] }),
  check("connection_test_status", sql`${t.status} in ('sending','sent','failed','unknown')`)]);
export const senderOAuthStates = pgTable("outreach_oauth_states", {
  stateHash: text("state_hash").primaryKey(), organizationId: uuid("organization_id").notNull(), accountId: uuid("account_id").notNull(), userId: uuid("user_id").notNull(),
  sessionHash: text("session_hash").notNull(), appFingerprint: text("app_fingerprint"), verifierCiphertext: text("verifier_ciphertext").notNull(), aliases: text({ enum:["yes","no"] }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), consumedAt: timestamp("consumed_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [foreignKey({ columns:[t.organizationId,t.accountId],foreignColumns:[senderAccounts.organizationId,senderAccounts.id] }), foreignKey({ columns:[t.organizationId,t.userId],foreignColumns:[memberships.organizationId,memberships.userId] })]);
export const outreachDrafts = pgTable("outreach_drafts", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull(), campaignId: uuid("campaign_id").notNull(), creatorAccountId: uuid("creator_account_id").notNull(),
  inputSha256: text("input_sha256").notNull(), channel: text({ enum:["email","instagram","tiktok"] }).notNull(), subject: text().notNull().default(""), body: text().notNull().default(""),
  template: text({ enum:["letter","brand","proposal","followup"] }).notNull().default("letter"), branding: jsonb().$type<MailBranding>().notNull().default({companyName:"",signature:"",color:"#28543e",website:""}), language: text({enum:["한국어","English"]}).notNull().default("English"), purpose: text().notNull().default(""), senderAccountId: uuid("sender_account_id"), fromAddress: text("from_address").notNull().default(""), toAddress: text("to_address").notNull().default(""), recipientSource: text("recipient_source").notNull().default(""),
  revision: integer().notNull().default(1), status: text({ enum:["draft","sending","sent","failed","unknown"] }).notNull().default("draft"),
  instagramConversation: jsonb("instagram_conversation").$type<DmSelection|null>(),
  providerMessageId: text("provider_message_id"), sentAt: timestamp("sent_at", { withTimezone: true }), createdBy: uuid("created_by").notNull(), updatedBy: uuid("updated_by").notNull(), ...dates(),
}, t => [foreignKey({ columns:[t.organizationId,t.campaignId,t.creatorAccountId],foreignColumns:[campaignCreators.organizationId,campaignCreators.campaignId,campaignCreators.creatorAccountId] }),
  unique("outreach_draft_scope").on(t.organizationId,t.id),
  foreignKey({ columns:[t.organizationId,t.senderAccountId],foreignColumns:[senderAccounts.organizationId,senderAccounts.id] }),
  foreignKey({ columns:[t.organizationId,t.createdBy],foreignColumns:[memberships.organizationId,memberships.userId] }), foreignKey({ columns:[t.organizationId,t.updatedBy],foreignColumns:[memberships.organizationId,memberships.userId] }),
  check("outreach_channel", sql`${t.channel} in ('email','instagram','tiktok')`), check("outreach_status", sql`${t.status} in ('draft','sending','sent','failed','unknown')`), check("outreach_template", sql`${t.template} in ('letter','brand','proposal','followup')`),
]);
export const instagramDmSends = pgTable("instagram_dm_sends", {
  id:uuid().primaryKey(),organizationId:uuid("organization_id").notNull(),accountId:uuid("account_id").notNull(),draftId:uuid("draft_id"),
  conversationId:text("conversation_id").notNull(),senderProviderId:text("sender_provider_id").notNull(),fromUsername:text("from_username").notNull(),recipientId:text("recipient_id").notNull(),recipientUsername:text("recipient_username").notNull(),body:text().notNull(),inputSha256:text("input_sha256").notNull(),
  status:text({enum:["sending","sent","failed","unknown"]}).notNull().default("sending"),errorCode:text("error_code"),graphCode:integer("graph_code"),graphSubcode:integer("graph_subcode"),providerMessageId:text("provider_message_id"),sentAt:timestamp("sent_at",{withTimezone:true}),createdBy:uuid("created_by").notNull(),...dates(),
},t=>[foreignKey({columns:[t.organizationId,t.accountId],foreignColumns:[senderAccounts.organizationId,senderAccounts.id]}),foreignKey({columns:[t.organizationId,t.draftId],foreignColumns:[outreachDrafts.organizationId,outreachDrafts.id]}),foreignKey({columns:[t.organizationId,t.createdBy],foreignColumns:[memberships.organizationId,memberships.userId]}),check("instagram_dm_status",sql`${t.status} in ('sending','sent','failed','unknown')`)]);
export const browserOutreachSends=pgTable("outreach_browser_sends",{
  id:uuid().primaryKey(),organizationId:uuid("organization_id").notNull(),accountId:uuid("account_id").notNull(),draftId:uuid("draft_id"),draftRevision:integer("draft_revision"),senderUsername:text("sender_username").notNull(),recipientUsername:text("recipient_username").notNull(),body:text().notNull(),inputSha256:text("input_sha256").notNull(),
  state:text().$type<BrowserSendState>().notNull().default("queued"),workerId:uuid("worker_id"),instanceId:uuid("instance_id"),claimHash:text("claim_hash"),claimExpiresAt:timestamp("claim_expires_at",{withTimezone:true}),armedAt:timestamp("armed_at",{withTimezone:true}),sentAt:timestamp("sent_at",{withTimezone:true}),
  observation:jsonb().$type<BrowserObservation|null>(),observationSha256:text("observation_sha256"),reason:text(),createdBy:uuid("created_by").notNull(),...dates(),
},t=>[foreignKey({columns:[t.organizationId,t.accountId],foreignColumns:[senderAccounts.organizationId,senderAccounts.id]}),foreignKey({columns:[t.organizationId,t.draftId],foreignColumns:[outreachDrafts.organizationId,outreachDrafts.id]}),foreignKey({columns:[t.organizationId,t.workerId],foreignColumns:[discoveryWorkers.organizationId,discoveryWorkers.id]}),foreignKey({columns:[t.organizationId,t.createdBy],foreignColumns:[memberships.organizationId,memberships.userId]})]);
export const outreachProviderApps = pgTable("outreach_provider_apps", {
  organizationId: uuid("organization_id").notNull(), provider: text({enum:["google","instagram","tiktok"]}).notNull(),
  id: uuid().defaultRandom().primaryKey(), credentialsCiphertext: text("credentials_ciphertext").notNull(), revision: integer().notNull().default(1),
  createdBy: uuid("created_by").notNull(), updatedBy: uuid("updated_by").notNull(), ...dates(),
}, t => [unique("outreach_app_provider").on(t.organizationId,t.provider),
  foreignKey({columns:[t.organizationId,t.createdBy],foreignColumns:[memberships.organizationId,memberships.userId]}),
  foreignKey({columns:[t.organizationId,t.updatedBy],foreignColumns:[memberships.organizationId,memberships.userId]})]);
export const outreachBrandSettings = pgTable("outreach_brand_settings", {
  organizationId: uuid("organization_id").primaryKey(), branding: jsonb().$type<MailBranding>().notNull(), revision: integer().notNull().default(1),
  createdBy: uuid("created_by").notNull(), updatedBy: uuid("updated_by").notNull(), ...dates(),
}, t => [foreignKey({columns:[t.organizationId,t.createdBy],foreignColumns:[memberships.organizationId,memberships.userId]}),
  foreignKey({columns:[t.organizationId,t.updatedBy],foreignColumns:[memberships.organizationId,memberships.userId]})]);
export const outreachTemplates = pgTable("outreach_templates", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull(),
  name: text().notNull(), channel: text({enum:["email","instagram","tiktok"]}).notNull(), language: text({enum:["한국어","English"]}).notNull(),
  layout: text({enum:["letter","brand","proposal","followup"]}).notNull(), subject: text().notNull(), body: text().notNull(), revision: integer().notNull().default(1),
  archivedAt: timestamp("archived_at",{withTimezone:true}),
  createdBy: uuid("created_by").notNull(), updatedBy: uuid("updated_by").notNull(), ...dates(),
}, t => [foreignKey({columns:[t.organizationId,t.createdBy],foreignColumns:[memberships.organizationId,memberships.userId]}),
  foreignKey({columns:[t.organizationId,t.updatedBy],foreignColumns:[memberships.organizationId,memberships.userId]})]);

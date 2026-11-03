import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, jsonb, unique, foreignKey, check, integer } from "drizzle-orm/pg-core";
import { memberships } from "./schema";
import { campaignCreators } from "./discovery-schema";
import type { SenderAddress } from "../outreach/contracts";
const dates = () => ({ createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull() });
export const senderAccounts = pgTable("outreach_sender_accounts", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull(),
  provider: text({ enum: ["google", "instagram", "tiktok"] }).notNull(), label: text().notNull(), expectedIdentity: text("expected_identity").notNull(),
  providerId: text("provider_id"), identity: text(), addresses: jsonb().$type<SenderAddress[]>().notNull().default([]), scopes: text().array().notNull().default(sql`'{}'::text[]`),
  status: text({ enum: ["pending", "connected", "reconnect", "disconnected"] }).notNull().default("pending"),
  tokenCiphertext: text("token_ciphertext"), expiresAt: timestamp("expires_at", { withTimezone: true }), verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(), updatedBy: uuid("updated_by").notNull(), ...dates(),
}, t => [unique("sender_scope").on(t.organizationId, t.id), unique("sender_expected").on(t.organizationId,t.provider,t.expectedIdentity), unique("sender_provider_identity").on(t.organizationId,t.provider,t.providerId),
  foreignKey({ columns:[t.organizationId,t.createdBy], foreignColumns:[memberships.organizationId,memberships.userId] }),
  foreignKey({ columns:[t.organizationId,t.updatedBy], foreignColumns:[memberships.organizationId,memberships.userId] }),
  check("sender_provider", sql`${t.provider} in ('google','instagram','tiktok')`), check("sender_status", sql`${t.status} in ('pending','connected','reconnect','disconnected')`),
  check("sender_connected", sql`${t.status}<>'connected' or (${t.providerId} is not null and ${t.identity} is not null and ${t.tokenCiphertext} is not null and ${t.verifiedAt} is not null)`),
]);
export const senderOAuthStates = pgTable("outreach_oauth_states", {
  stateHash: text("state_hash").primaryKey(), organizationId: uuid("organization_id").notNull(), accountId: uuid("account_id").notNull(), userId: uuid("user_id").notNull(),
  sessionHash: text("session_hash").notNull(), verifierCiphertext: text("verifier_ciphertext").notNull(), aliases: text({ enum:["yes","no"] }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), consumedAt: timestamp("consumed_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [foreignKey({ columns:[t.organizationId,t.accountId],foreignColumns:[senderAccounts.organizationId,senderAccounts.id] }), foreignKey({ columns:[t.organizationId,t.userId],foreignColumns:[memberships.organizationId,memberships.userId] })]);
export const outreachDrafts = pgTable("outreach_drafts", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull(), campaignId: uuid("campaign_id").notNull(), creatorAccountId: uuid("creator_account_id").notNull(),
  inputSha256: text("input_sha256").notNull(), channel: text({ enum:["email","instagram","tiktok"] }).notNull(), subject: text().notNull().default(""), body: text().notNull().default(""),
  template: text({ enum:["letter","brand"] }).notNull().default("letter"), senderAccountId: uuid("sender_account_id"), fromAddress: text("from_address").notNull().default(""), toAddress: text("to_address").notNull().default(""), recipientSource: text("recipient_source").notNull().default(""),
  revision: integer().notNull().default(1), status: text({ enum:["draft","sending","sent","failed","unknown"] }).notNull().default("draft"),
  providerMessageId: text("provider_message_id"), sentAt: timestamp("sent_at", { withTimezone: true }), createdBy: uuid("created_by").notNull(), updatedBy: uuid("updated_by").notNull(), ...dates(),
}, t => [foreignKey({ columns:[t.organizationId,t.campaignId,t.creatorAccountId],foreignColumns:[campaignCreators.organizationId,campaignCreators.campaignId,campaignCreators.creatorAccountId] }),
  foreignKey({ columns:[t.organizationId,t.senderAccountId],foreignColumns:[senderAccounts.organizationId,senderAccounts.id] }),
  foreignKey({ columns:[t.organizationId,t.createdBy],foreignColumns:[memberships.organizationId,memberships.userId] }), foreignKey({ columns:[t.organizationId,t.updatedBy],foreignColumns:[memberships.organizationId,memberships.userId] }),
  check("outreach_channel", sql`${t.channel} in ('email','instagram','tiktok')`), check("outreach_status", sql`${t.status} in ('draft','sending','sent','failed','unknown')`), check("outreach_template", sql`${t.template} in ('letter','brand')`),
]);

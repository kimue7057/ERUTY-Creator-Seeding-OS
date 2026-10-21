import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, bigint, jsonb, primaryKey, unique, uniqueIndex, foreignKey, check, index } from "drizzle-orm/pg-core";

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export const organizations = pgTable("organizations", {
  id: uuid().defaultRandom().primaryKey(), name: text().notNull(), ...timestamps(),
});
export const users = pgTable("users", {
  id: uuid().defaultRandom().primaryKey(), email: text().notNull().unique(),
  name: text().notNull(), passwordHash: text("password_hash").notNull(), ...timestamps(),
});
export const memberships = pgTable("organization_memberships", {
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  role: text({ enum: ["admin", "manager", "reviewer"] }).notNull(), ...timestamps(),
}, t => [primaryKey({ columns: [t.organizationId, t.userId] }), check("membership_role", sql`${t.role} in ('admin', 'manager', 'reviewer')`)]);
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(), userId: uuid("user_id").notNull(),
  organizationId: uuid("organization_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), ...timestamps(),
}, t => [foreignKey({ columns: [t.organizationId, t.userId], foreignColumns: [memberships.organizationId, memberships.userId] }).onDelete("cascade")]);
export const loginAttempts = pgTable("login_attempts", {
  emailKey: text("email_key").primaryKey(), attempts: integer().default(0).notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).defaultNow().notNull(),
});
export const projects = pgTable("projects", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: text().notNull(), website: text().notNull().default(""), summary: text().notNull().default(""),
  usp: text().notNull().default(""), brandStyle: text("brand_style").notNull().default(""),
  referenceUrls: text("reference_urls").array().notNull().default(sql`'{}'::text[]`),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  updatedBy: uuid("updated_by").notNull().references(() => users.id), ...timestamps(),
}, t => [unique("project_org_identity").on(t.organizationId, t.id), index("projects_org").on(t.organizationId)]);
export const products = pgTable("products", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull(),
  projectId: uuid("project_id").notNull(), name: text().notNull(),
  features: text().notNull().default(""), url: text().notNull().default(""),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  updatedBy: uuid("updated_by").notNull().references(() => users.id), ...timestamps(),
}, t => [
  unique("product_project_identity").on(t.organizationId, t.projectId, t.id),
  foreignKey({ columns: [t.organizationId, t.projectId], foreignColumns: [projects.organizationId, projects.id] }),
]);
export const projectAssets = pgTable("project_assets", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull(),
  projectId: uuid("project_id").notNull(), productId: uuid("product_id"),
  name: text().notNull(), kind: text().notNull(), objectPath: text("object_path").notNull(),
  category: text().default("other").notNull(),
  version: integer().notNull().default(1),
  provenance: jsonb().$type<{ source: string; verificationStatus: "unverified" | "staff_uploaded" }>().notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  updatedBy: uuid("updated_by").notNull().references(() => users.id), ...timestamps(),
}, t => [
  foreignKey({ columns: [t.organizationId, t.projectId], foreignColumns: [projects.organizationId, projects.id] }),
  foreignKey({ columns: [t.organizationId, t.projectId, t.productId], foreignColumns: [products.organizationId, products.projectId, products.id] }),
  check("asset_positive_version", sql`${t.version} > 0`),
  unique("asset_scoped_identity").on(t.organizationId, t.projectId, t.id),
  check("asset_category", sql`${t.category} in ('brand_intro', 'product_image', 'advertising_video', 'brand_guide', 'other')`),
]);
export const projectAssetVersions = pgTable("project_asset_versions", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull(), projectId: uuid("project_id").notNull(),
  assetId: uuid("asset_id").notNull(), version: integer().notNull(), objectPath: text("object_path").notNull(),
  storageVersionId: text("storage_version_id"), originalName: text("original_name").notNull(),
  mimeType: text("mime_type"), byteSize: bigint("byte_size", { mode: "number" }), sha256: text(),
  verificationStatus: text("verification_status", { enum: ["verified", "legacy_unverified"] }).notNull(),
  uploadId: uuid("upload_id").unique(), createdBy: uuid("created_by").notNull().references(() => users.id), ...timestamps(),
}, t => [
  unique("asset_version_number").on(t.assetId, t.version),
  uniqueIndex("asset_verified_object").on(t.objectPath).where(sql`${t.verificationStatus} = 'verified'`),
  unique("asset_version_scoped_identity").on(t.organizationId, t.projectId, t.id),
  foreignKey({ columns: [t.organizationId, t.projectId, t.assetId], foreignColumns: [projectAssets.organizationId, projectAssets.projectId, projectAssets.id] }),
  check("asset_version_valid", sql`${t.version} > 0 and (${t.verificationStatus} = 'legacy_unverified' or (${t.verificationStatus} = 'verified' and ${t.sha256} is not null and ${t.sha256} ~ '^[a-f0-9]{64}$' and ${t.byteSize} is not null and ${t.byteSize} > 0 and ${t.mimeType} is not null and ${t.mimeType} in ('application/pdf','image/jpeg','image/png','image/webp','video/mp4')))`),
]);
export const assetUploads = pgTable("asset_uploads", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull(), projectId: uuid("project_id").notNull(),
  assetId: uuid("asset_id"), productId: uuid("product_id"), name: text().notNull(), category: text().notNull(),
  originalName: text("original_name").notNull(), declaredMime: text("declared_mime").notNull(), expectedSize: bigint("expected_size", { mode: "number" }).notNull(),
  objectPath: text("object_path").notNull().unique(),
  state: text({ enum: ["pending", "receiving", "completed", "failed", "cancelled"] }).default("pending").notNull(),
  failureCode: text("failure_code"), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id), ...timestamps(),
}, t => [
  foreignKey({ columns: [t.organizationId, t.projectId], foreignColumns: [projects.organizationId, projects.id] }),
  foreignKey({ columns: [t.organizationId, t.projectId, t.assetId], foreignColumns: [projectAssets.organizationId, projectAssets.projectId, projectAssets.id] }),
  foreignKey({ columns: [t.organizationId, t.projectId, t.productId], foreignColumns: [products.organizationId, products.projectId, products.id] }),
  index("asset_upload_expiry").on(t.state, t.expiresAt),
  check("upload_state_valid", sql`${t.state} in ('pending','receiving','completed','failed','cancelled')`),
  check("upload_size_valid", sql`${t.expectedSize} > 0 and ${t.expectedSize} <= 52428800`),
]);
export type BriefSnapshot = {
  version: 1; capturedAt: string;
  project: { id: string; name: string; website: string; summary: string; usp: string; brandStyle: string; referenceUrls: string[] };
  products: { id: string; name: string; features: string; url: string }[];
  assets: { id: string; name: string; kind: string; version: number; objectPath: string; versionId?: string; sha256?: string; mimeType?: string; byteSize?: number }[];
};
export const campaigns = pgTable("campaigns", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull(), projectId: uuid("project_id").notNull(),
  title: text().notNull(), countryCodes: text("country_codes").array().notNull(), platforms: text().array().notNull(),
  categories: text().array().notNull(), followerMin: integer("follower_min").notNull(), followerMax: integer("follower_max").notNull(),
  goalCount: integer("goal_count").notNull(), notes: text().notNull().default(""), exclusions: text().notNull().default(""),
  budget: integer(), currency: text().notNull().default("KRW"),
  startsOn: text("starts_on"), endsOn: text("ends_on"),
  status: text({ enum: ["draft", "ready", "archived"] }).notNull().default("draft"),
  briefSnapshot: jsonb("brief_snapshot").$type<BriefSnapshot>().notNull(),
  briefVersion: integer("brief_version").default(1).notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  updatedBy: uuid("updated_by").notNull().references(() => users.id), ...timestamps(),
}, t => [
  unique("campaign_project_identity").on(t.organizationId, t.projectId, t.id),
  index("campaigns_org_project").on(t.organizationId, t.projectId),
  foreignKey({ columns: [t.organizationId, t.projectId], foreignColumns: [projects.organizationId, projects.id] }),
  check("campaign_follower_bounds", sql`${t.followerMin} >= 0 and ${t.followerMax} >= ${t.followerMin}`),
  check("campaign_goal", sql`${t.goalCount} > 0`),
  check("campaign_brief_version", sql`${t.briefVersion} > 0`),
  check("campaign_budget", sql`${t.budget} is null or ${t.budget} >= 0`),
  check("campaign_status", sql`${t.status} in ('draft', 'ready', 'archived')`),
  check("campaign_countries", sql`cardinality(${t.countryCodes}) > 0`),
  check("campaign_platforms", sql`cardinality(${t.platforms}) > 0 and ${t.platforms} <@ ARRAY['instagram', 'tiktok', 'youtube']::text[]`),
]);
export const campaignProducts = pgTable("campaign_products", {
  organizationId: uuid("organization_id").notNull(), projectId: uuid("project_id").notNull(),
  campaignId: uuid("campaign_id").notNull(), productId: uuid("product_id").notNull(),
}, t => [
  primaryKey({ columns: [t.campaignId, t.productId] }),
  foreignKey({ columns: [t.organizationId, t.projectId, t.campaignId], foreignColumns: [campaigns.organizationId, campaigns.projectId, campaigns.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.organizationId, t.projectId, t.productId], foreignColumns: [products.organizationId, products.projectId, products.id] }),
]);
export const campaignBriefRevisions = pgTable("campaign_brief_revisions", {
  organizationId: uuid("organization_id").notNull(), projectId: uuid("project_id").notNull(),
  campaignId: uuid("campaign_id").notNull(), version: integer().notNull(),
  snapshot: jsonb().$type<BriefSnapshot>().notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id), ...timestamps(),
}, t => [
  primaryKey({ columns: [t.campaignId, t.version] }),
  unique("campaign_brief_scoped_identity").on(t.organizationId, t.projectId, t.campaignId, t.version),
  foreignKey({ columns: [t.organizationId, t.projectId, t.campaignId], foreignColumns: [campaigns.organizationId, campaigns.projectId, campaigns.id] }).onDelete("cascade"),
  check("brief_revision_version", sql`${t.version} > 0`),
]);
export const campaignAssetReferences = pgTable("campaign_asset_references", {
  organizationId: uuid("organization_id").notNull(), projectId: uuid("project_id").notNull(), campaignId: uuid("campaign_id").notNull(),
  briefVersion: integer("brief_version").notNull(), assetVersionId: uuid("asset_version_id").notNull(),
}, t => [
  primaryKey({ columns: [t.campaignId, t.briefVersion, t.assetVersionId] }),
  foreignKey({ columns: [t.organizationId, t.projectId, t.campaignId, t.briefVersion], foreignColumns: [campaignBriefRevisions.organizationId, campaignBriefRevisions.projectId, campaignBriefRevisions.campaignId, campaignBriefRevisions.version] }).onDelete("cascade"),
  foreignKey({ columns: [t.organizationId, t.projectId, t.assetVersionId], foreignColumns: [projectAssetVersions.organizationId, projectAssetVersions.projectId, projectAssetVersions.id] }),
]);
export const auditEvents = pgTable("audit_events", {
  id: uuid().defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  actorId: uuid("actor_id").notNull().references(() => users.id),
  entityId: uuid("entity_id").notNull(), action: text().notNull(), ...timestamps(),
});

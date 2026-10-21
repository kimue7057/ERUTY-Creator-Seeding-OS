import { and, eq, desc, ilike, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { projects, products, projectAssets, auditEvents } from "../db/schema";
import { assertWriter, type ActorScope } from "../auth/permissions";
import { idSchema, projectSchema, productSchema, type ProjectInput, type ProductInput } from "../validation/projects";

const projectScope = (actor: ActorScope, id: string) => and(eq(projects.organizationId, actor.organizationId), eq(projects.id, idSchema.parse(id)));
export async function listProjects(actor: ActorScope, query = "") {
  // LIKE wildcard escaping keeps user searches literal.
  const search = query.trim().slice(0, 100).replace(/[\\%_]/g, "\\$&");
  return db.select({
    id: projects.id, name: projects.name, summary: projects.summary, website: projects.website, updatedAt: projects.updatedAt,
    productCount: sql<number>`(select count(*)::int from products p where p.project_id = ${projects.id} and p.organization_id = ${projects.organizationId} and p.archived_at is null)`,
    campaignCount: sql<number>`(select count(*)::int from campaigns c where c.project_id = ${projects.id} and c.organization_id = ${projects.organizationId})`,
  }).from(projects).where(and(eq(projects.organizationId, actor.organizationId), search ? ilike(projects.name, `%${search}%`) : undefined)).orderBy(desc(projects.updatedAt)).limit(100);
}
export async function getProject(actor: ActorScope, id: string) {
  const [project] = await db.select().from(projects).where(projectScope(actor, id));
  return project ?? null;
}
export async function projectProducts(actor: ActorScope, projectId: string) {
  return db.select().from(products).where(and(eq(products.organizationId, actor.organizationId), eq(products.projectId, idSchema.parse(projectId)), isNull(products.archivedAt))).orderBy(products.createdAt);
}
export async function projectAssetList(actor: ActorScope, projectId: string) {
  return db.select().from(projectAssets).where(and(eq(projectAssets.organizationId, actor.organizationId), eq(projectAssets.projectId, idSchema.parse(projectId)))).orderBy(desc(projectAssets.createdAt));
}
export async function saveProject(actor: ActorScope, input: ProjectInput, id?: string) {
  assertWriter(actor);
  const data = projectSchema.parse(input);
  return db.transaction(async tx => {
    const [record] = id
      ? await tx.update(projects).set({ ...data, updatedAt: new Date(), updatedBy: actor.userId }).where(projectScope(actor, id)).returning()
      : await tx.insert(projects).values({ ...data, organizationId: actor.organizationId, createdBy: actor.userId, updatedBy: actor.userId }).returning();
    if (!record) throw new Error("프로젝트를 찾을 수 없거나 편집 권한이 없습니다.");
    await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: record.id, action: id ? "project.updated" : "project.created" });
    return record;
  });
}
export async function saveProduct(actor: ActorScope, projectId: string, input: ProductInput, id?: string) {
  assertWriter(actor);
  idSchema.parse(projectId);
  const data = productSchema.parse(input);
  return db.transaction(async tx => {
    const [project] = await tx.select({ id: projects.id }).from(projects).where(projectScope(actor, projectId));
    if (!project) throw new Error("프로젝트를 찾을 수 없거나 편집 권한이 없습니다.");
    const [record] = id
      ? await tx.update(products).set({ ...data, updatedBy: actor.userId, updatedAt: new Date() }).where(and(eq(products.id, idSchema.parse(id)), eq(products.projectId, projectId), eq(products.organizationId, actor.organizationId), isNull(products.archivedAt))).returning()
      : await tx.insert(products).values({ ...data, organizationId: actor.organizationId, projectId, createdBy: actor.userId, updatedBy: actor.userId }).returning();
    if (!record) throw new Error("제품을 찾을 수 없거나 이미 보관되었습니다.");
    await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: record.id, action: id ? "product.updated" : "product.created" });
    return record;
  });
}
export async function archiveProduct(actor: ActorScope, projectId: string, id: string) {
  assertWriter(actor);
  return db.transaction(async tx => {
    const [record] = await tx.update(products).set({ archivedAt: new Date(), updatedAt: new Date(), updatedBy: actor.userId })
      .where(and(eq(products.id, idSchema.parse(id)), eq(products.projectId, idSchema.parse(projectId)), eq(products.organizationId, actor.organizationId), isNull(products.archivedAt))).returning();
    if (!record) throw new Error("제품을 찾을 수 없거나 이미 보관되었습니다.");
    await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: record.id, action: "product.archived" });
  });
}
export async function workspaceCounts(actor: ActorScope) {
  const [counts] = await db.select({
    projects: sql<number>`count(*)::int`,
    products: sql<number>`(select count(*)::int from products where organization_id = ${actor.organizationId} and archived_at is null)`,
    campaigns: sql<number>`(select count(*)::int from campaigns where organization_id = ${actor.organizationId})`,
    ready: sql<number>`(select count(*)::int from campaigns where organization_id = ${actor.organizationId} and status = 'ready')`,
  }).from(projects).where(eq(projects.organizationId, actor.organizationId));
  return counts;
}

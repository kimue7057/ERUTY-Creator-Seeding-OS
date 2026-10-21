import { and, eq, inArray, isNull, or, desc, ilike, arrayContains } from "drizzle-orm";
import { db } from "../db";
import { campaigns, campaignProducts, projects, products, projectAssets, projectAssetVersions, campaignAssetReferences, auditEvents, campaignBriefRevisions, type BriefSnapshot } from "../db/schema";
import { assertWriter, type ActorScope } from "../auth/permissions";
import { idSchema } from "../validation/projects";
import { campaignSchema, type CampaignInput } from "../validation/campaigns";

const scope = (actor: ActorScope, id: string) => and(eq(campaigns.organizationId, actor.organizationId), eq(campaigns.id, idSchema.parse(id)));
export async function listCampaigns(actor: ActorScope, filters: { query?: string; projectId?: string; platform?: string; status?: string } = {}) {
  const query = filters.query?.trim().slice(0, 100).replace(/[\\%_]/g, "\\$&");
  return db.select({ campaign: campaigns, projectName: projects.name }).from(campaigns)
    .innerJoin(projects, and(eq(campaigns.projectId, projects.id), eq(campaigns.organizationId, projects.organizationId)))
    .where(and(eq(campaigns.organizationId, actor.organizationId), query ? ilike(campaigns.title, `%${query}%`) : undefined,
      filters.projectId ? eq(campaigns.projectId, idSchema.parse(filters.projectId)) : undefined,
      filters.platform ? arrayContains(campaigns.platforms, [filters.platform]) : undefined,
      filters.status ? eq(campaigns.status, filters.status as "draft" | "ready" | "archived") : undefined))
    .orderBy(desc(campaigns.updatedAt)).limit(100);
}
export async function getCampaign(actor: ActorScope, id: string) {
  const [campaign] = await db.select().from(campaigns).where(scope(actor, id));
  if (!campaign) return null;
  const [selectedProducts, briefs] = await Promise.all([
    db.select({ id: products.id, name: products.name, features: products.features, url: products.url, archivedAt: products.archivedAt }).from(campaignProducts)
      .innerJoin(products, and(eq(campaignProducts.productId, products.id), eq(campaignProducts.organizationId, products.organizationId), eq(campaignProducts.projectId, products.projectId)))
      .where(and(eq(campaignProducts.organizationId, actor.organizationId), eq(campaignProducts.campaignId, campaign.id))),
    db.select().from(campaignBriefRevisions).where(and(eq(campaignBriefRevisions.organizationId, actor.organizationId), eq(campaignBriefRevisions.campaignId, campaign.id))).orderBy(desc(campaignBriefRevisions.version)),
  ]);
  return { ...campaign, productIds: selectedProducts.map(p => p.id), selectedProducts, briefs };
}
export async function saveCampaign(actor: ActorScope, input: CampaignInput, id?: string) {
  assertWriter(actor);
  const data = campaignSchema.parse(input);
  return db.transaction(async tx => {
    const [existing] = id ? await tx.select().from(campaigns).where(scope(actor, id)).for("update") : [];
    if (id && !existing) throw new Error("캠페인을 찾을 수 없거나 편집 권한이 없습니다.");
    if (existing && existing.projectId !== data.projectId) throw new Error("캠페인의 프로젝트는 변경할 수 없습니다.");
    const [project] = await tx.select().from(projects).where(and(eq(projects.id, data.projectId), eq(projects.organizationId, actor.organizationId)));
    if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
    const previousLinks = existing ? await tx.select().from(campaignProducts).where(and(eq(campaignProducts.campaignId, existing.id), eq(campaignProducts.organizationId, actor.organizationId))) : [];
    const previouslySelected = new Set(previousLinks.map(p => p.productId));
    const selected = await tx.select().from(products).where(and(eq(products.organizationId, actor.organizationId), eq(products.projectId, project.id), inArray(products.id, data.productIds)));
    if (selected.length !== data.productIds.length || selected.some(p => p.archivedAt && !previouslySelected.has(p.id))) throw new Error("같은 프로젝트의 사용 가능한 제품을 선택해 주세요.");
    const productsChanged = !existing || previousLinks.length !== selected.length || selected.some(p => !previouslySelected.has(p.id));
    const assets = productsChanged ? await tx.select().from(projectAssets).where(and(eq(projectAssets.organizationId, actor.organizationId), eq(projectAssets.projectId, project.id), or(isNull(projectAssets.productId), inArray(projectAssets.productId, data.productIds)))) : [];
    const assetVersions = assets.length ? await tx.select().from(projectAssetVersions).where(and(eq(projectAssetVersions.organizationId, actor.organizationId), eq(projectAssetVersions.projectId, project.id), inArray(projectAssetVersions.assetId, assets.map(a => a.id)))) : [];
    const snapshot: BriefSnapshot = {
      version: 1, capturedAt: new Date().toISOString(),
      project: { id: project.id, name: project.name, website: project.website, summary: project.summary, usp: project.usp, brandStyle: project.brandStyle, referenceUrls: project.referenceUrls },
      products: selected.map(p => ({ id: p.id, name: p.name, features: p.features, url: p.url })),
      assets: assets.map(a => {
        const version = assetVersions.find(v => v.assetId === a.id && v.version === a.version && v.objectPath === a.objectPath);
        return { id: a.id, name: a.name, kind: a.kind, version: a.version, objectPath: a.objectPath, ...(version ? { versionId: version.id, ...(version.sha256 ? { sha256: version.sha256, mimeType: version.mimeType!, byteSize: version.byteSize! } : {}) } : {}) };
      }),
    };
    const { productIds, ...fields } = data;
    const briefVersion = existing ? existing.briefVersion + (productsChanged ? 1 : 0) : 1;
    const [record] = existing
      ? await tx.update(campaigns).set({ ...fields, briefVersion, updatedAt: new Date(), updatedBy: actor.userId }).where(scope(actor, existing.id)).returning()
      : await tx.insert(campaigns).values({ ...fields, briefSnapshot: snapshot, briefVersion, organizationId: actor.organizationId, createdBy: actor.userId, updatedBy: actor.userId }).returning();
    if (productsChanged) await tx.insert(campaignBriefRevisions).values({ organizationId: actor.organizationId, projectId: project.id, campaignId: record.id, version: briefVersion, snapshot, createdBy: actor.userId });
    const referenced = snapshot.assets.filter(a => a.versionId);
    if (productsChanged && referenced.length) await tx.insert(campaignAssetReferences).values(referenced.map(a => ({ organizationId: actor.organizationId, projectId: project.id, campaignId: record.id, briefVersion, assetVersionId: a.versionId! })));
    if (existing) await tx.delete(campaignProducts).where(and(eq(campaignProducts.campaignId, record.id), eq(campaignProducts.organizationId, actor.organizationId)));
    await tx.insert(campaignProducts).values(productIds.map(productId => ({ organizationId: actor.organizationId, projectId: project.id, campaignId: record.id, productId })));
    await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: record.id, action: existing ? "campaign.updated" : "campaign.created" });
    return record;
  }, { isolationLevel: "repeatable read" });
}

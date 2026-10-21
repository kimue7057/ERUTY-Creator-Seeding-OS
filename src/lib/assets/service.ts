import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { and, eq, gt, inArray, sql, desc, count } from "drizzle-orm";
import { db } from "../db";
import { projects, products, projectAssets, projectAssetVersions, assetUploads, auditEvents, campaignBriefRevisions } from "../db/schema";
import { canWrite, type ActorScope } from "../auth/permissions";
import { idSchema } from "../validation/projects";
import { assetMetadataSchema, uploadIntentSchema, type AcceptedMime, type UploadIntentInput } from "../validation/assets";
import type { AssetStorage, StoredObject } from "../storage/contracts";
import { receiveFile } from "./receive";
import { AssetError, denied } from "./errors";

async function projectAccess(actor: ActorScope, projectId: string, write = false) {
  if (write && !canWrite(actor)) throw new AssetError(403, "read_only", "이 계정은 자료 조회만 가능합니다. 업로드·편집 권한이 필요합니다.");
  const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, idSchema.parse(projectId)), eq(projects.organizationId, actor.organizationId)));
  if (!project) throw denied();
}
async function productAccess(actor: ActorScope, projectId: string, productId: string | null) {
  if (!productId) return;
  const [product] = await db.select({ id: products.id }).from(products).where(and(eq(products.id, productId), eq(products.projectId, projectId), eq(products.organizationId, actor.organizationId)));
  if (!product) throw denied();
}
const assetScope = (actor: ActorScope, projectId: string, assetId: string) => and(eq(projectAssets.organizationId, actor.organizationId), eq(projectAssets.projectId, projectId), eq(projectAssets.id, idSchema.parse(assetId)));
export async function listAssets(actor: ActorScope, projectId: string) {
  await projectAccess(actor, projectId);
  const [assets, versions] = await Promise.all([
    db.select().from(projectAssets).where(and(eq(projectAssets.organizationId, actor.organizationId), eq(projectAssets.projectId, projectId))).orderBy(desc(projectAssets.updatedAt)),
    db.select({ id: projectAssetVersions.id, assetId: projectAssetVersions.assetId, version: projectAssetVersions.version, originalName: projectAssetVersions.originalName, mimeType: projectAssetVersions.mimeType, byteSize: projectAssetVersions.byteSize, sha256: projectAssetVersions.sha256, verificationStatus: projectAssetVersions.verificationStatus, createdAt: projectAssetVersions.createdAt }).from(projectAssetVersions).where(and(eq(projectAssetVersions.organizationId, actor.organizationId), eq(projectAssetVersions.projectId, projectId))).orderBy(desc(projectAssetVersions.version)),
  ]);
  return assets.map(a => ({ id: a.id, name: a.name, kind: a.kind, category: a.category, productId: a.productId, currentVersion: a.version, versions: versions.filter(v => v.assetId === a.id) }));
}
export async function briefVersionLinks(actor: ActorScope, projectId: string, briefs: { version: number; snapshot: { assets: { id: string; version: number; objectPath: string }[] } }[]) {
  await projectAccess(actor, projectId);
  const versions = await db.select().from(projectAssetVersions).where(and(eq(projectAssetVersions.organizationId, actor.organizationId), eq(projectAssetVersions.projectId, projectId)));
  const links: Record<string, string> = {};
  for (const brief of briefs) for (const asset of brief.snapshot.assets) {
    const version = versions.find(v => v.assetId === asset.id && v.version === asset.version && v.objectPath === asset.objectPath && v.verificationStatus === "verified");
    if (version) links[`${brief.version}/${asset.id}/${asset.version}`] = version.id;
  }
  return links;
}
export async function beginUpload(actor: ActorScope, projectId: string, input: UploadIntentInput) {
  await projectAccess(actor, projectId, true);
  const data = uploadIntentSchema.parse(input);
  await productAccess(actor, projectId, data.productId);
  if (data.assetId) {
    const [asset] = await db.select().from(projectAssets).where(assetScope(actor, projectId, data.assetId));
    if (!asset) throw denied();
  }
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor.userId}))`);
    const [active] = await tx.select({ count: count() }).from(assetUploads).where(and(eq(assetUploads.createdBy, actor.userId), inArray(assetUploads.state, ["pending", "receiving"]), gt(assetUploads.expiresAt, new Date())));
    if (active.count >= 3) throw new AssetError(429, "upload_limit", "진행 중인 업로드가 많습니다. 기존 업로드를 완료하거나 취소해 주세요.");
    const id = randomUUID();
    const [intent] = await tx.insert(assetUploads).values({ ...data, id, organizationId: actor.organizationId, projectId, objectPath: `eruty/${actor.organizationId}/${projectId}/${data.assetId ?? id}/${id}`, createdBy: actor.userId, expiresAt: new Date(Date.now() + 15 * 60_000) }).returning();
    return { id: intent.id, expiresAt: intent.expiresAt };
  });
}
export async function receiveUpload(actor: ActorScope, projectId: string, uploadId: string, body: ReadableStream<Uint8Array>, contentType: string, storage: AssetStorage, requestSignal?: AbortSignal) {
  await projectAccess(actor, projectId, true);
  const [intent] = await db.update(assetUploads).set({ state: "receiving", updatedAt: new Date() }).where(and(eq(assetUploads.id, idSchema.parse(uploadId)), eq(assetUploads.organizationId, actor.organizationId), eq(assetUploads.projectId, projectId), eq(assetUploads.createdBy, actor.userId), eq(assetUploads.state, "pending"), gt(assetUploads.expiresAt, new Date()))).returning();
  if (!intent) throw new AssetError(409, "upload_unavailable", "업로드가 만료되었거나 이미 처리되었습니다. 새로 시도해 주세요.");
  const signal = AbortSignal.any([AbortSignal.timeout(5 * 60_000), ...(requestSignal ? [requestSignal] : [])]);
  let temporary: string | undefined; let stored: StoredObject | undefined;
  try {
    if (contentType.split(";")[0].trim().toLowerCase() !== intent.declaredMime) throw new AssetError(422, "mime_mismatch", "요청의 파일 종류가 업로드 정보와 일치하지 않습니다.");
    const file = await receiveFile(body, intent.expectedSize, intent.declaredMime as AcceptedMime, signal);
    temporary = file.path;
    stored = await storage.putFile(intent.objectPath, file.path, file.mime, file.size, file.sha256, signal);
    await storage.verify(stored, file.size, file.sha256, signal);
    signal.throwIfAborted();
    return await db.transaction(async tx => {
      const [current] = await tx.select().from(assetUploads).where(eq(assetUploads.id, intent.id)).for("update");
      if (current.state !== "receiving" || current.expiresAt <= new Date() || signal.aborted) throw new AssetError(409, "cancelled", "업로드가 취소되었거나 만료되었습니다.");
      const [existing] = intent.assetId ? await tx.select().from(projectAssets).where(assetScope(actor, projectId, intent.assetId)).for("update") : [];
      if (intent.assetId && !existing) throw denied();
      const version = existing ? existing.version + 1 : 1;
      const assetId = existing?.id ?? intent.id;
      const kind = file.mime === "application/pdf" ? "pdf" : file.mime.startsWith("image/") ? "image" : "video";
      if (!existing) await tx.insert(projectAssets).values({ id: assetId, organizationId: actor.organizationId, projectId, productId: intent.productId, name: intent.name, category: intent.category, kind, objectPath: stored!.key, version, provenance: { source: "staff_upload", verificationStatus: "staff_uploaded" }, createdBy: actor.userId, updatedBy: actor.userId });
      const [record] = await tx.insert(projectAssetVersions).values({ organizationId: actor.organizationId, projectId, assetId, version, objectPath: stored!.key, storageVersionId: stored!.versionId, originalName: intent.originalName, mimeType: file.mime, byteSize: file.size, sha256: file.sha256, verificationStatus: "verified", uploadId: intent.id, createdBy: actor.userId }).returning();
      if (existing) await tx.update(projectAssets).set({ objectPath: stored!.key, kind, version, updatedAt: new Date(), updatedBy: actor.userId, provenance: { source: "staff_upload", verificationStatus: "staff_uploaded" } }).where(eq(projectAssets.id, assetId));
      await tx.update(assetUploads).set({ state: "completed", updatedAt: new Date() }).where(eq(assetUploads.id, intent.id));
      await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: record.id, action: "asset.version_uploaded" });
      return { assetId, versionId: record.id, version, sha256: file.sha256 };
    });
  } catch (error) {
    // A lost commit acknowledgement is not proof of rollback. Keep any object
    // whose upload may have committed; the reconciler can safely retry later.
    try {
      const [committed] = await db.select({ id: projectAssetVersions.id }).from(projectAssetVersions).where(eq(projectAssetVersions.uploadId, intent.id));
      if (!committed) {
        if (stored) await storage.remove(stored).catch(() => {});
        await db.update(assetUploads).set({ state: "failed", failureCode: error instanceof AssetError ? error.code : signal.aborted ? "interrupted" : "storage_failed", updatedAt: new Date() }).where(and(eq(assetUploads.id, intent.id), inArray(assetUploads.state, ["pending", "receiving"])));
      }
    } catch { /* Leave the durable intent for reconciliation when DB recovers. */ }
    if (error instanceof AssetError) throw error;
    throw new AssetError(signal.aborted ? 408 : 503, signal.aborted ? "interrupted" : "upload_failed", signal.aborted ? "업로드가 중단되었습니다. 파일을 다시 선택해 주세요." : "저장소에 파일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  } finally { if (temporary) await unlink(temporary).catch(() => {}); }
}
export async function cancelUpload(actor: ActorScope, projectId: string, uploadId: string) {
  await projectAccess(actor, projectId, true);
  const [intent] = await db.select().from(assetUploads).where(and(eq(assetUploads.id, idSchema.parse(uploadId)), eq(assetUploads.organizationId, actor.organizationId), eq(assetUploads.projectId, projectId)));
  if (!intent || (intent.createdBy !== actor.userId && actor.role !== "admin")) throw denied();
  const [changed] = await db.update(assetUploads).set({ state: "cancelled", failureCode: "cancelled", updatedAt: new Date() }).where(and(eq(assetUploads.id, intent.id), inArray(assetUploads.state, ["pending", "receiving", "failed", "cancelled"]))).returning();
  if (!changed) throw new AssetError(409, "already_completed", "이미 저장된 파일입니다. 목록을 새로고침해 주세요.");
}
export async function updateAssetMetadata(actor: ActorScope, projectId: string, assetId: string, input: unknown) {
  await projectAccess(actor, projectId, true);
  const data = assetMetadataSchema.parse(input); await productAccess(actor, projectId, data.productId);
  await db.transaction(async tx => {
    const [record] = await tx.update(projectAssets).set({ ...data, updatedBy: actor.userId, updatedAt: new Date() }).where(assetScope(actor, projectId, assetId)).returning();
    if (!record) throw denied();
    await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: record.id, action: "asset.metadata_updated" });
  });
}
export async function assetDownload(actor: ActorScope, projectId: string, assetId: string, versionId: string, inline: boolean, storage: AssetStorage, campaign?: { id: string; briefVersion: number }) {
  await projectAccess(actor, projectId);
  const [version] = await db.select().from(projectAssetVersions).where(and(eq(projectAssetVersions.id, idSchema.parse(versionId)), eq(projectAssetVersions.assetId, idSchema.parse(assetId)), eq(projectAssetVersions.organizationId, actor.organizationId), eq(projectAssetVersions.projectId, projectId)));
  if (!version) throw denied();
  if (campaign) {
    const [brief] = await db.select().from(campaignBriefRevisions).where(and(eq(campaignBriefRevisions.campaignId, idSchema.parse(campaign.id)), eq(campaignBriefRevisions.version, campaign.briefVersion), eq(campaignBriefRevisions.organizationId, actor.organizationId), eq(campaignBriefRevisions.projectId, projectId)));
    if (!brief?.snapshot.assets.some(a => a.id === assetId && a.version === version.version && a.objectPath === version.objectPath)) throw denied();
  }
  if (version.verificationStatus !== "verified" || !version.sha256 || !version.mimeType) throw new AssetError(409, "legacy_unverified", "이전 자료는 실제 저장 여부가 검증되지 않았습니다. 새 버전을 업로드해 주세요.");
  const expiresIn = 60;
  const url = await storage.signedRead({ key: version.objectPath, versionId: version.storageVersionId ?? undefined }, version.mimeType, version.originalName, inline, expiresIn);
  await db.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: version.id, action: inline ? "asset.preview_authorized" : "asset.download_authorized" });
  return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(), sha256: version.sha256, byteSize: version.byteSize, mimeType: version.mimeType };
}

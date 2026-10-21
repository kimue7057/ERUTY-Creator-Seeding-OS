import "dotenv/config";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { eq, and } from "drizzle-orm";
import { db, pool } from "../../src/lib/db";
import { projectAssetVersions, projectAssets, assetUploads, users, memberships } from "../../src/lib/db/schema";
import { createS3Storage } from "../../src/lib/storage/s3";
import { beginUpload, receiveUpload, assetDownload, listAssets, cancelUpload } from "../../src/lib/assets/service";
import { cleanupUploads } from "../../src/lib/assets/cleanup";
import { saveProject, saveProduct } from "../../src/lib/projects/service";
import { saveCampaign, getCampaign } from "../../src/lib/campaigns/service";
import { withWorkspace } from "./fixture";
import { generateAssetFixtures } from "../asset-fixtures";
import type { ActorScope } from "../../src/lib/auth/permissions";
import type { AcceptedMime } from "../../src/lib/validation/assets";
const storage = createS3Storage();
let fixture: Awaited<ReturnType<typeof generateAssetFixtures>>;
before(async () => { process.env.UPLOAD_TMP_DIR = resolve(".local/test-assets/tmp"); fixture = await generateAssetFixtures(resolve(".local/test-assets")); });
after(() => pool.end());
const brand = { name: "TEST asset project", website: "", summary: "Synthetic only", usp: "", brandStyle: "", referenceUrls: [] };
const stream = (bytes: Buffer) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
async function withinStorage(run: (actor: ActorScope, other: ActorScope) => Promise<void>) {
  await withWorkspace(async (actor, other) => {
    try { await run(actor, other); }
    finally { for (const org of [actor.organizationId, other.organizationId]) for (const object of await storage.list(`eruty/${org}/`)) await storage.remove(object); }
  });
}
async function upload(actor: ActorScope, projectId: string, filename: string, mime: AcceptedMime, bytes: Buffer, assetId: string | null = null, productId: string | null = null) {
  const intent = await beginUpload(actor, projectId, { assetId, productId, name: filename, category: "other", originalName: filename, declaredMime: mime, expectedSize: bytes.length });
  return receiveUpload(actor, projectId, intent.id, stream(bytes), mime, storage);
}
test("real S3 PUT/GET verifies PDF/JPG/PNG/WebP/MP4, denies anonymous/cross-organization access, and expires signatures", async () => {
  await withinStorage(async (actor, other) => {
    const project = await saveProject(actor, brand);
    for (const [ext, mime, bytes] of [["pdf", "application/pdf", fixture.bytes.pdf], ["jpg", "image/jpeg", fixture.bytes.jpg], ["png", "image/png", fixture.bytes.png], ["webp", "image/webp", fixture.bytes.webp], ["mp4", "video/mp4", fixture.bytes.mp4]] as const) {
      const result = await upload(actor, project.id, `synthetic.${ext}`, mime, bytes);
      const link = await assetDownload({ ...actor, role: "reviewer" }, project.id, result.assetId, result.versionId, false, storage);
      const response = await fetch(link.url); assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), mime); assert.match(response.headers.get("content-disposition")!, /attachment/);
      assert.equal(createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex"), result.sha256);
      await assert.rejects(() => assetDownload(other, project.id, result.assetId, result.versionId, false, storage));
      await assert.rejects(() => beginUpload({ ...actor, role: "reviewer" }, project.id, { assetId: null, productId: null, name: "bad", category: "other", originalName: "x.png", declaredMime: "image/png", expectedSize: 10 }));
      const [version] = await db.select().from(projectAssetVersions).where(eq(projectAssetVersions.id, result.versionId));
      assert.ok(version.storageVersionId);
      const anonymous = await fetch(`${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${version.objectPath}`); assert.equal(anonymous.status, 403);
      if (ext === "png") {
        const expiring = await storage.signedRead({ key: version.objectPath, versionId: version.storageVersionId ?? undefined }, mime, "x.png", false, 1);
        await new Promise(resolve => setTimeout(resolve, 2100));
        assert.equal((await fetch(expiring)).status, 403);
      }
    }
    assert.equal((await listAssets(actor, project.id)).length, 5);
    assert.ok((await listAssets(actor, project.id)).every(a => !Object.hasOwn(a, "objectPath")));
  });
});
test("new versions retain the old brief bytes, forbid overwrite/update/delete, and serialize concurrent revisions", async () => {
  await withinStorage(async actor => {
    const project = await saveProject(actor, brand); const product = await saveProduct(actor, project.id, { name: "TEST product", features: "", url: "" });
    const first = await upload(actor, project.id, "product.png", "image/png", fixture.bytes.png, null, product.id);
    const campaign = await saveCampaign(actor, { projectId: project.id, title: "TEST frozen files", productIds: [product.id], countryCodes: ["JP"], platforms: ["tiktok"], categories: ["test"], followerMin: 1, followerMax: 10, goalCount: 1, notes: "", exclusions: "", budget: null, currency: "KRW", startsOn: null, endsOn: null, status: "draft" });
    assert.equal(campaign.briefSnapshot.assets[0].versionId, first.versionId);
    await Promise.all([upload(actor, project.id, "product-v2.png", "image/png", fixture.bytes.png2, first.assetId), upload(actor, project.id, "product-v3.png", "image/png", fixture.bytes.png2, first.assetId)]);
    const [asset] = await listAssets(actor, project.id); assert.equal(asset.currentVersion, 3); assert.equal(asset.versions.length, 3);
    const frozen = await getCampaign(actor, campaign.id); assert.equal(frozen!.briefSnapshot.assets[0].versionId, first.versionId);
    const link = await assetDownload(actor, project.id, first.assetId, first.versionId, false, storage, { id: campaign.id, briefVersion: 1 });
    assert.deepEqual(Buffer.from(await (await fetch(link.url)).arrayBuffer()), fixture.bytes.png);
    await assert.rejects(() => assetDownload(actor, project.id, first.assetId, asset.versions[0].id, false, storage, { id: campaign.id, briefVersion: 1 }));
    await assert.rejects(() => db.update(projectAssetVersions).set({ sha256: "0".repeat(64) }).where(eq(projectAssetVersions.id, first.versionId)));
    await assert.rejects(() => db.delete(projectAssetVersions).where(eq(projectAssetVersions.id, first.versionId)));
    const [old] = await db.select().from(projectAssetVersions).where(eq(projectAssetVersions.id, first.versionId));
    await assert.rejects(() => storage.putFile(old.objectPath, fixture.paths.png2, "image/png", fixture.bytes.png2.length, createHash("sha256").update(fixture.bytes.png2).digest("hex")));
    await assert.rejects(() => db.update(projectAssets).set({ version: 1, objectPath: old.objectPath }).where(eq(projectAssets.id, first.assetId)));
  });
});
test("spoofed, oversized, incomplete and interrupted streams publish no files; expired/orphaned uploads are reconciled", async () => {
  await withinStorage(async actor => {
    const project = await saveProject(actor, brand);
    const payload = { assetId: null, productId: null, name: "TEST", category: "other" as const, originalName: "bad.png", declaredMime: "image/png" as const, expectedSize: fixture.bytes.png.length };
    const spoof = await beginUpload(actor, project.id, { ...payload, expectedSize: 30 });
    await assert.rejects(() => receiveUpload(actor, project.id, spoof.id, stream(Buffer.alloc(30, 65)), "image/png", storage), e => (e as { code: string }).code === "type_mismatch");
    const over = await beginUpload(actor, project.id, { ...payload, expectedSize: fixture.bytes.png.length - 1 });
    await assert.rejects(() => receiveUpload(actor, project.id, over.id, stream(fixture.bytes.png), "image/png", storage), e => (e as { status: number }).status === 413);
    const partial = await beginUpload(actor, project.id, payload);
    await assert.rejects(() => receiveUpload(actor, project.id, partial.id, stream(fixture.bytes.png.subarray(0, 10)), "image/png", storage), e => (e as { code: string }).code === "incomplete");
    const interrupted = await beginUpload(actor, project.id, payload); const abort = new AbortController();
    let sent = false;
    const interruptedBody = new ReadableStream<Uint8Array>({ async pull(controller) { if (!sent) { sent = true; controller.enqueue(fixture.bytes.png.subarray(0, 10)); await new Promise(resolve => setTimeout(resolve, 40)); abort.abort(); } } });
    await assert.rejects(() => receiveUpload(actor, project.id, interrupted.id, interruptedBody, "image/png", storage, abort.signal), e => (e as { status: number }).status === 408);
    const orphan = await beginUpload(actor, project.id, payload);
    const [intent] = await db.update(assetUploads).set({ state: "receiving", expiresAt: new Date(Date.now() - 1000) }).where(eq(assetUploads.id, orphan.id)).returning();
    await storage.putFile(intent.objectPath, fixture.paths.png, "image/png", fixture.bytes.png.length, createHash("sha256").update(fixture.bytes.png).digest("hex"));
    const report = await cleanupUploads(storage, new Date(), actor.organizationId);
    assert.equal(report.expiredIntents, 1); assert.equal(report.removedObjects, 1);
    assert.deepEqual(await storage.list(`eruty/${actor.organizationId}/`), []);
    assert.equal((await listAssets(actor, project.id)).length, 0);
    assert.equal((await readdir(process.env.UPLOAD_TMP_DIR!)).filter(name => name.endsWith(".tmp")).length, 0);
    assert.equal((await cleanupUploads(storage, new Date(), actor.organizationId)).removedObjects, 0);
  });
});
test("cancellation after a real S3 write rolls back publication and active-upload quota is bounded", async () => {
  await withinStorage(async actor => {
    const project = await saveProject(actor, brand);
    const payload = { assetId: null, productId: null, name: "TEST", category: "other" as const, originalName: "x.png", declaredMime: "image/png" as const, expectedSize: fixture.bytes.png.length };
    const intent = await beginUpload(actor, project.id, payload);
    const cancellingStorage = { ...storage, async verify(...args: Parameters<typeof storage.verify>) { await storage.verify(...args); await cancelUpload(actor, project.id, intent.id); } };
    await assert.rejects(() => receiveUpload(actor, project.id, intent.id, stream(fixture.bytes.png), "image/png", cancellingStorage));
    assert.equal((await listAssets(actor, project.id)).length, 0); assert.deepEqual(await storage.list(`eruty/${actor.organizationId}/`), []);
    for (let n = 0; n < 3; n++) await beginUpload(actor, project.id, payload);
    await assert.rejects(() => beginUpload(actor, project.id, payload), e => (e as { status: number }).status === 429);
    const waiting = await db.select().from(assetUploads).where(and(eq(assetUploads.organizationId, actor.organizationId), eq(assetUploads.state, "pending")));
    for (const row of waiting) await cancelUpload(actor, project.id, row.id);
  });
});
test("another manager in the same organization cannot consume or cancel a user's upload intent", async () => {
  await withinStorage(async actor => {
    const [colleague] = await db.insert(users).values({ email: `${randomUUID()}@example.invalid`, name: "Synthetic colleague", passwordHash: "no-login" }).returning();
    await db.insert(memberships).values({ organizationId: actor.organizationId, userId: colleague.id, role: "manager" });
    try {
      const project = await saveProject(actor, brand);
      const intent = await beginUpload(actor, project.id, { assetId: null, productId: null, name: "TEST", category: "other", originalName: "x.png", declaredMime: "image/png", expectedSize: fixture.bytes.png.length });
      const manager: ActorScope = { ...actor, userId: colleague.id, role: "manager" };
      await assert.rejects(() => receiveUpload(manager, project.id, intent.id, stream(fixture.bytes.png), "image/png", storage));
      await assert.rejects(() => cancelUpload(manager, project.id, intent.id));
      await cancelUpload(actor, project.id, intent.id);
    } finally {
      await db.delete(memberships).where(and(eq(memberships.organizationId, actor.organizationId), eq(memberships.userId, colleague.id)));
      await db.delete(users).where(eq(users.id, colleague.id));
    }
  });
});
test("an S3 success with a lost acknowledgement leaves a reclaimable orphan and never publishes a file", async () => {
  await withinStorage(async actor => {
    const project = await saveProject(actor, brand);
    const intent = await beginUpload(actor, project.id, { assetId: null, productId: null, name: "TEST", category: "other", originalName: "x.png", declaredMime: "image/png", expectedSize: fixture.bytes.png.length });
    const lostAcknowledgement = { ...storage, async putFile(...args: Parameters<typeof storage.putFile>) { await storage.putFile(...args); throw new Error("Synthetic lost acknowledgement after real PUT"); } };
    await assert.rejects(() => receiveUpload(actor, project.id, intent.id, stream(fixture.bytes.png), "image/png", lostAcknowledgement));
    assert.equal((await listAssets(actor, project.id)).length, 0);
    assert.equal((await storage.list(`eruty/${actor.organizationId}/`)).length, 1);
    assert.equal((await cleanupUploads(storage, new Date(), actor.organizationId)).removedObjects, 1);
    assert.deepEqual(await storage.list(`eruty/${actor.organizationId}/`), []);
  });
});

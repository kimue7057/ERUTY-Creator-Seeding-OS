import "dotenv/config";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { resolve } from "node:path";
import { db, pool } from "../src/lib/db";
import { users, memberships } from "../src/lib/db/schema";
import { listProjects, projectProducts } from "../src/lib/projects/service";
import { listAssets, beginUpload, receiveUpload, assetDownload } from "../src/lib/assets/service";
import { saveCampaign, listCampaigns } from "../src/lib/campaigns/service";
import { createS3Storage } from "../src/lib/storage/s3";
import { generateAssetFixtures } from "../tests/asset-fixtures";
try {
  if (process.env.NODE_ENV === "production") throw new Error("Synthetic demo is development only");
  const [user] = await db.select().from(users).where(eq(users.email, process.env.BOOTSTRAP_EMAIL?.toLowerCase() ?? ""));
  if (!user) throw new Error("Run db:seed and db:demo first");
  const [membership] = await db.select().from(memberships).where(eq(memberships.userId, user.id)).orderBy(memberships.createdAt, memberships.organizationId).limit(1);
  const actor = { userId: user.id, organizationId: membership.organizationId, role: membership.role };
  const project = (await listProjects(actor, "[샘플] 리플러츠")).find(p => p.name === "[샘플] 리플러츠");
  if (!project) throw new Error("Run db:demo first. Only the explicitly labeled sample project is modified.");
  const product = (await projectProducts(actor, project.id))[0]; if (!product) throw new Error("Sample product missing");
  const storage = createS3Storage(); const fixture = await generateAssetFixtures(resolve(".local/qa/fixtures"));
  let assets = await listAssets(actor, project.id);
  for (const item of [
    { name: "[테스트] 리플러츠 브랜드 소개서.pdf", originalName: "brand-test.pdf", mime: "application/pdf" as const, category: "brand_intro" as const, bytes: fixture.bytes.pdf, productId: null },
    { name: "[테스트] 제품 이미지.png", originalName: "product-test.png", mime: "image/png" as const, category: "product_image" as const, bytes: fixture.bytes.png, productId: product.id },
  ]) if (!assets.some(a => a.name === item.name)) {
    const intent = await beginUpload(actor, project.id, { assetId: null, productId: item.productId, name: item.name, category: item.category, originalName: item.originalName, declaredMime: item.mime, expectedSize: item.bytes.length });
    await receiveUpload(actor, project.id, intent.id, new ReadableStream({ start(c) { c.enqueue(item.bytes); c.close(); } }), item.mime, storage);
  }
  assets = await listAssets(actor, project.id); const image = assets.find(a => a.name === "[테스트] 제품 이미지.png")!;
  const campaignTitle = "[샘플] 자료 버전 보존 검증";
  const campaign = (await listCampaigns(actor, { projectId: project.id })).find(c => c.campaign.title === campaignTitle)?.campaign ?? await saveCampaign(actor, { projectId: project.id, title: campaignTitle, productIds: [product.id], countryCodes: ["JP"], platforms: ["tiktok"], categories: ["라이프스타일"], followerMin: 10000, followerMax: 100000, goalCount: 50, notes: "합성 테스트 자료의 보존 버전을 확인하는 캠페인입니다.", exclusions: "", budget: null, currency: "KRW", startsOn: null, endsOn: null, status: "draft" });
  if (image.currentVersion === 1) {
    const intent = await beginUpload(actor, project.id, { assetId: image.id, productId: product.id, name: image.name, category: "product_image", originalName: "product-test-v2.png", declaredMime: "image/png", expectedSize: fixture.bytes.png2.length });
    await receiveUpload(actor, project.id, intent.id, new ReadableStream({ start(c) { c.enqueue(fixture.bytes.png2); c.close(); } }), "image/png", storage);
  }
  await mkdir(".local/qa/downloads", { recursive: true });
  for (const original of campaign.briefSnapshot.assets) {
    if (!original.versionId || !original.sha256) continue;
    const link = await assetDownload(actor, project.id, original.id, original.versionId, false, storage, { id: campaign.id, briefVersion: 1 });
    const response = await fetch(link.url); if (!response.ok) throw new Error("Demo download failed");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== original.sha256) throw new Error("Demo download hash mismatch");
    const filename = original.kind === "pdf" ? "brand-brief-v1.pdf" : "product-image-v1.png";
    await writeFile(`.local/qa/downloads/${filename}`, bytes);
    if (!(await readFile(`.local/qa/downloads/${filename}`)).equals(bytes)) throw new Error("Downloaded fixture did not persist");
  }
  const current = (await listAssets(actor, project.id)).find(a => a.id === image.id)!;
  console.log(JSON.stringify({ project: project.name, projectId: project.id, campaignId: campaign.id, files: (await listAssets(actor, project.id)).length, imageCurrentVersion: current.currentVersion, preservedBriefImageVersion: campaign.briefSnapshot.assets.find(a => a.id === image.id)?.version, downloads: ".local/qa/downloads", synthetic: true }));
} finally { await pool.end(); }

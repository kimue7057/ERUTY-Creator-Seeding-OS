import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/lib/db";
import { users, memberships } from "../src/lib/db/schema";
import { saveProject, listProjects, projectProducts, saveProduct } from "../src/lib/projects/service";
import { listCampaigns, saveCampaign } from "../src/lib/campaigns/service";
try {
  if (process.env.NODE_ENV === "production") throw new Error("Synthetic demo seeding is for development only.");
  const [user] = await db.select().from(users).where(eq(users.email, process.env.BOOTSTRAP_EMAIL?.toLowerCase() ?? ""));
  if (!user) throw new Error("Run db:seed first.");
  const [membership] = await db.select().from(memberships).where(eq(memberships.userId, user.id)).orderBy(memberships.createdAt, memberships.organizationId).limit(1);
  if (!membership) throw new Error("Bootstrap workspace missing.");
  const actor = { userId: user.id, organizationId: membership.organizationId, role: membership.role };
  const existing = await listProjects(actor, "[샘플]");
  const sample = existing.find(p => p.name === "[샘플] 리플러츠") ?? await saveProject(actor, { name: "[샘플] 리플러츠", summary: "기능 검증용 가상 브랜드입니다. 실제 브랜드 정보가 아닌 합성 데모 데이터입니다.", usp: "샘플 제품의 핵심 특징을 캠페인마다 재사용합니다.", brandStyle: "차분한 색감, 일상 중심 콘텐츠 · 테스트용 스타일", website: "", referenceUrls: [] });
  if (!existing.some(p => p.name === "[샘플] 베베도르")) await saveProject(actor, { name: "[샘플] 베베도르", summary: "프로젝트 간 데이터 분리를 확인하기 위한 가상 브랜드입니다. 제품과 캠페인은 별도로 등록됩니다.", usp: "", brandStyle: "", website: "", referenceUrls: [] });
  const available = await projectProducts(actor, sample.id);
  const product = available.find(p => p.name === "[샘플] 데일리 키트") ?? await saveProduct(actor, sample.id, { name: "[샘플] 데일리 키트", features: "화면과 데이터 저장 검증을 위한 가상 제품입니다.", url: "" });
  const current = await listCampaigns(actor, { projectId: sample.id });
  for (const variant of [
    { title: "[샘플] 일본 · TikTok 시딩", countryCodes: ["JP"], platforms: ["tiktok"] as ("tiktok" | "instagram" | "youtube")[], followerMin: 10000, followerMax: 100000, goalCount: 100, status: "draft" as const },
    { title: "[샘플] 북미 · 비주얼 크리에이터 시딩", countryCodes: ["US", "CA"], platforms: ["instagram", "youtube"] as ("tiktok" | "instagram" | "youtube")[], followerMin: 50000, followerMax: 500000, goalCount: 300, status: "ready" as const },
  ]) if (!current.some(c => c.campaign.title === variant.title)) await saveCampaign(actor, { ...variant, projectId: sample.id, productIds: [product.id], categories: ["라이프스타일"], notes: "합성 데모 데이터", exclusions: "", budget: null, currency: "KRW", startsOn: null, endsOn: null });
  console.log("Synthetic sample projects/products/campaigns are ready. Existing records were not overwritten; no files or creators were fabricated.");
} finally { await pool.end(); }

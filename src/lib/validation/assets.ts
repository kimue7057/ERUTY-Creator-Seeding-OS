import { z } from "zod";
import { idSchema } from "./projects";
export const ASSET_CATEGORIES = [
  { value: "brand_intro", label: "브랜드 소개서" }, { value: "product_image", label: "제품 이미지" },
  { value: "advertising_video", label: "광고 영상" }, { value: "brand_guide", label: "브랜드 가이드" }, { value: "other", label: "기타 자료" },
] as const;
export const FILE_RULES = {
  "application/pdf": { extensions: ["pdf"], maxBytes: 20 * 1024 * 1024 },
  "image/jpeg": { extensions: ["jpg", "jpeg"], maxBytes: 10 * 1024 * 1024 },
  "image/png": { extensions: ["png"], maxBytes: 10 * 1024 * 1024 },
  "image/webp": { extensions: ["webp"], maxBytes: 10 * 1024 * 1024 },
  "video/mp4": { extensions: ["mp4"], maxBytes: 50 * 1024 * 1024 },
};
export type AcceptedMime = keyof typeof FILE_RULES;
export const assetMetadataSchema = z.object({ name: z.string().trim().min(1, "자료 이름을 입력하세요.").max(150), productId: idSchema.nullable(), category: z.enum(["brand_intro", "product_image", "advertising_video", "brand_guide", "other"]) });
export const uploadIntentSchema = assetMetadataSchema.extend({
  assetId: idSchema.nullable(), originalName: z.string().min(1).max(200).refine(v => !/[\x00-\x1f\x7f/\\]/.test(v), "안전한 파일 이름을 사용하세요."),
  declaredMime: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp", "video/mp4"]),
  expectedSize: z.number().int().min(1, "빈 파일은 업로드할 수 없습니다.").max(50 * 1024 * 1024),
}).superRefine((v, ctx) => {
  const rule = FILE_RULES[v.declaredMime];
  if (v.expectedSize > rule.maxBytes) ctx.addIssue({ code: "custom", message: `해당 파일은 최대 ${rule.maxBytes / 1024 / 1024}MB까지 업로드할 수 있습니다.`, path: ["expectedSize"] });
  if (!rule.extensions.includes(v.originalName.split(".").pop()!.toLowerCase())) ctx.addIssue({ code: "custom", message: "확장자와 파일 종류가 일치하지 않습니다.", path: ["originalName"] });
});
export type UploadIntentInput = z.infer<typeof uploadIntentSchema>;
export const categoryLabel = (value: string) => ASSET_CATEGORIES.find(c => c.value === value)?.label ?? "기타 자료";
export function sizeLabel(bytes: number | null) { return bytes == null ? "크기 미검증" : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

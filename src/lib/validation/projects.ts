import { z } from "zod";
export const idSchema = z.uuid("올바른 항목 ID가 아닙니다.");
const httpUrl = z.url({ protocol: /^https?$/, error: "http 또는 https URL을 입력해 주세요." }).max(2000);
export const optionalUrl = z.union([httpUrl, z.literal("")]);
export const projectSchema = z.object({
  name: z.string().trim().min(1, "프로젝트명을 입력해 주세요.").max(100),
  website: optionalUrl,
  summary: z.string().trim().max(5000),
  usp: z.string().trim().max(5000),
  brandStyle: z.string().trim().max(3000),
  referenceUrls: z.array(httpUrl).max(20, "참고 링크는 최대 20개입니다."),
});
export const productSchema = z.object({
  name: z.string().trim().min(1, "제품명을 입력해 주세요.").max(100),
  features: z.string().trim().max(5000), url: optionalUrl,
});
export type ProjectInput = z.infer<typeof projectSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export function safeId(id: string) { return idSchema.safeParse(id).success; }

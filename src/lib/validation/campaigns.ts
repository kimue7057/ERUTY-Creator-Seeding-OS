import { z } from "zod";
import { idSchema } from "./projects";
export const COUNTRIES = [
  { code: "JP", label: "일본" }, { code: "US", label: "미국" }, { code: "KR", label: "한국" }, { code: "TW", label: "대만" },
  { code: "SG", label: "싱가포르" }, { code: "HK", label: "홍콩" }, { code: "GB", label: "영국" }, { code: "CA", label: "캐나다" },
  { code: "AU", label: "호주" }, { code: "DE", label: "독일" }, { code: "FR", label: "프랑스" }, { code: "VN", label: "베트남" },
  { code: "TH", label: "태국" }, { code: "ID", label: "인도네시아" }, { code: "MY", label: "말레이시아" }, { code: "PH", label: "필리핀" },
  { code: "CN", label: "중국" }, { code: "IN", label: "인도" }, { code: "IT", label: "이탈리아" }, { code: "ES", label: "스페인" },
  { code: "AE", label: "아랍에미리트" }, { code: "SA", label: "사우디아라비아" }, { code: "NZ", label: "뉴질랜드" }, { code: "BR", label: "브라질" },
];
export const PLATFORMS = [{ value: "instagram", label: "Instagram" }, { value: "tiktok", label: "TikTok" }, { value: "youtube", label: "YouTube" }] as const;
export const STATUSES = [{ value: "draft", label: "초안" }, { value: "ready", label: "준비 완료" }, { value: "archived", label: "보관" }] as const;
const positiveInt = z.number().int().min(0).max(2_147_483_647);
export const campaignSchema = z.object({
  projectId: idSchema,
  title: z.string().trim().min(1, "캠페인명을 입력해 주세요.").max(150),
  productIds: z.array(idSchema).min(1, "관련 제품을 1개 이상 선택해 주세요.").max(100).transform(ids => [...new Set(ids)]),
  countryCodes: z.array(z.string().refine(code => COUNTRIES.some(c => c.code === code), "지원되는 국가를 선택해 주세요.")).min(1, "국가를 1개 이상 선택해 주세요.").max(24).transform(codes => [...new Set(codes)]),
  platforms: z.array(z.enum(["instagram", "tiktok", "youtube"])).min(1, "플랫폼을 1개 이상 선택해 주세요.").max(3).transform(v => [...new Set(v)]),
  categories: z.array(z.string().trim().min(1).max(100)).min(1, "카테고리를 입력해 주세요.").max(20),
  followerMin: positiveInt,
  followerMax: positiveInt,
  goalCount: z.number().int().min(1, "목표 인원은 1명 이상이어야 합니다.").max(100000),
  notes: z.string().trim().max(5000), exclusions: z.string().trim().max(5000),
  budget: positiveInt.nullable(), currency: z.enum(["KRW", "USD", "JPY", "EUR"]),
  startsOn: z.iso.date().nullable(), endsOn: z.iso.date().nullable(),
  status: z.enum(["draft", "ready", "archived"]),
}).refine(v => v.followerMax >= v.followerMin, { message: "최대 팔로워 수는 최소 팔로워 수 이상이어야 합니다.", path: ["followerMax"] })
  .refine(v => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, { message: "종료일은 시작일 이후로 지정해 주세요.", path: ["endsOn"] });
export type CampaignInput = z.infer<typeof campaignSchema>;
export const countryLabel = (code: string) => COUNTRIES.find(c => c.code === code)?.label ?? code;
export const platformLabel = (value: string) => PLATFORMS.find(p => p.value === value)?.label ?? value;
export const statusLabel = (value: string) => STATUSES.find(s => s.value === value)?.label ?? value;

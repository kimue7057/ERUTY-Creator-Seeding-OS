import { z } from "zod";
export const layoutSchema = z.enum(["letter", "brand", "proposal", "followup"]);
export type MailLayout = z.infer<typeof layoutSchema>;
export const layouts: Record<MailLayout, { name: string; description: string }> = {
  letter: { name: "개인화 레터", description: "담백한 첫 인사와 크리에이터에게 제안하는 이유" },
  brand: { name: "브랜드 소개", description: "브랜드 이름과 색상을 강조하는 제품 소개" },
  proposal: { name: "공식 제안서", description: "협업 제안을 정돈된 문서 형태로 전달" },
  followup: { name: "짧은 후속 연락", description: "간결한 안부와 이전 제안에 대한 확인" },
};
export const brandingSchema = z.object({
  companyName: z.string().trim().max(100),
  signature: z.string().trim().max(1000),
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  website: z.union([z.literal(""), z.url().max(2048).refine(v => { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password; })]),
});
export type MailBranding = z.infer<typeof brandingSchema>;
export const defaultBranding: MailBranding = { companyName: "", signature: "", color: "#28543e", website: "" };
export const templateInputSchema = z.object({
  id: z.uuid(), revision: z.number().int().min(0), name: z.string().trim().min(1).max(80),
  channel: z.enum(["email", "instagram", "tiktok"]), language: z.enum(["한국어", "English"]),
  layout: layoutSchema, subject: z.string().max(200).refine(v => !/[\r\n]/.test(v)), body: z.string().min(1).max(12000),
});
export type MessageTemplateInput = z.infer<typeof templateInputSchema>;
export const placeholderNames = ["creator", "brand", "campaign", "reason"] as const;
export function applyTemplate(text: string, values: Record<typeof placeholderNames[number], string>) {
  return text.replace(/\{\{(creator|brand|campaign|reason)\}\}/g, (_, name: typeof placeholderNames[number]) => values[name]);
}
export function hasPlaceholders(text: string) { return /\{\{[^{}]+\}\}/.test(text); }
export const starterTemplates = [
  { name: "첫 협업 제안", layout: "letter", subject: "{{brand}} · {{creator}}님께 협업을 제안드립니다", body: "안녕하세요, {{creator}}님.\n{{brand}} 담당자입니다.\n\n{{reason}}\n\n현재 {{campaign}} 캠페인을 준비하고 있어 협업 가능 여부를 여쭙고 싶습니다. 관심 있으시면 회신 부탁드립니다. 제품과 진행 방식을 자세히 안내드리겠습니다.\n\n감사합니다." },
  { name: "브랜드·제품 소개", layout: "brand", subject: "{{creator}}님께 {{brand}}를 소개드립니다", body: "안녕하세요, {{creator}}님.\n{{brand}}에서 연락드립니다.\n\n{{reason}}\n\n{{campaign}} 관련 제품을 소개하고 협업에 대해 이야기 나누고 싶습니다. 관심 있으시면 편하게 알려주세요. 상세 정보와 조건을 먼저 공유드리겠습니다.\n\n감사합니다." },
  { name: "공식 협업 제안", layout: "proposal", subject: "[협업 제안] {{brand}} · {{campaign}}", body: "안녕하세요, {{creator}}님.\n{{brand}} 담당자입니다.\n\n제안 배경\n{{reason}}\n\n협업 논의\n{{campaign}} 캠페인과 관련해 협업 가능 여부를 확인하고자 연락드립니다. 구체적인 콘텐츠 범위, 일정 및 조건은 관심 여부를 확인한 후 함께 논의하고 싶습니다.\n\n관심 있으시면 회신 부탁드립니다. 검토해 주셔서 감사합니다." },
  { name: "후속 연락", layout: "followup", subject: "{{brand}} 협업 제안 관련 다시 연락드립니다", body: "안녕하세요, {{creator}}님.\n{{brand}} 담당자입니다.\n\n앞서 보내드린 {{campaign}} 관련 제안을 확인하셨을지 여쭙고자 연락드립니다. 궁금한 점이나 검토에 필요한 내용이 있다면 말씀해 주세요.\n\n감사합니다." },
] satisfies { name: string; layout: MailLayout; subject: string; body: string }[];

// Fixed layouts stay separate from creator-specific AI writing. Presets contain
// no invented offers, fees, deliverables or claims about a creator's audience.
export const starterCatalog = [
 ...starterTemplates.map(t=>({...t,channel:'email' as const,language:'한국어' as const})),
 {name:'First collaboration proposal',channel:'email',language:'English',layout:'letter',subject:'A collaboration idea from {{brand}}',body:'Hi {{creator}},\n\nI’m reaching out from {{brand}}.\n\n{{reason}}\n\nWe’re preparing {{campaign}} and would love to explore whether the project could be a good fit for your content. Would you be open to receiving a short product brief?\n\nWe can discuss the scope, timing and terms if you’re interested.\n\nThank you for considering it.'},
 {name:'Brand and product introduction',channel:'email',language:'English',layout:'brand',subject:'Introducing {{brand}} · a content idea for {{creator}}',body:'Hi {{creator}},\n\nI’m part of the team at {{brand}}.\n\n{{reason}}\n\nFor {{campaign}}, we’d like to share our product information and discuss a content idea that fits your usual style.\n\nMay we send you the brief to see whether it interests you?'},
 {name:'Formal collaboration proposal',channel:'email',language:'English',layout:'proposal',subject:'Collaboration enquiry · {{brand}} × {{creator}}',body:'Hi {{creator}},\n\nI’m contacting you on behalf of {{brand}} about {{campaign}}.\n\n{{reason}}\n\nWe would like to explore a collaboration shaped around your content. The proposed scope, schedule and commercial terms would be discussed together before any commitment.\n\nWould you be interested in reviewing a short brief?\n\nThank you for your time.'},
 {name:'Follow-up enquiry',channel:'email',language:'English',layout:'followup',subject:'Following up · {{brand}} collaboration enquiry',body:'Hi {{creator}},\n\nI’m following up on our earlier enquiry about {{campaign}} for {{brand}}.\n\nWould you be interested in receiving more details? If you have any questions or need anything to review the idea, please let us know.\n\nThank you.'},
 {name:'DM · 첫 협업 제안',channel:'instagram',language:'한국어',layout:'letter',subject:'',body:'안녕하세요, {{creator}}님! {{brand}} 팀입니다.\n\n{{reason}}\n\n{{campaign}} 협업을 함께 이야기해 보고 싶어 연락드렸습니다. 짧은 제품 소개와 제안 내용을 보내드려도 괜찮을까요?'},
 {name:'DM · 제품 콘텐츠 제안',channel:'instagram',language:'한국어',layout:'brand',subject:'',body:'안녕하세요, {{creator}}님. {{brand}}에서 연락드립니다.\n\n{{reason}}\n\n평소 콘텐츠 스타일에 맞는 방식으로 {{campaign}}을 함께 논의해 보고 싶습니다. 관심 있으시면 제품과 진행 방향을 간단히 안내드려도 될까요?'},
 {name:'DM · 후속 연락',channel:'instagram',language:'한국어',layout:'followup',subject:'',body:'안녕하세요, {{creator}}님! {{brand}} 팀입니다.\n\n앞서 보내드린 {{campaign}} 협업 문의와 관련해 짧게 다시 연락드립니다.\n\n검토에 필요한 정보가 있으시면 편하게 말씀해 주세요. 제안에 관심이 있으실까요?'},
 {name:'DM · First collaboration proposal',channel:'instagram',language:'English',layout:'letter',subject:'',body:'Hi {{creator}}! We’re the team at {{brand}}.\n\n{{reason}}\n\nWe’d love to explore {{campaign}} in a way that fits your content. Would you be open to receiving a short product brief?'},
 {name:'DM · Product content idea',channel:'instagram',language:'English',layout:'brand',subject:'',body:'Hi {{creator}}, reaching out from {{brand}}.\n\n{{reason}}\n\nWe’d like to discuss a product content idea for {{campaign}}, shaped around your usual style. May we send you a few details?'},
 {name:'DM · Follow-up enquiry',channel:'instagram',language:'English',layout:'followup',subject:'',body:'Hi {{creator}}! This is the {{brand}} team.\n\nJust following up on our earlier enquiry about {{campaign}}.\n\nWould you be interested in learning more? Happy to share any details you need to consider it.'},
] satisfies {name:string;channel:'email'|'instagram';language:'한국어'|'English';layout:MailLayout;subject:string;body:string}[];

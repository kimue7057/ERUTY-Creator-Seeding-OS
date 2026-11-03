import { z } from "zod";
import { providerSchema } from "./contracts";
export const providerAppInputSchema = z.object({
  provider: providerSchema, revision: z.number().int().min(0),
  clientId: z.string().trim().min(1).max(512).regex(/^[\w.:-]+$/),
  clientSecret: z.string().trim().min(1).max(2048).refine(v => !/[\s\u0000-\u001f]/.test(v)),
  version: z.string().max(30).default(""), replace: z.boolean().default(false),
}).superRefine((v, ctx) => {
  if (v.provider === "instagram" && !/^v\d+\.0$/.test(v.version)) ctx.addIssue({ code: "custom", path: ["version"], message: "Meta 앱에 표시된 API 버전을 입력하세요." });
  if (v.provider === "google" && !v.clientId.endsWith(".apps.googleusercontent.com")) ctx.addIssue({ code: "custom", path: ["clientId"], message: "Google 웹 애플리케이션의 클라이언트 ID를 확인하세요." });
});
export type ProviderAppInput = z.infer<typeof providerAppInputSchema>;
// Browser-only import: no credentials are included in URLs, logs or action results.
export function parseGoogleClientFile(text: string, redirectUri: string) {
  const parsed = z.object({ web: z.object({ client_id: z.string(), client_secret: z.string(), redirect_uris: z.array(z.string()) }) }).parse(JSON.parse(text));
  if (!parsed.web.redirect_uris.includes(redirectUri)) throw new Error("Google 앱의 승인된 리디렉션 URI에 아래 로그인 완료 주소를 먼저 추가하세요.");
  return { clientId: parsed.web.client_id, clientSecret: parsed.web.client_secret };
}

import { z } from "zod";
import { providerSchema } from "./contracts";
export const instagramLoginModeSchema = z.enum(["instagram", "unified"]);
export const providerAppInputSchema = z.object({
  provider: providerSchema, revision: z.number().int().min(0),
  clientId: z.string().trim().min(1).max(512).regex(/^[\w.:-]+$/),
  clientSecret: z.string().trim().min(1).max(2048).refine(v => !/[\s\u0000-\u001f]/.test(v)),
  version: z.string().max(30).default(""), replace: z.boolean().default(false),
  instagramLoginMode: instagramLoginModeSchema.default("instagram"),
  configurationId: z.string().trim().max(50).default(""),
}).superRefine((v, ctx) => {
  if (v.provider === "instagram" && !/^v\d+\.0$/.test(v.version)) ctx.addIssue({ code: "custom", path: ["version"], message: "Meta 앱에 표시된 API 버전을 입력하세요." });
  if (v.provider === "instagram" && v.instagramLoginMode === "unified" && (!/^\d+$/.test(v.configurationId) || !/^\d+$/.test(v.clientId))) ctx.addIssue({ code: "custom", path: ["configurationId"], message: "Meta 앱 ID와 구성 ID를 숫자로 입력하세요." });
  if (v.provider === "google" && !v.clientId.endsWith(".apps.googleusercontent.com")) ctx.addIssue({ code: "custom", path: ["clientId"], message: "Google 웹 애플리케이션의 클라이언트 ID를 확인하세요." });
});
export type ProviderAppInput = z.infer<typeof providerAppInputSchema>;
export function parseInstagramLoginUrl(text: string, redirectUri: string) {
  const url = new URL(text.trim());
  if (url.origin !== "https://www.facebook.com" || !/^\/(v\d+\.0\/)?dialog\/oauth\/?$/.test(url.pathname) || url.username || url.password || url.hash) throw new Error("Meta에서 생성한 Facebook 로그인 URL을 입력하세요.");
  for (const name of ["client_id", "config_id", "redirect_uri", "response_type"]) if (url.searchParams.getAll(name).length !== 1) throw new Error("Meta 로그인 URL의 필수 항목을 확인하세요.");
  if (url.searchParams.get("redirect_uri") !== redirectUri || url.searchParams.get("response_type") !== "code") throw new Error("Meta 로그인 URL의 리디렉션 주소가 이 ERUTY 주소와 일치해야 합니다.");
  if (["access_token", "client_secret", "code", "id_token"].some(name => url.searchParams.has(name))) throw new Error("인증 결과나 토큰이 아닌 Meta 설정 화면의 로그인 URL을 입력하세요.");
  const clientId = z.string().regex(/^\d{1,50}$/).parse(url.searchParams.get("client_id"));
  const configurationId = z.string().regex(/^\d{1,50}$/).parse(url.searchParams.get("config_id"));
  // Never import placeholder state, scopes, tokens, or arbitrary destinations.
  return { clientId, configurationId };
}
// Browser-only import: no credentials are included in URLs, logs or action results.
export function parseGoogleClientFile(text: string, redirectUri: string) {
  const parsed = z.object({ web: z.object({ client_id: z.string(), client_secret: z.string(), redirect_uris: z.array(z.string()) }) }).parse(JSON.parse(text));
  if (!parsed.web.redirect_uris.includes(redirectUri)) throw new Error("Google 앱의 승인된 리디렉션 URI에 아래 로그인 완료 주소를 먼저 추가하세요.");
  return { clientId: parsed.web.client_id, clientSecret: parsed.web.client_secret };
}

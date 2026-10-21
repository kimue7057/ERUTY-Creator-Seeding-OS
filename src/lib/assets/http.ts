import "server-only";
import { z } from "zod";
import { currentActor } from "../auth/session";
import { AssetError } from "./errors";
export const noStore = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer" };
export async function apiActor(request: Request) {
  const actor = await currentActor();
  if (!actor) throw new AssetError(401, "unauthenticated", "로그인이 만료되었습니다. 다시 로그인해 주세요.");
  const origin = request.headers.get("origin");
  if (request.headers.get("x-eruty-request") !== "1" || (origin && origin !== new URL(request.url).origin && origin !== process.env.APP_ORIGIN)) throw new AssetError(403, "invalid_origin", "허용되지 않은 요청입니다. 페이지를 새로고침해 주세요.");
  return actor;
}
export function apiError(error: unknown) {
  if (error instanceof AssetError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: noStore });
  if (error instanceof z.ZodError) return Response.json({ error: error.issues.map(i => i.message).join(" · "), code: "invalid_input" }, { status: 422, headers: noStore });
  return Response.json({ error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", code: "request_failed" }, { status: 503, headers: noStore });
}

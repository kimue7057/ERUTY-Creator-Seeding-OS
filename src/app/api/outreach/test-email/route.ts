import { currentActor } from "@/lib/auth/session";
import { connectionTestService } from "@/lib/outreach/test-email";
import { OutreachError, outreachErrorMessage } from "@/lib/outreach/contracts";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store, max-age=0" };
function failure(error: unknown) {
  return Response.json({ error: error instanceof OutreachError ? error.code : "invalid_request", message: outreachErrorMessage(error) }, { status: error instanceof z.ZodError ? 422 : error instanceof OutreachError ? error.code === "forbidden" ? 403 : 409 : 503, headers });
}
export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401, headers });
  try { return Response.json({ tests: await connectionTestService().list(actor, z.uuid().parse(new URL(request.url).searchParams.get("accountId"))) }, { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!process.env.APP_ORIGIN || request.headers.get("origin") !== process.env.APP_ORIGIN) return Response.json({ error: "forbidden" }, { status: 403, headers });
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json") || Number(request.headers.get("content-length") ?? 0) > 4096) return Response.json({ error: "invalid_request" }, { status: 413, headers });
  try {
    const body = await request.text();
    if (body.length > 4096) return Response.json({ error: "invalid_request" }, { status: 413, headers });
    return Response.json({ test: await connectionTestService().send(actor, JSON.parse(body)) }, { headers });
  } catch (error) { return failure(error); }
}

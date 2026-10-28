import { z } from "zod";
import { currentActor } from "@/lib/auth/session";
import { shortlistService } from "@/lib/evaluation/shortlist";
import { EvaluationError } from "@/lib/evaluation/contracts";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401, headers });
  try { return Response.json(await shortlistService().board(actor, z.uuid().parse(new URL(request.url).searchParams.get("campaign_id"))), { headers }); }
  catch (error) { return Response.json({ error: error instanceof EvaluationError ? error.code : "shortlist_unavailable" }, { status: error instanceof z.ZodError ? 422 : error instanceof EvaluationError ? 404 : 503, headers }); }
}

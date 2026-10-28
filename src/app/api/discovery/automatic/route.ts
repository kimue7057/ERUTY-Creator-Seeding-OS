import { currentActor } from "@/lib/auth/session";
import { automaticWorkerService } from "@/lib/discovery/automatic-worker";
import { DiscoveryError } from "@/lib/discovery/contracts";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401, headers });
  if (process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED !== "true") return Response.json({ error: "automatic_discovery_disabled" }, { status: 403, headers });
  try { return Response.json(await automaticWorkerService().snapshot(actor, z.uuid().parse(new URL(request.url).searchParams.get("campaign_id"))), { headers }); }
  catch (error) { return Response.json({ error: error instanceof DiscoveryError ? error.code : "status_unavailable" }, { status: error instanceof DiscoveryError ? error.status : error instanceof z.ZodError ? 422 : 503, headers }); }
}

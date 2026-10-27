import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { browserCaptureBatches } from "@/lib/db/browser-schema";
import { currentActor } from "@/lib/auth/session";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer" }, actor = await currentActor(), parsed = z.uuid().safeParse((await params).id);
  if (!actor || !parsed.success) return Response.json({ error: "not_found" }, { status: 404, headers });
  const [capture] = await db.select().from(browserCaptureBatches).where(and(eq(browserCaptureBatches.id, parsed.data), eq(browserCaptureBatches.organizationId, actor.organizationId)));
  if (!capture) return Response.json({ error: "not_found" }, { status: 404, headers });
  return Response.json(capture, { headers });
}

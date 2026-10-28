import { z } from "zod";
import { browserWorkerAuth } from "@/lib/discovery/remote-auth";
import { remoteBrowserService } from "@/lib/discovery/remote-browser";
import { DiscoveryError } from "@/lib/discovery/contracts";
import { EvaluationError } from "@/lib/evaluation/contracts";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    if (process.env.CODEX_DISCOVERY_ENABLED !== "true") throw new DiscoveryError(403, "local_browser_disabled");
    const url = new URL(request.url), origin = request.headers.get("origin");
    if (request.headers.get("x-eruty-discovery") !== "1" || origin && origin !== url.origin && origin !== process.env.APP_ORIGIN) throw new DiscoveryError(403, "invalid_origin");
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new DiscoveryError(415, "json_required");
    const reader = request.body?.getReader(); if (!reader) throw new DiscoveryError(400, "body_required");
    const chunks: Uint8Array[] = []; let bytes = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 524288) throw new DiscoveryError(413, "body_too_large"); chunks.push(part.value); } } finally { await reader.cancel().catch(() => {}); }
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8")), { action } = await params;
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const result = action === "login" ? await browserWorkerAuth().login(input) : action.startsWith("worker-assessment-") ? await remoteBrowserService().assessment(action, token, input) : await remoteBrowserService().execute(action, token, input);
    return Response.json(result, { headers });
  } catch (error) {
    const status = error instanceof DiscoveryError ? error.status : error instanceof EvaluationError ? 409 : error instanceof z.ZodError || error instanceof SyntaxError ? 422 : 503;
    return Response.json({ error: error instanceof DiscoveryError || error instanceof EvaluationError ? error.code : status === 422 ? "invalid_input" : "worker_request_failed" }, { status, headers });
  }
}

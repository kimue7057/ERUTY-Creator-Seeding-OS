import { apiActor, apiError, noStore } from "@/lib/assets/http";
import { beginUpload } from "@/lib/assets/service";
import { createS3Storage } from "@/lib/storage/s3";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const actor = await apiActor(request); createS3Storage(); const { id } = await params; return Response.json(await beginUpload(actor, id, await request.json()), { status: 201, headers: noStore }); }
  catch (error) { return apiError(error); }
}

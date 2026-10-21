import { apiActor, apiError, noStore } from "@/lib/assets/http";
import { receiveUpload, cancelUpload } from "@/lib/assets/service";
import { AssetError } from "@/lib/assets/errors";
import { createS3Storage } from "@/lib/storage/s3";
export const runtime = "nodejs";
export const maxDuration = 300;
type Context = { params: Promise<{ id: string; uploadId: string }> };
export async function PUT(request: Request, { params }: Context) {
  try {
    const actor = await apiActor(request); const { id, uploadId } = await params;
    if (!request.body) throw new AssetError(400, "missing_file", "업로드할 파일을 선택해 주세요.");
    return Response.json(await receiveUpload(actor, id, uploadId, request.body, request.headers.get("content-type") ?? "", createS3Storage(), request.signal), { status: 201, headers: noStore });
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, { params }: Context) {
  try { const actor = await apiActor(request); const { id, uploadId } = await params; await cancelUpload(actor, id, uploadId); return new Response(null, { status: 204, headers: noStore }); }
  catch (error) { return apiError(error); }
}

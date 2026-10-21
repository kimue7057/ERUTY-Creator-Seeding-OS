import { apiActor, apiError, noStore } from "@/lib/assets/http";
import { updateAssetMetadata } from "@/lib/assets/service";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  try { const actor = await apiActor(request); const { id, assetId } = await params; await updateAssetMetadata(actor, id, assetId, await request.json()); return new Response(null, { status: 204, headers: noStore }); }
  catch (error) { return apiError(error); }
}

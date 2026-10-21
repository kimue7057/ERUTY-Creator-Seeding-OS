import { z } from "zod";
import { apiActor, apiError, noStore } from "@/lib/assets/http";
import { assetDownload } from "@/lib/assets/service";
import { createS3Storage } from "@/lib/storage/s3";
const schema = z.object({ versionId: z.uuid(), inline: z.boolean().default(false), campaignId: z.uuid().optional(), briefVersion: z.number().int().min(1).optional() }).refine(v => !!v.campaignId === !!v.briefVersion);
export async function POST(request: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const actor = await apiActor(request); const { id, assetId } = await params; const body = schema.parse(await request.json());
    return Response.json(await assetDownload(actor, id, assetId, body.versionId, body.inline, createS3Storage(), body.campaignId ? { id: body.campaignId, briefVersion: body.briefVersion! } : undefined), { headers: noStore });
  } catch (error) { return apiError(error); }
}

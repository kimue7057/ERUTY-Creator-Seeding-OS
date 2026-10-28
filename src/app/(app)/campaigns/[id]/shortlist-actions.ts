"use server";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth/session";
import { shortlistService } from "@/lib/evaluation/shortlist";
import { EvaluationError } from "@/lib/evaluation/contracts";
export type ShortlistActionState = { saved: boolean; error: string; message: string };
function failure(error: unknown): ShortlistActionState {
  const code = error instanceof EvaluationError ? error.code : "";
  return { saved: false, message: "", error: code === "evaluation_stale_input" ? "조건이나 근거가 바뀌었습니다. 현재 조건으로 다시 평가해 주세요." : code === "evaluation_unknowns_acknowledgement_required" ? "평가·근거·미확인 사항을 확인한 뒤 확인란을 선택해 주세요." : code === "evaluation_discovery_pending" ? "추천 기준과 원본 근거를 확인해야 승인할 수 있습니다." : "처리하지 못했습니다. 권한과 현재 상태를 확인해 주세요." };
}
function refresh(campaignId: string) { revalidatePath(`/campaigns/${campaignId}`); revalidatePath("/evaluations", "layout"); }
export async function enqueueCampaignAction(campaignId: string, _: ShortlistActionState): Promise<ShortlistActionState> {
  void _;
  try {
    if (process.env.EVALUATION_ENABLED !== "true" || process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED !== "true") throw new EvaluationError("automatic_assessment_disabled");
    const result = await shortlistService().enqueueCampaign(await requireActor(), campaignId); refresh(campaignId);
    return { saved: true, error: "", message: result.queued ? `${result.queued}명의 자동 평가를 요청했습니다.` : "현재 조건의 평가는 이미 접수되어 있습니다." };
  } catch (error) { return failure(error); }
}
export async function shortlistReviewAction(campaignId: string, assessmentId: string, _: ShortlistActionState, form: FormData): Promise<ShortlistActionState> {
  try {
    await shortlistService().review(await requireActor(), campaignId, { assessment_id: assessmentId, idempotency_key: form.get("idempotency_key"), verdict: form.get("verdict"), reason: form.get("reason") || "캠페인 추천 후보의 평가·원본 근거·미확인 사항을 확인했습니다.", acknowledged: form.get("acknowledged") === "on" }); refresh(campaignId);
    return { saved: true, error: "", message: form.get("verdict") === "approved" ? "최종 승인했습니다. 승인 명단에 반영됩니다." : "판정을 저장했습니다." };
  } catch (error) { return failure(error); }
}
export async function retryAssessmentAction(campaignId: string, assessmentId: string, _: ShortlistActionState): Promise<ShortlistActionState> {
  void _;
  try { await shortlistService().retry(await requireActor(), campaignId, assessmentId); refresh(campaignId); return { saved: true, error: "", message: "재평가를 요청했습니다." }; }
  catch (error) { return failure(error); }
}

"use server";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth/session";
import { shortlistService } from "@/lib/evaluation/shortlist";
import { EvaluationError } from "@/lib/evaluation/contracts";
export type ShortlistActionState = { saved: boolean; error: string; message: string; verdict?: "approved" | "hold" | "rejected"; decision?: { reason: string; at: string } };
function failure(error: unknown): ShortlistActionState {
  const code = error instanceof EvaluationError ? error.code : "";
  return { saved: false, message: "", error: code === "evaluation_stale_input" ? "조건이나 근거가 바뀌었습니다. 현재 조건으로 다시 평가해 주세요." : code === "evaluation_human_reason_required" ? "AI 추천과 다른 선정 사유를 5자 이상 작성해 주세요." : code === "evaluation_unknowns_acknowledgement_required" ? "평가·근거·미확인 사항을 확인한 뒤 확인란을 선택해 주세요." : code === "evaluation_discovery_pending" ? "SNS 원본 근거를 검증할 수 없거나 근거가 반려·취소되어 선정을 저장할 수 없습니다. 보류·제외 판정은 가능합니다." : "처리하지 못했습니다. 권한과 현재 상태를 확인해 주세요." };
}
function refresh(campaignId: string) { revalidatePath(`/campaigns/${campaignId}`); revalidatePath("/evaluations", "layout"); revalidatePath("/campaigns"); revalidatePath("/"); }
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
    const decision = await shortlistService().review(await requireActor(), campaignId, { assessment_id: assessmentId, idempotency_key: form.get("idempotency_key"), verdict: form.get("verdict"), reason: String(form.get("reason") ?? "").trim(), acknowledged: form.get("acknowledged") === "on" }); refresh(campaignId);
    return { saved: true, error: "", verdict: decision.verdict, decision: { reason: decision.reason, at: decision.createdAt.toISOString() }, message: decision.verdict === "approved" ? "최종 선정했습니다. 선정 명단에 반영됩니다." : decision.verdict === "hold" ? "보류했습니다. 보류 목록에 반영됩니다." : "제외했습니다. 제외 목록에 반영됩니다." };
  } catch (error) { return failure(error); }
}
export async function retryAssessmentAction(campaignId: string, assessmentId: string, _: ShortlistActionState): Promise<ShortlistActionState> {
  void _;
  try { await shortlistService().retry(await requireActor(), campaignId, assessmentId); refresh(campaignId); return { saved: true, error: "", message: "재평가를 요청했습니다." }; }
  catch (error) { return failure(error); }
}

"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth/session";
import { DiscoveryError } from "@/lib/discovery/contracts";
import { discoveryService } from "@/lib/discovery/service";
import { discoveryStaff } from "@/lib/discovery/staff";
import { browserRequestService, browserRequestPrompt } from "@/lib/discovery/browser-requests";
export type ReviewState = { error: string; saved: boolean };
function failure(error: unknown): ReviewState {
  if (error instanceof z.ZodError) return { error: "판정과 검토 사유를 확인해 주세요. 사유에 비밀값을 넣지 마세요.", saved: false };
  const message = error instanceof DiscoveryError && error.code === "insufficient_verified_evidence" ? "완료에 필요한 실행 경로·원본 근거 검토와 목표 인원이 충족되지 않았습니다."
    : error instanceof DiscoveryError && error.code === "browser_execution_evidence_required" ? "실제 SNS 검색·프로필·콘텐츠와 브라우저 캡처를 확인한 뒤 확인란을 선택해 주세요."
    : error instanceof DiscoveryError && ["stale_context", "run_closed"].includes(error.code) ? "작업 상태가 변경되었습니다. 새로고침 후 확인해 주세요."
    : "저장하지 못했습니다. 현재 접근 권한과 작업 상태를 확인해 주세요.";
  return { error: message, saved: false };
}
export async function reviewEvidenceAction(campaignId: string, accountId: string, evidenceId: string, _: ReviewState, form: FormData): Promise<ReviewState> {
  const actor = discoveryStaff(await requireActor());
  try {
    await discoveryService().reviewEvidence(actor, { evidence_id: evidenceId, campaign_id: campaignId, creator_account_id: accountId, verdict: form.get("verdict"), reason: form.get("reason") });
  } catch (error) { return failure(error); }
  revalidatePath(`/campaigns/${campaignId}/discovery`, "layout");
  revalidatePath("/evaluations", "layout");
  return { saved: true, error: "" };
}
export async function reviewBrowserExecutionAction(campaignId: string, runId: string, version: number, _: ReviewState, form: FormData): Promise<ReviewState> {
  try { await discoveryService().reviewBrowserExecution(discoveryStaff(await requireActor()), { run_id: runId, campaign_id: campaignId, expected_lock_version: version, verdict: form.get("verdict"), reason: form.get("reason"), browser_evidence_checked: form.get("browser_evidence_checked") === "on" }); }
  catch (error) { return failure(error); }
  revalidatePath(`/campaigns/${campaignId}/discovery`, "layout"); revalidatePath("/evaluations", "layout"); return { saved: true, error: "" };
}
export async function createBrowserRequestAction(campaignId: string, contextHash: string, _: ReviewState & { requestId: string; prompt: string }, form: FormData) {
  try {
    if (process.env.CODEX_DISCOVERY_ENABLED !== "true") throw new DiscoveryError(403, "local_browser_disabled");
    const job = await browserRequestService().create(await requireActor(), { campaign_id: campaignId, platform: form.get("platform"), requested_count: Number(form.get("requested_count")), expected_context_sha256: contextHash, idempotency_key: form.get("idempotency_key") });
    revalidatePath(`/campaigns/${campaignId}/discovery`);
    return { error: "", saved: true, requestId: job.id, prompt: browserRequestPrompt(job.id) };
  } catch (error) { return { ...(error instanceof z.ZodError ? { error: "플랫폼과 요청 인원(1–20명)을 확인해 주세요.", saved: false } : failure(error)), requestId: "", prompt: "" }; }
}
export async function cancelBrowserRequestAction(campaignId: string, requestId: string): Promise<ReviewState> {
  try {
    const actor = await requireActor(), rows = await browserRequestService().list(actor, campaignId);
    if (!rows.some(({ request }) => request.id === requestId)) throw new DiscoveryError(404, "not_found_or_forbidden");
    await browserRequestService().cancel(actor, requestId);
  } catch (error) { return failure(error); }
  revalidatePath(`/campaigns/${campaignId}/discovery`, "layout"); return { saved: true, error: "" };
}
export async function reviewRunAction(campaignId: string, runId: string, version: number, _: ReviewState, form: FormData): Promise<ReviewState> {
  const actor = discoveryStaff(await requireActor());
  try {
    await discoveryService().reviewRun(actor, { run_id: runId, campaign_id: campaignId, expected_lock_version: version, verdict: form.get("verdict"), reason: form.get("reason") });
  } catch (error) { return failure(error); }
  revalidatePath(`/campaigns/${campaignId}/discovery`, "layout");
  return { saved: true, error: "" };
}

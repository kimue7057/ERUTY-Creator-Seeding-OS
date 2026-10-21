"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth/session";
import { DiscoveryError } from "@/lib/discovery/contracts";
import { discoveryService } from "@/lib/discovery/service";
import { discoveryStaff } from "@/lib/discovery/staff";
export type ReviewState = { error: string; saved: boolean };
function failure(error: unknown): ReviewState {
  if (error instanceof z.ZodError) return { error: "판정과 검토 사유를 확인해 주세요. 사유에 비밀값을 넣지 마세요.", saved: false };
  const message = error instanceof DiscoveryError && error.code === "insufficient_verified_evidence" ? "완료에 필요한 Work 원본·콘텐츠 검토와 목표 인원이 충족되지 않았습니다."
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
  return { saved: true, error: "" };
}
export async function reviewRunAction(campaignId: string, runId: string, version: number, _: ReviewState, form: FormData): Promise<ReviewState> {
  const actor = discoveryStaff(await requireActor());
  try {
    await discoveryService().reviewRun(actor, { run_id: runId, campaign_id: campaignId, expected_lock_version: version, verdict: form.get("verdict"), reason: form.get("reason") });
  } catch (error) { return failure(error); }
  revalidatePath(`/campaigns/${campaignId}/discovery`, "layout");
  return { saved: true, error: "" };
}

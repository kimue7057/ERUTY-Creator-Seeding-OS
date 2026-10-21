"use client";
import { useActionState, useId } from "react";
import { useHydrated } from "@/components/use-hydrated";
import { reviewEvidenceAction, reviewRunAction } from "@/app/(app)/campaigns/[id]/discovery/actions";
type Props = { campaignId: string } & ({ kind: "evidence"; accountId: string; evidenceId: string } | { kind: "run"; runId: string; version: number });
export function ReviewForm(props: Props) {
  const action = props.kind === "evidence" ? reviewEvidenceAction.bind(null, props.campaignId, props.accountId, props.evidenceId) : reviewRunAction.bind(null, props.campaignId, props.runId, props.version);
  const [state, submit, pending] = useActionState(action, { error: "", saved: false });
  const hydrated = useHydrated(), id = useId();
  return <form action={submit} className="review-form" aria-label={props.kind === "run" ? "작업 검토" : "근거 검토"} aria-busy={pending}>
    <label className="field">검토 판정<select aria-label="검토 판정" className="input" name="verdict" required defaultValue="" disabled={pending}><option value="" disabled>판정을 선택하세요</option>{(props.kind === "evidence" ? [["accepted", "근거 수락"], ["needs_review", "추가 확인 필요"], ["rejected", "근거 반려"]] : [["partial", "일부 확인"], ["blocked", "접근 차단"], ["failed", "실패 기록"], ["completed", "목표 근거 검토 완료"]]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="field" htmlFor={id}>검토 사유<textarea id={id} className="input" name="reason" required maxLength={2000} disabled={pending} placeholder="원본·검색 경로·제약을 확인한 사유" /></label>
    <div className="flex gap-3 items-center flex-wrap"><button className="btn" type="submit" disabled={pending || !hydrated}>{pending ? "검토 저장 중…" : "검토 저장"}</button><span className="text-xs muted">합성·수동 자료는 실제 Work 검증으로 승격되지 않습니다.</span></div>
    <div aria-live="polite">{state.error && <p className="form-error" role="alert">{state.error}</p>}{state.saved && <p className="text-xs text-[#24664f]" role="status">검토 기록을 저장했습니다.</p>}</div>
  </form>;
}

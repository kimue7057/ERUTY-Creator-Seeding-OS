"use client";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { candidateGroup, candidateLabel, candidateName, candidateProfile, type Candidate } from "@/lib/evaluation/presentation";
import { platformLabel } from "@/lib/validation/campaigns";
import { SourceLink, FollowerValue } from "@/components/discovery/display";
import { retryAssessmentAction, shortlistReviewAction, type ShortlistActionState } from "@/app/(app)/campaigns/[id]/shortlist-actions";
import { CreatorLinks } from "./creator-links";
import { AssessmentReport } from "./assessment-report";
const initial: ShortlistActionState = { saved: false, error: "", message: "" };
export type DecisionUpdate = (id: string, verdict: NonNullable<ShortlistActionState["verdict"]>, decision: NonNullable<ShortlistActionState["decision"]>) => void;
function Review({ campaignId, candidate, onReset, onDecision, onNext, onClose }: { campaignId: string; candidate: Candidate; onReset: () => void; onDecision: DecisionUpdate; onNext?: () => void; onClose: () => void }) {
  const [key] = useState(() => crypto.randomUUID()), [checked, setChecked] = useState(false);
  const [state, submit, pending] = useActionState(shortlistReviewAction.bind(null, campaignId, candidate.assessment_id!), initial);
  const [reason, setReason] = useState(""), [confirming, setConfirming] = useState(false), [validation, setValidation] = useState("");
  const ackRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) ackRef.current?.focus({ preventScroll: true }); }, [confirming]);
  useEffect(() => { if (state.saved) nextRef.current?.focus({ preventScroll: true }); }, [state.saved]);
  useEffect(() => { if (state.saved && state.verdict && state.decision) onDecision(candidate.id, state.verdict, state.decision); }, [state, candidate.id, onDecision]);
  function validate(event: FormEvent<HTMLFormElement>) {
    const verdict = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
    if (verdict !== "approved") return;
    if (!checked) {
      event.preventDefault();
      setValidation("평가와 SNS 원본, 미확인 사항을 확인한 뒤 아래 확인란을 선택해 주세요.");
      ackRef.current?.focus();
    } else setValidation("");
  }
  if (state.saved) return <div className="selection-form">
    <p className="selection-receipt" role="status">{state.message}</p>
    <div className="selection-actions">{onNext && <button ref={nextRef} type="button" className="btn btn-primary" onClick={onNext}>다음 후보 검토 →</button>}<button ref={onNext ? undefined : nextRef} type="button" className="btn" onClick={onClose}>목록으로</button></div>
    <div className="decision-followup"><Link href={`/campaigns/${campaignId}?tab=${state.verdict === "approved" ? "selected" : "recommended"}${state.verdict === "hold" ? "&filter=hold" : state.verdict === "rejected" ? "&filter=excluded" : ""}`} className="source-link">판정 결과 목록 보기 →</Link><button type="button" className="source-link" onClick={onReset}>판정 다시 변경</button></div>
  </div>;
  return <form action={submit} onSubmit={validate} className="selection-form" aria-label={`${candidateName(candidate)} 최종 선정`}>
    <input type="hidden" name="idempotency_key" value={key} />
    <h3>{confirming ? "최종 선정 확인" : "이 후보를 어떻게 할까요?"}</h3>
    {confirming ? <>
      <p className="decision-guidance">평가와 SNS 원본을 확인했다면 선정 명단에 추가하세요. 메모는 입력하지 않아도 됩니다.</p>
      <label className="selection-ack"><input ref={ackRef} type="checkbox" name="acknowledged" checked={checked} onChange={e => { setChecked(e.target.checked); setValidation(""); }} disabled={pending} aria-describedby={validation ? "decision-validation" : undefined} /><span>평가와 SNS 원본 근거, 미확인 사항을 확인했습니다.</span></label>
      <label className="field">검토 메모 · 선택<input className="input" name="reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} disabled={pending} placeholder="필요한 경우에만 남겨 주세요" /></label>
      {validation && <p id="decision-validation" className="form-error" role="alert">{validation}</p>}
      <div className="selection-actions"><button name="verdict" value="approved" className="btn btn-primary" disabled={pending || !candidate.can_select}>{pending ? "저장 중…" : "선정 확정"}</button><button type="button" className="btn" disabled={pending} onClick={() => { setConfirming(false); setValidation(""); }}>취소</button></div>
    </> : <>
      <p className="decision-guidance">{candidate.verdict === "approved" ? "선정 명단에 포함된 후보입니다. 보류·제외로 변경할 수 있습니다." : "SNS와 평가를 확인한 뒤 결정하세요. 정보 부족 후보도 직접 선정할 수 있습니다."}</p>
      <div className="selection-actions"><button type="button" className="btn btn-primary" disabled={pending || !candidate.can_select || candidate.verdict === "approved"} onClick={() => setConfirming(true)}>{candidate.verdict === "approved" ? "선정됨" : "최종 선정"}</button><button name="verdict" value="hold" className="btn" disabled={pending}>보류</button><button name="verdict" value="rejected" className="btn" disabled={pending}>제외</button></div>
      {onNext && <button type="button" className="source-link decision-skip" disabled={pending} onClick={onNext}>판정 없이 다음 후보 →</button>}
    </>}
    {!candidate.can_select && <p className="description">SNS 원본 근거의 검증이 필요해 최종 선정이 제한됩니다. 보류·제외는 가능하며, 아래 평가 상세 이력에서 근거 상태를 확인할 수 있습니다.</p>}
    <div aria-live="polite">{state.error && <p className="form-error" role="alert">{state.error}</p>}{pending && <p role="status" className="description">판정을 저장하고 있습니다…</p>}</div>
  </form>;
}
function Retry({ campaignId, id }: { campaignId: string; id: string }) {
  const [state, submit, pending] = useActionState(retryAssessmentAction.bind(null, campaignId, id), initial);
  return <form action={submit}><p className="description mb-3">다시 요청하면 연결된 실행 PC에서 자동 평가를 재실행합니다.</p><button className="btn" disabled={pending || state.saved}>자동 평가 다시 시도</button><p role="status" className="description mt-2">{state.error || state.message}</p></form>;
}
export function CandidatePanel({ candidate: c, campaignId, writable, onClose, onDecision, onNext, position }: { candidate: Candidate; campaignId: string; writable: boolean; onClose: () => void; onDecision: DecisionUpdate; onNext?: () => void; position?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [decisionVersion, setDecisionVersion] = useState(0);
  useEffect(() => {
    const dialog = ref.current!, opener = document.activeElement instanceof HTMLElement ? document.activeElement : null, overflow = document.body.style.overflow;
    dialog.showModal(); document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = overflow; if (opener?.isConnected) opener.focus({ preventScroll: true }); else document.getElementById("candidate-list-heading")?.focus({ preventScroll: true }); };
  }, []);
  const evaluation = c.evaluation, profile = candidateProfile(c), group = candidateGroup(c);
  return <dialog ref={ref} className="candidate-panel" aria-labelledby="candidate-panel-title" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) { const box = e.currentTarget.getBoundingClientRect(); if (e.clientX < box.left || e.clientX > box.right) onClose(); } }}>
    <div className="candidate-panel-heading"><div><p className="description">{platformLabel(c.platform)} · {candidateLabel(c)}{position && ` · ${position}`}</p><h2 id="candidate-panel-title">{candidateName(c)}</h2><p className="description">{c.handle ? `@${c.handle.replace(/^@/, "")}` : "핸들 미확인"}</p></div><button className="btn icon-button" aria-label="후보 상세 닫기" onClick={onClose}><X size={20} /></button></div>
    <div className="candidate-source-bar"><CreatorLinks candidate={c} /></div>
    <div className="candidate-panel-body">
      <div className="candidate-facts"><div><span>{c.platform === "youtube" ? "구독자" : "팔로워"}</span><strong><FollowerValue value={profile.follower?.value ?? null} precision={profile.follower?.precision} /></strong></div><div><span>크리에이터 국가</span><strong>{profile.country || "미확인"}</strong></div><div><span>{evaluation?.total === null ? "확인된 점수" : "평가 점수"}</span><strong>{evaluation ? evaluation.total ?? evaluation.known_subtotal : "평가 전"}{evaluation?.total != null && <small> / 100</small>}</strong></div></div>
      {c.source_warning && <p className="form-error">원본 근거의 재검토·제외 판정 또는 요청 취소로 최종 선정을 보류했습니다.</p>}
      {group === "processing" && <p className="workspace-notice">저장된 SNS 원본을 자동 평가하고 있습니다. 완료되면 추천 여부가 반영됩니다.</p>}
      {group === "unassessed" && <p className="workspace-notice">현재 캠페인 조건으로 평가가 필요합니다. 진행·기록에서 자동 평가를 요청할 수 있습니다.</p>}
      {evaluation && <AssessmentReport candidate={c} evaluation={evaluation} />}
      <section className="candidate-section"><h3>SNS에서 확인한 자료 · {c.evidence.length}건</h3>{c.evidence.map(e => <article className="source-evidence" key={e.id}><div className="source-evidence-heading"><span>{e.kind === "profile_observation" ? "프로필 확인" : "콘텐츠 확인"} · {new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium" }).format(new Date(e.observed_at))}</span><SourceLink url={e.url} label={e.kind === "profile_observation" ? "프로필 원본" : "콘텐츠 원본"} /></div><p className="description whitespace-pre-wrap mt-2">{String(e.facts.note ?? "")}</p>{e.limitations.map((l, i) => <p className="description mt-2" key={i}>{l}</p>)}</article>)}{!c.evidence.length && <p className="description mt-3">평가에 연결된 원본 근거가 아직 없습니다.</p>}</section>
      {c.error_code && <p role="status" className="form-error">{c.error_code === "workspace_spend_cap" ? "Codex 지출 한도에 도달했습니다. 한도 조정 후 다시 시도해 주세요." : "자동 평가가 중단됐습니다. 저장된 후보와 원본은 보존되어 있습니다."}</p>}
      {c.retryable && writable && c.assessment_id && <Retry campaignId={campaignId} id={c.assessment_id} />}
      {c.verdict && <section className="selection-receipt"><strong>{c.verdict === "approved" ? "사용자 최종 선정 완료" : c.verdict === "hold" ? "사용자 보류" : "사용자 제외"}</strong>{c.decision && <><p>{new Date(c.decision.at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p><p>{c.decision.reason}</p></>}</section>}

      {!writable && <p className="description mt-5">현재 계정은 조회 전용입니다.</p>}
      <Link className="source-link mt-6" href={`/evaluations/${campaignId}/${c.id}`}>평가 상세 이력 →</Link>
    </div>
    {writable && c.state === "completed" && c.assessment_id && <div className="decision-dock"><Review key={`${c.assessment_id}/${decisionVersion}`} campaignId={campaignId} candidate={c} onReset={() => setDecisionVersion(v => v+1)} onDecision={onDecision} onNext={onNext} onClose={onClose} /></div>}
  </dialog>;
}

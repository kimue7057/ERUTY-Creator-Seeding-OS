"use client";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { LABELS, RUBRIC } from "@/lib/evaluation/contracts";
import { candidateGroup, candidateLabel, candidateName, candidateProfile, type Candidate } from "@/lib/evaluation/presentation";
import { platformLabel } from "@/lib/validation/campaigns";
import { SourceLink, FollowerValue } from "@/components/discovery/display";
import { retryAssessmentAction, shortlistReviewAction } from "@/app/(app)/campaigns/[id]/shortlist-actions";
const initial = { saved: false, error: "", message: "" };
function Review({ campaignId, candidate }: { campaignId: string; candidate: Candidate }) {
  const [key] = useState(() => crypto.randomUUID()), [checked, setChecked] = useState(false);
  const [state, submit, pending] = useActionState(shortlistReviewAction.bind(null, campaignId, candidate.assessment_id!), initial);
  if (candidate.verdict === "approved" && !state.saved) return null;
  return <form action={submit} className="selection-form" aria-label={`${candidateName(candidate)} 최종 선정`}>
    <h3>최종 선정</h3><input type="hidden" name="idempotency_key" value={key} />
    <label className="selection-ack"><input type="checkbox" name="acknowledged" checked={checked} onChange={e => setChecked(e.target.checked)} disabled={pending || state.saved} /><span>평가와 SNS 원본 근거, 미확인 사항을 확인했습니다.</span></label>
    <label className="field">검토 메모<input className="input" name="reason" maxLength={1000} disabled={pending || state.saved} placeholder="선택 사항 · 선정 사유나 확인할 내용" /></label>
    <div className="selection-actions"><button name="verdict" value="approved" className="btn btn-primary" disabled={pending || state.saved || !checked || candidateGroup(candidate) === "needs_info" || candidate.recommendation !== "recommended"}>{pending ? "저장 중…" : "최종 선정"}</button><button name="verdict" value="hold" className="btn" disabled={pending || state.saved}>보류</button><button name="verdict" value="rejected" className="btn" disabled={pending || state.saved}>제외</button></div>
    {candidate.recommendation !== "recommended" && <p className="description">추천 기준을 충족한 후보만 최종 선정할 수 있습니다.</p>}
    <div aria-live="polite">{state.error && <p className="form-error" role="alert">{state.error}</p>}{state.message && <p className="selection-receipt" role="status">{state.message}</p>}</div>
  </form>;
}
function Retry({ campaignId, id }: { campaignId: string; id: string }) {
  const [state, submit, pending] = useActionState(retryAssessmentAction.bind(null, campaignId, id), initial);
  return <form action={submit}><p className="description mb-3">다시 요청하면 연결된 실행 PC에서 자동 평가를 재실행합니다.</p><button className="btn" disabled={pending || state.saved}>자동 평가 다시 시도</button><p role="status" className="description mt-2">{state.error || state.message}</p></form>;
}
export function CandidatePanel({ candidate: c, campaignId, writable, onClose }: { candidate: Candidate; campaignId: string; writable: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!, opener = document.activeElement instanceof HTMLElement ? document.activeElement : null, overflow = document.body.style.overflow;
    dialog.showModal(); document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = overflow; opener?.focus({ preventScroll: true }); };
  }, []);
  const evaluation = c.evaluation, profile = candidateProfile(c), group = candidateGroup(c);
  return <dialog ref={ref} className="candidate-panel" aria-labelledby="candidate-panel-title" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) { const box = e.currentTarget.getBoundingClientRect(); if (e.clientX < box.left || e.clientX > box.right) onClose(); } }}>
    <div className="candidate-panel-heading"><div><p className="description">{platformLabel(c.platform)} · {candidateLabel(c)}</p><h2 id="candidate-panel-title">{candidateName(c)}</h2></div><button className="btn icon-button" aria-label="후보 상세 닫기" onClick={onClose}><X size={20} /></button></div>
    <div className="candidate-panel-body"><p className="description">{c.handle ? `@${c.handle.replace(/^@/, "")}` : "핸들 미확인"}</p><SourceLink url={c.url} label="SNS 프로필 열기" />
      <div className="candidate-facts"><div><span>{c.platform === "youtube" ? "구독자" : "팔로워"}</span><strong><FollowerValue value={profile.follower?.value ?? null} precision={profile.follower?.precision} /></strong></div><div><span>크리에이터 국가</span><strong>{profile.country || "미확인"}</strong></div><div><span>{evaluation?.total === null ? "확인된 점수" : "평가 점수"}</span><strong>{evaluation ? evaluation.total ?? evaluation.known_subtotal : "평가 전"}{evaluation?.total != null && <small> / 100</small>}</strong></div></div>
      {evaluation && <section className="candidate-section"><h3>캠페인 적합도</h3><p className="candidate-summary">{evaluation.output.summary}</p><p className="description">평가 신뢰도 {Math.round(evaluation.output.confidence * 100)}%{evaluation.total === null && ` · ${evaluation.unknown_count}개 항목 미확인 · 총점 미확정`}</p></section>}
      {c.source_warning && <p className="form-error">원본 근거의 재검토·제외 판정 또는 요청 취소로 최종 선정을 보류했습니다.</p>}
      {group === "processing" && <p className="workspace-notice">저장된 SNS 원본을 자동 평가하고 있습니다. 완료되면 추천 여부가 반영됩니다.</p>}
      {group === "unassessed" && <p className="workspace-notice">현재 캠페인 조건으로 평가가 필요합니다. 진행·기록에서 자동 평가를 요청할 수 있습니다.</p>}
      {evaluation && <><details className="candidate-section rubric-disclosure"><summary>점수와 판단 근거</summary><dl className="rubric-list">{(Object.keys(RUBRIC) as (keyof typeof RUBRIC)[]).map(key => { const value = evaluation.output.criteria[key]; return <div key={key}><dt><span>{LABELS[key]}</span><strong>{value.score === null ? "미확인" : `${value.score} / ${RUBRIC[key]}`}</strong></dt><dd>{value.reason}</dd></div>; })}</dl></details><section className="candidate-section"><h3>주의·미확인 사항</h3><p className="description mt-3">시청자 국가 분포는 별도 확인되지 않았습니다. 거주 국가와 시청자 국가는 다를 수 있습니다.</p>{evaluation.output.risk_flags.filter(r => r !== "audience_country_unverified").map(flag => <p className="description mt-2" key={flag}>{flag}</p>)}</section></>}
      <section className="candidate-section"><h3>SNS 원본 근거 · {c.evidence.length}건</h3>{c.evidence.map(e => <details className="source-evidence" key={e.id}><summary>{e.kind === "profile_observation" ? "프로필 확인" : "콘텐츠 확인"} · {new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium" }).format(new Date(e.observed_at))}</summary><SourceLink url={e.url} label={e.kind === "profile_observation" ? "프로필 원본" : "콘텐츠 원본"} /><p className="description whitespace-pre-wrap mt-2">{String(e.facts.note ?? "")}</p>{e.limitations.map((l, i) => <p className="description mt-2" key={i}>{l}</p>)}</details>)}{!c.evidence.length && <p className="description mt-3">평가에 연결된 원본 근거가 아직 없습니다.</p>}</section>
      {c.error_code && <p role="status" className="form-error">{c.error_code === "workspace_spend_cap" ? "Codex 지출 한도에 도달했습니다. 한도 조정 후 다시 시도해 주세요." : "자동 평가가 중단됐습니다. 저장된 후보와 원본은 보존되어 있습니다."}</p>}
      {c.retryable && writable && c.assessment_id && <Retry campaignId={campaignId} id={c.assessment_id} />}
      {c.verdict && <section className="selection-receipt"><strong>{c.verdict === "approved" ? "사용자 최종 선정 완료" : c.verdict === "hold" ? "사용자 보류" : "사용자 제외"}</strong>{c.decision && <><p>{new Date(c.decision.at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p><p>{c.decision.reason}</p></>}</section>}
      {writable && !c.source_warning && c.state === "completed" && c.assessment_id && <Review key={c.assessment_id} campaignId={campaignId} candidate={c} />}
      {!writable && <p className="description mt-5">현재 계정은 조회 전용입니다.</p>}
      <Link className="source-link mt-6" href={`/evaluations/${campaignId}/${c.id}`}>평가 상세 이력 →</Link>
    </div>
  </dialog>;
}

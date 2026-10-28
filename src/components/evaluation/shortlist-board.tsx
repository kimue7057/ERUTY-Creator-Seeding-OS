"use client";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import type { ShortlistBoard } from "@/lib/evaluation/shortlist";
import { LABELS, RUBRIC } from "@/lib/evaluation/contracts";
import { platformLabel } from "@/lib/validation/campaigns";
import { SourceLink, FollowerValue } from "@/components/discovery/display";
import { enqueueCampaignAction, retryAssessmentAction, shortlistReviewAction } from "@/app/(app)/campaigns/[id]/shortlist-actions";

const initial = { saved: false, error: "", message: "" };
type Candidate = ShortlistBoard["candidates"][number];
const tabs = { pending: "승인 대기", approved: "승인됨", needs_info: "추가 확인", excluded: "제외", all: "전체" };
type Tab = keyof typeof tabs;
function category(c: Candidate): Tab {
  if (c.verdict === "approved") return "approved";
  if (c.verdict === "rejected" || c.recommendation === "excluded") return "excluded";
  return c.state === "completed" && c.recommendation === "recommended" && c.verdict !== "hold" ? "pending" : "needs_info";
}
function Review({ campaignId, candidate }: { campaignId: string; candidate: Candidate }) {
  const [key] = useState(() => crypto.randomUUID());
  const [checked, setChecked] = useState(false);
  const [state, submit, pending] = useActionState(shortlistReviewAction.bind(null, campaignId, candidate.assessment_id!), initial);
  if (candidate.verdict === "approved" && !state.saved) return null;
  return <form action={submit} className="mt-5 border-t border-[#edf0eb] pt-4" aria-label={`${candidate.name || candidate.handle} 최종 판정`}>
    <input type="hidden" name="idempotency_key" value={key} />
    <label className="flex gap-2 items-start text-sm"><input className="mt-1" type="checkbox" name="acknowledged" checked={checked} onChange={e => setChecked(e.target.checked)} disabled={pending || state.saved} /><span>평가와 SNS 원본 근거, 미확인 사항을 확인했습니다.</span></label>
    <label className="field mt-3">검토 메모 <span className="muted">선택</span><input className="input" name="reason" maxLength={1000} disabled={pending || state.saved} placeholder="판정 사유나 추가 확인할 내용" /></label>
    <div className="flex flex-wrap gap-2 mt-3">
      <button name="verdict" value="approved" className="btn btn-primary" disabled={pending || state.saved || !checked || candidate.recommendation !== "recommended"}>{pending ? "저장 중…" : "최종 승인"}</button>
      <button name="verdict" value="hold" className="btn" disabled={pending || state.saved}>보류</button>
      <button name="verdict" value="rejected" className="btn" disabled={pending || state.saved}>제외</button>
    </div>
    <div aria-live="polite">{state.error && <p className="form-error" role="alert">{state.error}</p>}{state.message && <p className="description mt-3" role="status">{state.message}</p>}</div>
  </form>;
}
function Retry({ campaignId, id }: { campaignId: string; id: string }) {
  const [state, submit, pending] = useActionState(retryAssessmentAction.bind(null, campaignId, id), initial);
  return <form action={submit} className="mt-3"><button className="btn" disabled={pending || state.saved}>자동 평가 다시 시도</button><p role="status" className="description">{state.error || state.message}</p></form>;
}
function CandidateCard({ candidate: c, campaignId, writable }: { candidate: Candidate; campaignId: string; writable: boolean }) {
  const evaluation = c.evaluation;
  const profile = c.evidence.filter(e => e.kind === "profile_observation").sort((a,b) => b.observed_at.localeCompare(a.observed_at))[0];
  const follower = profile?.facts.metrics.find(m => m.name === (c.platform === "youtube" ? "subscribers" : "followers"));
  const label = category(c);
  const stateLabel = c.state === "queued" ? "자동 평가 대기" : c.state === "running" ? "AI 평가 중" : c.state === "failed" ? "평가 실패" : c.state === "stale" ? "조건 변경 · 재평가 필요" : c.state === "unassessed" ? "자동 평가 전" : tabs[label];
  return <article className="surface panel-body" aria-label={`${c.name || c.handle} 추천 후보`}>
    <div className="flex justify-between gap-3 items-start"><div><div className="flex gap-2 flex-wrap mb-2"><span className="badge">{platformLabel(c.platform)}</span><span className={`badge ${label === "approved" || label === "pending" ? "badge-green" : "badge-amber"}`}>{stateLabel}</span></div><h3 className="text-lg">{c.name || c.handle || "이름 미확인"}</h3><p className="description">{c.handle ? `@${c.handle.replace(/^@/, "")}` : "핸들 미확인"}</p></div>
      {evaluation && <div className="text-right shrink-0"><strong className="text-2xl">{evaluation.total ?? evaluation.known_subtotal}</strong><p className="text-xs muted">{evaluation.total === null ? `확인 점수 · ${evaluation.unknown_count}개 항목 미확인` : "/ 100점"}</p></div>}</div>
    <SourceLink url={c.url} label="프로필 열기" />
    <p className="description mt-3">{c.platform === "youtube" ? "구독자" : "팔로워"} <FollowerValue value={follower?.value ?? null} precision={follower?.precision} />{profile?.facts.country?.code ? ` · 크리에이터 국가 ${profile.facts.country.code}` : " · 크리에이터 국가 미확인"}</p>
    {c.source_warning && <p role="status" className="form-error">원본 근거에 재검토·제외 판정 또는 요청 취소가 있어 최종 승인을 보류했습니다.</p>}
    {evaluation && <><p className="body-copy mt-4 whitespace-pre-wrap">{evaluation.output.summary}</p><p className="description mt-3">평가 신뢰도 {Math.round(evaluation.output.confidence * 100)}%{evaluation.total === null ? " · 미확인 항목은 총점에서 확정하지 않았습니다." : ""}</p>
      <details className="review-disclosure mt-4"><summary>점수 근거·미확인 사항 보기</summary><dl className="mt-3">{(Object.keys(RUBRIC) as (keyof typeof RUBRIC)[]).map(key => { const value = evaluation.output.criteria[key]; return <div key={key} className="py-3 border-t border-[#edf0eb]"><dt className="font-semibold text-sm">{LABELS[key as keyof typeof LABELS]} · {value.score === null ? "미확인" : `${value.score}/${RUBRIC[key as keyof typeof RUBRIC]}`}</dt><dd className="description mt-2">{value.reason}</dd></div>; })}</dl>
        <p className="text-xs font-semibold mt-3">주의·미확인 사항</p><p className="description mt-2">시청자 국가 분포는 별도 확인되지 않았습니다. 거주 국가와 시청자 국가는 다를 수 있습니다.</p>{evaluation.output.risk_flags.filter(r => r !== "audience_country_unverified").map(flag => <p className="description" key={flag}>{flag}</p>)}
      </details></>}
    {c.evidence.length > 0 && <details className="review-disclosure"><summary>SNS 원본 근거 {c.evidence.length}건</summary><div className="stack mt-3">{c.evidence.map(e => <div key={e.id}><SourceLink url={e.url} label={e.kind === "profile_observation" ? "프로필 원본" : "콘텐츠 원본"} /><p className="text-xs muted mt-1">확인 {new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium" }).format(new Date(e.observed_at))}</p><p className="description whitespace-pre-wrap mt-2">{String(e.facts.note ?? "")}</p>{e.limitations.map((l, i) => <p className="text-xs muted mt-1" key={i}>{l}</p>)}</div>)}</div></details>}
    {c.error_code && <p role="status" className="form-error">{c.error_code === "workspace_spend_cap" ? "Codex 지출 한도에 도달했습니다. 한도 조정 후 다시 시도해 주세요." : "자동 평가가 중단됐습니다. 저장된 후보와 원본은 보존되어 있습니다."}</p>}
    {c.retryable && writable && c.assessment_id && <Retry campaignId={campaignId} id={c.assessment_id} />}
    {writable && !c.source_warning && c.state === "completed" && c.assessment_id && <Review campaignId={campaignId} candidate={c} />}
    {c.verdict && <p className="description mt-4" role="status">{c.verdict === "approved" ? "사용자 최종 승인 완료" : c.verdict === "hold" ? "사용자 보류" : "사용자 제외"}</p>}
    <Link className="source-link mt-4" href={`/evaluations/${campaignId}/${c.id}`}>평가 이력 →</Link>
  </article>;
}
export function ShortlistBoardView({ campaignId, writable }: { campaignId: string; writable: boolean }) {
  const [data, setData] = useState<ShortlistBoard | null>(null), [error, setError] = useState(false), [tab, setTab] = useState<Tab>("pending");
  const [state, enqueue, pending] = useActionState(enqueueCampaignAction.bind(null, campaignId), initial);
  // Keep already displayed cards mounted after a decision. This preserves form
  // feedback, keyboard focus and scroll until the user changes the filter.
  const [retained, setRetained] = useState<Set<string>>(new Set());
  useEffect(() => {
    let disposed = false, loading = false; const controller = new AbortController();
    const poll = async () => { if (loading) return; loading = true; try { const response = await fetch(`/api/campaigns/shortlist?campaign_id=${campaignId}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) }); if (!response.ok) throw new Error(); const next: ShortlistBoard = await response.json(); if (!disposed) { setData(next); setError(false); } } catch { if (!disposed) setError(true); } finally { loading = false; } };
    void poll(); const timer = setInterval(() => void poll(), 6000); return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, [campaignId]);
  const candidates = data?.candidates ?? [];
  const shown = candidates.filter(c => tab === "all" || category(c) === tab || retained.has(c.id));
  const waiting = candidates.filter(c => ["queued", "running"].includes(c.state)).length;
  const unassessed = candidates.filter(c => ["unassessed", "stale"].includes(c.state)).length;
  return <section aria-label="추천 후보와 최종 승인" className="mt-8">
    <div className="flex flex-wrap justify-between items-start gap-3 mb-4"><div><h2>추천 후보 · 최종 승인</h2><p className="description mt-2">자동으로 평가한 추천 후보를 확인하고 최종 명단을 승인하세요.</p></div><Link href={`/campaigns/${campaignId}/discovery`} className="source-link">전체 발굴 기록 →</Link></div>
    <p className="text-xs muted mb-5">추천 기준: 확인 점수 70점 이상 · 제품 적합도 18/30 이상 · 신뢰도 60% 이상 · SNS 원본 확인. 미확인 항목은 0점으로 처리하지 않습니다.</p>
    {error && <p role="status" className="form-error mb-3">최신 상태를 불러오지 못했습니다. 다시 연결하고 있습니다.</p>}
    {waiting > 0 && <p role="status" className="info-banner">{waiting}명 자동 평가 진행·대기 중입니다. 완료되면 이곳에 반영됩니다.</p>}
    {writable && !data?.archived && unassessed > 0 && <form action={enqueue} className="info-banner flex flex-wrap gap-3 items-center"><p>{unassessed}명의 기존 후보를 현재 조건으로 자동 평가할 수 있습니다.</p><button className="btn" disabled={pending}>{pending ? "요청 중…" : "기존 후보 자동 평가"}</button><p role="status" className="description">{state.error || state.message}</p></form>}
    <div className="flex flex-wrap gap-2 mb-5" role="group" aria-label="추천 후보 필터">{Object.entries(tabs).map(([key, label]) => <button key={key} className={`btn ${tab === key ? "btn-primary" : ""}`} aria-pressed={tab === key} onClick={() => { setTab(key as Tab); setRetained(new Set()); }}>{label} · {key === "all" ? candidates.length : candidates.filter(c => category(c) === key).length}</button>)}</div>
    {!data ? <p className="description" role="status">추천 후보를 불러오는 중…</p> : !shown.length ? <div className="surface panel-body"><h3>{tab === "pending" ? "추천 후보가 준비되면 여기에 나타납니다." : "이 상태의 후보가 없습니다."}</h3><p className="description mt-2">{waiting ? "저장된 SNS 근거를 평가하고 있습니다." : !candidates.length ? "위에서 플랫폼과 인원을 선택해 발굴·추천을 시작하세요." : "‘추가 확인’에서 평가 대기나 정보가 부족한 후보도 확인할 수 있습니다."}</p></div> : <div className="grid gap-5 lg:grid-cols-2" onFocusCapture={e => { const card = e.target.closest("article"); const id = shown.find(c => card?.getAttribute("aria-label") === `${c.name || c.handle} 추천 후보`)?.id; if (id) setRetained(prev => prev.has(id) ? prev : new Set([...prev, id])); }}>{shown.map(c => <CandidateCard key={`${tab}/${c.assessment_id ?? c.id}`} candidate={c} campaignId={campaignId} writable={writable && !data.archived} />)}</div>}
  </section>;
}

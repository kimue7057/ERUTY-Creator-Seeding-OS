"use client";
import Link from "next/link";
import { useActionState, useCallback, useEffect, useState, type ReactNode, type MouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, Search, Users } from "lucide-react";
import type { ShortlistBoard } from "@/lib/evaluation/shortlist";
import { candidateGroup, isReviewPending, candidateLabel, candidateName, candidateProfile, shortlistCounts, type Candidate } from "@/lib/evaluation/presentation";
import { platformLabel } from "@/lib/validation/campaigns";
import { FollowerValue } from "@/components/discovery/display";
import { AutomaticProgress } from "@/components/discovery/automatic-progress";
import { CandidatePanel, type DecisionUpdate } from "./candidate-panel";
import { enqueueCampaignAction } from "@/app/(app)/campaigns/[id]/shortlist-actions";

const tabs = { recommended: "후보 검토", selected: "선정 명단", history: "진행·기록", settings: "캠페인 설정" };
type Tab = keyof typeof tabs;
const reviewFilters = { review_pending: "검토 대기", recommended: "AI 추천", hold: "보류", needs_info: "정보 부족", excluded: "제외", all: "전체 후보" };
const progressFilters = { all: "전체 후보", processing: "평가 중", interrupted: "평가 중단", unassessed: "평가 필요" };
function CandidateRow({ c, onOpen, writable }: { c: Candidate; onOpen: () => void; writable: boolean }) {
  const profile = candidateProfile(c), group = candidateGroup(c);
  return <article className="candidate-row" aria-label={`${candidateName(c)} 후보`}>
    <div className="candidate-identity"><span className="candidate-initial" aria-hidden="true">{candidateName(c).slice(0,1).toUpperCase()}</span><div><button className="candidate-name" onClick={onOpen}>{candidateName(c)}</button><p className="description">{platformLabel(c.platform)}{c.handle ? ` · @${c.handle.replace(/^@/, "")}` : ""}</p></div></div>
    <div className="candidate-row-reason"><span className={`badge ${["recommended", "selected"].includes(group) ? "badge-green" : ""}`}>{candidateLabel(c)}</span>{c.verdict && c.recommendation !== "recommended" && <span className="badge ml-1">AI: {c.recommendation === "excluded" ? "제외 제안" : "정보 부족"}</span>}<p>{c.evaluation?.output.summary || (group === "processing" ? "SNS 원본 근거를 자동 평가하고 있습니다." : group === "interrupted" ? "평가가 중단됐습니다. 상세에서 원인과 재시도를 확인하세요." : "현재 조건으로 자동 평가가 필요합니다.")}</p></div>
    <div className="candidate-row-metrics"><span>{c.platform === "youtube" ? "구독자" : "팔로워"}</span><strong><FollowerValue value={profile.follower?.value ?? null} precision={profile.follower?.precision} /></strong><span>{profile.country || "국가 미확인"}</span></div>
    <div className="candidate-row-score"><strong>{c.evaluation ? c.evaluation.total ?? c.evaluation.known_subtotal : "—"}</strong><span>{!c.evaluation ? "평가 전" : c.evaluation.total === null ? `확인 점수 · 미확인 ${c.evaluation.unknown_count}` : "/ 100점"}</span></div>
    <button className="btn candidate-open" onClick={onOpen} aria-label={`${candidateName(c)} ${writable ? "검토·선정" : "상세 보기"}`}>{writable ? "검토·선정" : "상세 보기"}<ArrowRight size={14} /></button>
  </article>;
}
export function ShortlistBoardView({ campaignId, writable, initialData, goal, requestForm, settings }: { campaignId: string; writable: boolean; initialData: ShortlistBoard; goal: number; requestForm: ReactNode; settings: ReactNode }) {
  const params = useSearchParams(), tab: Tab = Object.hasOwn(tabs, params.get("tab") || "") ? params.get("tab") as Tab : "recommended";
  const filter = params.get("filter") || (tab === "history" ? "all" : "review_pending"), selectedId = params.get("candidate");
  const [data, setData] = useState(initialData), [error, setError] = useState(false), [activeRequests, setActiveRequests] = useState(0);
  const updateDecision = useCallback<DecisionUpdate>((id, verdict, decision) => setData(current => ({ ...current, candidates: current.candidates.map(c => c.id === id ? { ...c, verdict, decision } : c) })), []);
  const [query, setQuery] = useState(""), [platform, setPlatform] = useState(""), [sort, setSort] = useState("score");
  const [state, enqueue, pending] = useActionState(enqueueCampaignAction.bind(null, campaignId), { saved: false, error: "", message: "" });
  // Keep a focused row and open panel mounted through polling and a decision.
  const [retained, setRetained] = useState<Set<string>>(new Set());
  useEffect(() => {
    let disposed = false, loading = false; const controller = new AbortController();
    const poll = async () => { if (loading) return; loading = true; try { const response = await fetch(`/api/campaigns/shortlist?campaign_id=${campaignId}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) }); if (!response.ok) throw new Error(); const next: ShortlistBoard = await response.json(); if (!disposed) { setData(next); setError(false); } } catch { if (!disposed) setError(true); } finally { loading = false; } };
    void poll(); const timer = setInterval(() => void poll(), 6000); return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, [campaignId]);
  function navigate(next: Record<string, string | null>, push = true) {
    const url = new URL(window.location.href);
    Object.entries(next).forEach(([key,value]) => { if (value === null) url.searchParams.delete(key); else url.searchParams.set(key,value); });
    window.history[push ? "pushState" : "replaceState"](null,"",`${url.pathname}${url.search}`);
  }
  function switchTab(next: Tab, nextFilter?: string) { setRetained(new Set()); navigate({ tab: next, filter: nextFilter || null, candidate: null }); }
  function tabClick(e: MouseEvent<HTMLAnchorElement>, next: Tab) { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) { e.preventDefault(); switchTab(next); } }
  const counts = shortlistCounts(data.candidates), selected = data.candidates.find(c => c.id === selectedId);
  const filters = tab === "history" ? progressFilters : reviewFilters;
  const validFilter = Object.hasOwn(filters, filter) ? filter : tab === "history" ? "all" : "review_pending";
  const list = data.candidates.filter(c => {
    const group = candidateGroup(c), matches = tab === "selected" ? group === "selected" : validFilter === "all" || (validFilter === "review_pending" ? isReviewPending(c) : group === validFilter);
    return (matches || retained.has(c.id)) && (!platform || c.platform === platform) && `${c.name} ${c.handle}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }).sort((a,b) => sort === "name" ? candidateName(a).localeCompare(candidateName(b)) : (b.evaluation?.total ?? b.evaluation?.known_subtotal ?? -1) - (a.evaluation?.total ?? a.evaluation?.known_subtotal ?? -1) || candidateName(a).localeCompare(candidateName(b)));
  const title = tab === "selected" ? "최종 선정 명단" : tab === "history" ? "발굴과 평가 진행 상황" : validFilter === "recommended" ? "검토할 추천 후보" : reviewFilters[validFilter as keyof typeof reviewFilters];
  const nextAction = counts.review_pending ? `검토 대기 ${counts.review_pending}명입니다. AI 추천 ${counts.recommended}명과 정보 부족 ${counts.needs_info}명을 확인해 선정·보류·제외를 결정하세요.` : activeRequests ? `SNS 발굴 ${activeRequests}건을 진행하고 있습니다. 후보가 저장되면 순서대로 자동 평가합니다.` : counts.processing ? `${counts.processing}명을 자동 평가하고 있습니다. 추천 기준에 맞는 후보가 준비되면 여기에 표시됩니다.` : counts.discovered ? "현재 검토할 추천 후보가 없습니다. 정보 부족·제외 사유를 확인하거나 추가 발굴을 요청할 수 있습니다." : "플랫폼과 인원을 정해 발굴을 시작하세요. 자동 평가 후 추천 후보만 모아드립니다.";
  return <div className="campaign-workspace">
    <div className="workspace-counts" aria-label="캠페인 진행 요약">{[
      { label: "발굴한 후보", value: counts.discovered, note: "누적 저장", tab: "history" as Tab },
      { label: "평가 완료", value: counts.evaluated, note: `대기·진행 ${counts.processing}명`, tab: "history" as Tab },
      { label: "검토 대기", value: counts.review_pending, note: "사용자 최종 선정 대기", tab: "recommended" as Tab },
      { label: "최종 선정", value: counts.selected, note: `목표 ${goal}명`, tab: "selected" as Tab },
    ].map(item => <button key={item.label} onClick={() => switchTab(item.tab)}><span>{item.label}</span><strong>{item.value}<small>명</small></strong><span>{item.note}</span></button>)}</div>
    <div className="workspace-next"><div><span className="eyebrow">지금 할 일</span><p>{data.archived ? "보관된 캠페인입니다. 기존 결과와 기록을 확인할 수 있습니다." : nextAction}</p></div>{counts.review_pending > 0 && tab !== "recommended" && <button className="btn btn-primary" onClick={() => switchTab("recommended")}>후보 검토하기<ArrowRight size={14} /></button>}</div>
    <nav className="workspace-tabs" aria-label="캠페인 작업 메뉴">{Object.entries(tabs).map(([key,label]) => <a key={key} href={`?tab=${key}`} aria-current={tab === key ? "page" : undefined} onClick={e => tabClick(e,key as Tab)}>{label}{key === "recommended" && counts.review_pending > 0 && <span>{counts.review_pending}</span>}{key === "selected" && <span>{counts.selected}</span>}</a>)}</nav>
    {error && <p role="status" className="form-error">최신 상태를 불러오지 못했습니다. 표시된 결과를 유지하며 다시 연결하고 있습니다.</p>}
    <div hidden={tab === "settings"}>
      {requestForm && <details className="workspace-request surface" open={initialData.candidates.length === 0 && activeRequests === 0}><summary><Search size={17} /><span>{counts.discovered || activeRequests ? "후보 추가 발굴" : "새 후보 발굴 시작"}</span><span className="description">플랫폼 · 탐색 인원 설정</span></summary><div className="workspace-request-body">{requestForm}</div></details>}
      {counts.interrupted > 0 && tab !== "history" && <button className="workspace-error-shortcut" onClick={() => switchTab("history","interrupted")}>자동 평가 {counts.interrupted}명 중단 · 확인하기 →</button>}
      <AutomaticProgress campaignId={campaignId} writable={writable && !data.archived} compact={tab !== "history"} onActiveChange={setActiveRequests} />
      {counts.interrupted > 0 && tab === "history" && <div className="workspace-alert" role="status"><span>자동 평가 {counts.interrupted}명 중단 · 저장된 후보와 원본은 보존되어 있습니다.</span><button className="btn" onClick={() => switchTab("history","interrupted")}>중단된 평가 확인</button></div>}
    </div>
    <section hidden={tab === "settings"} aria-label={title}>
      <div className="workspace-section-heading"><div><h2>{title}</h2><p className="description">{tab === "selected" ? `사용자가 최종 선정한 ${counts.selected}명 · 목표 ${goal}명` : tab === "history" ? "자동 처리 상태와 전체 후보를 확인하세요." : "후보를 비교한 뒤 상세에서 평가와 SNS 원본을 확인하세요."}</p></div>{tab === "history" && <Link className="btn" href={`/campaigns/${campaignId}/discovery`}>상세 발굴 기록<ArrowRight size={14} /></Link>}</div>
      {tab === "history" && writable && !data.archived && counts.unassessed > 0 && <form action={enqueue} className="workspace-notice"><p>현재 조건으로 평가가 필요한 후보 {counts.unassessed}명</p><button className="btn" disabled={pending}>{pending ? "요청 중…" : "기존 후보 자동 평가"}</button><p role="status">{state.error || state.message}</p></form>}
      {tab !== "selected" && <div className="candidate-filters" role="group" aria-label="후보 상태 필터">{Object.entries(filters).map(([key,label]) => <button key={key} aria-pressed={validFilter === key} onClick={() => { setRetained(new Set()); navigate({ filter: key, candidate: null }); }}>{label}<span>{key === "all" ? counts.discovered : counts[key as keyof typeof counts]}</span></button>)}</div>}
      <div className="candidate-toolbar"><label className="candidate-search"><Search size={16} /><input aria-label="후보 이름 검색" placeholder="이름 또는 핸들 검색" value={query} onChange={e => setQuery(e.target.value)} /></label><select className="input" aria-label="후보 플랫폼" value={platform} onChange={e => setPlatform(e.target.value)}><option value="">전체 플랫폼</option>{[...new Set(data.candidates.map(c => c.platform))].map(p => <option key={p} value={p}>{platformLabel(p)}</option>)}</select><select className="input" aria-label="후보 정렬" value={sort} onChange={e => setSort(e.target.value)}><option value="score">확인 점수 높은 순</option><option value="name">이름순</option></select></div>
      <div className="candidate-list surface" onFocusCapture={e => { const row = (e.target as HTMLElement).closest("[data-candidate]"), id = row?.getAttribute("data-candidate"); if (id) setRetained(prev => prev.has(id) ? prev : new Set([...prev,id])); }}>
        {list.length ? list.map(c => <div key={c.id} data-candidate={c.id}><CandidateRow c={c} writable={writable && !data.archived} onOpen={() => navigate({ candidate: c.id })} /></div>) : <div className="workspace-empty"><span className="empty-symbol">{tab === "selected" ? <Check size={25} /> : <Users size={25} />}</span><h3>{query || platform ? "검색 조건에 맞는 후보가 없습니다" : tab === "selected" ? "최종 선정한 후보가 아직 없습니다" : counts.processing && ["recommended", "review_pending"].includes(validFilter) ? "후보를 자동 평가하고 있습니다" : !counts.discovered && activeRequests ? "SNS에서 후보를 찾고 있습니다" : !counts.discovered ? "발굴을 시작하면 추천 후보가 모입니다" : validFilter === "recommended" ? "현재 검토할 추천 후보가 없습니다" : "이 상태의 후보가 없습니다"}</h3><p className="description">{query || platform ? "이름이나 플랫폼 필터를 바꿔 보세요." : tab === "selected" ? "추천 후보의 상세에서 최종 선정하면 이 명단에 반영됩니다." : counts.processing && ["recommended", "review_pending"].includes(validFilter) ? "평가 중인 후보는 진행·기록에서 확인할 수 있습니다. 완료되면 자동으로 반영됩니다." : !counts.discovered && activeRequests ? "후보가 저장되면 순서대로 자동 평가합니다. 진행·기록에서 탐색 상황을 확인하세요." : !counts.discovered ? "SNS 탐색과 자동 평가를 마치면 적합한 후보만 추천합니다." : "AI 판단과 별개로 정보 부족·제외 후보도 상세에서 직접 판정할 수 있습니다."}</p>{counts.needs_info > 0 && validFilter === "recommended" && <button className="btn btn-primary mt-4" onClick={() => { setRetained(new Set()); navigate({filter:"needs_info"}); }}>정보 부족 {counts.needs_info}명 직접 검토</button>}{counts.processing > 0 && tab !== "history" && <button className="btn mt-4" onClick={() => switchTab("history","processing")}>평가 진행 확인</button>}</div>}
      </div><p className="workspace-policy">AI 추천 기준: 확인 점수 70점 이상 · 제품 적합도 18/30 이상 · 신뢰도 60% 이상 · SNS 원본 확인. 미확인 항목은 0점으로 처리하지 않습니다. 사람의 최종 선정은 AI 추천 여부와 별도로 기록합니다. 캠페인별 최대 200명을 표시합니다.</p>
    </section>
    <section hidden={tab !== "settings"} aria-label="캠페인 설정">{settings}</section>
    {selected && <CandidatePanel key={selected.id} candidate={selected} campaignId={campaignId} writable={writable && !data.archived} onClose={() => navigate({ candidate: null },false)} onDecision={updateDecision} />}
    {selectedId && !selected && <p role="status" className="workspace-notice">이 후보를 현재 캠페인에서 찾을 수 없습니다. <button className="btn" onClick={() => navigate({ candidate: null },false)}>목록으로</button></p>}
  </div>;
}

"use client";
import { useActionState, useState } from "react";
import { useHydrated } from "@/components/use-hydrated";
import { createBrowserRequestAction, cancelBrowserRequestAction } from "@/app/(app)/campaigns/[id]/discovery/actions";

export function BrowserRequestForm({ campaignId, contextHash, platforms, goal, requestKey, automatic = false, shortlist = false }: { campaignId: string; contextHash: string; platforms: { value: string; label: string }[]; goal: number; requestKey: string; automatic?: boolean; shortlist?: boolean }) {
  const [state, submit, pending] = useActionState(createBrowserRequestAction.bind(null, campaignId, contextHash), { error: "", saved: false, requestId: "", prompt: "" });
  const hydrated = useHydrated();
  return <form action={submit} className="review-form" aria-label="Codex 발굴 요청" aria-busy={pending}>
    <input type="hidden" name="idempotency_key" value={requestKey} />
    {!state.saved && <div className="grid gap-4 sm:grid-cols-2"><label className="field">탐색 플랫폼<select className="input" name="platform" defaultValue={platforms[0]?.value} disabled={pending} required>{platforms.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
      <label className="field">이번 탐색 인원<input className="input" type="number" name="requested_count" min={1} max={20} defaultValue={Math.min(20, goal)} disabled={pending} required /><span className="text-xs muted">플랫폼별 1–20명 · 캠페인 전체 목표 {goal}명</span></label></div>}
    <p className="description">{automatic ? shortlist ? "SNS에서 찾은 후보를 자동 평가해 추천합니다. 최종 선정은 추천 후보의 상세에서 진행하세요." : "탐색을 요청하면 연결된 실행 PC의 Codex가 SNS 내부 검색을 시작하고 후보와 원본 근거를 순차 저장합니다." : "요청을 저장한 뒤 실행 안내를 Codex 채팅에 전달하세요. Codex가 SNS에서 직접 탐색하고 후보를 순차 저장합니다."}</p>
    <button className="btn btn-primary" disabled={pending || !hydrated || state.saved}>{pending ? "요청 중…" : state.saved ? "요청 접수됨" : automatic ? shortlist ? "발굴·추천 시작" : "탐색 시작" : "발굴 요청 저장"}</button>
    <div aria-live="polite">{state.error && <p role="alert" className="form-error">{state.error}</p>}{state.saved && <p role="status">{automatic ? "요청을 접수했습니다. 아래에서 진행 상태와 자동 평가 결과를 확인하세요." : "요청을 저장했습니다. 아래 ‘최근 실행 요청’을 열어 실행 안내를 복사해 주세요."}</p>}</div>
    {state.saved && <a className="btn" href={`/campaigns/${campaignId}${shortlist ? "" : "/discovery"}`}>다른 요청 만들기</a>}
  </form>;
}
export function RequestHandoff({ prompt }: { prompt: string }) {
  const [message, setMessage] = useState("");
  return <div className="mt-4"><label className="field">Codex 실행 안내<textarea className="input" readOnly value={prompt} rows={5} /></label><button className="btn mt-3" type="button" onClick={async () => { try { await navigator.clipboard.writeText(prompt); setMessage("복사했습니다. Codex 채팅에 붙여넣어 실행해 주세요."); } catch { setMessage("자동 복사를 사용할 수 없습니다. 위 안내문을 선택해 복사해 주세요."); } }}>실행 안내 복사</button><p role="status" className="text-xs muted mt-2">{message}</p></div>;
}
export function CancelBrowserRequest({ campaignId, requestId }: { campaignId: string; requestId: string }) {
  const [state, submit, pending] = useActionState(cancelBrowserRequestAction.bind(null, campaignId, requestId), { error: "", saved: false });
  return <form action={submit}><button className="btn mt-3" disabled={pending || state.saved}>{pending ? "취소 중…" : "요청 취소"}</button>{state.error && <p role="alert" className="form-error">{state.error}</p>}{state.saved && <p role="status">요청을 취소했습니다. 저장된 근거는 보존됩니다.</p>}</form>;
}

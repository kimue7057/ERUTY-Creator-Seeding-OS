"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CancelBrowserRequest } from "./browser-request-form";
type Snapshot = { online: boolean; requests: { id: string; platform: string; requested: number; collected: number; run_id: string | null; state: string; phase: string | null; error_code: string | null; cancellable: boolean }[] };
const states: Record<string, string> = { queued: "자동 실행 대기", starting: "Codex 시작 중", running: "SNS 탐색 중", completed: "수집 완료", partial: "일부 수집 완료", blocked: "SNS 접근 제한 · 로그인 확인", failed: "실행 실패", cancelled: "취소됨", interrupted: "실행기 연결 끊김" };
const phases: Record<string, string> = { preparing: "캠페인 조건 확인", browsing: "SNS 내부 검색·프로필 확인", saving: "원본 근거 저장", finishing: "결과 제출" };
const spendCapMessage = "Codex 워크스페이스 지출 한도에 도달했습니다. 소유자가 한도를 조정한 뒤, 저장된 인원을 제외한 나머지 인원으로 새 요청을 만들어 주세요.";
const errors: Record<string, string> = { worker_disconnected: "실행 PC의 Codex와 네트워크를 확인하세요. 기존 근거는 보존됩니다.", worker_restarted: "실행기가 재시작됐습니다. 기존 요청을 취소하고 새 요청을 만들어 주세요.", browser_unavailable: "실행 PC에서 브라우저 연결을 확인하세요.", cli_failed: "Codex 실행이 종료됐습니다. 실행 PC의 비공개 로그를 확인하세요.", execution_timeout: "실행 시간이 만료됐습니다.", result_not_submitted: "Codex가 결과 제출 없이 종료됐습니다.", stale_context: "요청 이후 캠페인 조건이 바뀌었습니다. 취소하고 새 요청을 만들어 주세요." };
export function AutomaticProgress({ campaignId, writable, compact = false }: { campaignId: string; writable: boolean; compact?: boolean }) {
  const [data, setData] = useState<Snapshot | null>(null), [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false, loading = false; const controller = new AbortController();
    const poll = async () => { if (loading) return; loading = true; try { const response = await fetch(`/api/discovery/automatic?campaign_id=${campaignId}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }); if (!response.ok) throw new Error(); const next: Snapshot = await response.json(); if (!disposed) { setData(next); setError(false); } } catch { if (!disposed) setError(true); } finally { loading = false; } };
    void poll(); const timer = setInterval(() => void poll(), 4000);
    return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, [campaignId]);
  return <div className="mt-5" aria-label="자동 발굴 진행 상황"><p role="status" className="description">{error ? "진행 상태를 불러오지 못했습니다. 연결을 다시 확인하고 있습니다." : !data ? "실행기 연결 확인 중…" : data.online ? "자동 실행기 연결됨 · 요청하면 순서대로 탐색을 시작합니다." : "자동 실행기 오프라인 · 요청은 보존되며 실행 PC가 연결되면 시작합니다."}</p>
    <p className="text-xs muted">탐색 중에는 실행 PC와 Codex 앱을 켜 두세요. 상태와 저장 인원은 4초마다 갱신됩니다.</p>
    {data?.requests.filter(job => !compact || ["queued", "starting", "running"].includes(job.state)).map(job => <div key={job.id} className="review-disclosure"><div className="flex gap-2 flex-wrap"><strong>{job.platform} · {job.collected}/{job.requested}명</strong><span>{states[job.state] ?? job.state}</span></div><p className="text-xs muted mt-2">요청 {job.id.slice(0, 8)}{job.state === "running" && job.phase ? ` · ${phases[job.phase]}` : ""}</p>{job.error_code && <p role="status" className="description">{job.error_code === "workspace_spend_cap" ? spendCapMessage : errors[job.error_code] ?? `오류: ${job.error_code}`}</p>}{!compact && job.run_id && <Link className="btn mt-3" href={`/campaigns/${campaignId}/discovery/runs/${job.run_id}`}>저장된 작업·원본 확인 →</Link>}{writable && job.cancellable && <CancelBrowserRequest campaignId={campaignId} requestId={job.id} />}</div>)}
  </div>;
}

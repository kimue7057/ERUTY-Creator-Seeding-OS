"use client";
import Link from "next/link";
import { platformLabel } from "@/lib/validation/campaigns";
import { useEffect, useState } from "react";
import { CancelBrowserRequest } from "./browser-request-form";
type Snapshot = { online: boolean; requests: { id: string; platform: string; requested: number; collected: number; run_id: string | null; state: string; phase: string | null; error_code: string | null; cancellable: boolean }[] };
const states: Record<string, string> = { queued: "자동 실행 대기", starting: "Codex 시작 중", running: "SNS 탐색 중", completed: "수집 완료", partial: "일부 수집 완료", blocked: "SNS 접근 제한 · 로그인 확인", failed: "실행 실패", cancelled: "취소됨", interrupted: "실행기 연결 끊김" };
const phases: Record<string, string> = { preparing: "캠페인 조건 확인", browsing: "SNS 내부 검색·프로필 확인", saving: "원본 근거 저장", finishing: "결과 제출" };
const spendCapMessage = "Codex 워크스페이스 지출 한도에 도달했습니다. 소유자가 한도를 조정한 뒤, 저장된 인원을 제외한 나머지 인원으로 새 요청을 만들어 주세요.";
const errors: Record<string, string> = { worker_disconnected: "실행 PC의 Codex와 네트워크를 확인하세요. 기존 근거는 보존됩니다.", worker_restarted: "실행기가 재시작됐습니다. 기존 요청을 취소하고 새 요청을 만들어 주세요.", browser_unavailable: "실행 PC에서 브라우저 연결을 확인하세요.", cli_failed: "Codex 실행이 종료됐습니다. 실행 PC의 비공개 로그를 확인하세요.", execution_timeout: "실행 시간이 만료됐습니다.", result_not_submitted: "Codex가 결과 제출 없이 종료됐습니다.", stale_context: "요청 이후 캠페인 조건이 바뀌었습니다. 취소하고 새 요청을 만들어 주세요." };
export function AutomaticProgress({ campaignId, writable, compact = false, onActiveChange }: { campaignId: string; writable: boolean; compact?: boolean; onActiveChange?: (count: number) => void }) {
  const [data, setData] = useState<Snapshot | null>(null), [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false, loading = false; const controller = new AbortController();
    const poll = async () => { if (loading) return; loading = true; try { const response = await fetch(`/api/discovery/automatic?campaign_id=${campaignId}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }); if (!response.ok) throw new Error(); const next: Snapshot = await response.json(); if (!disposed) { setData(next); setError(false); } } catch { if (!disposed) setError(true); } finally { loading = false; } };
    void poll(); const timer = setInterval(() => void poll(), 4000);
    return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, [campaignId]);
  useEffect(() => { onActiveChange?.(data?.requests.filter(job => ["queued", "starting", "running"].includes(job.state)).length ?? 0); }, [data, onActiveChange]);
  const active = data?.requests.filter(job => ["queued", "starting", "running"].includes(job.state)) ?? [];
  return <details className="automatic-connection" open={!compact} aria-label="자동 발굴 진행 상황"><summary><span className={data?.online ? "connection-dot online" : "connection-dot"} /><span>{error ? "진행 상태 연결 재시도 중" : !data ? "실행기 연결 확인 중…" : active.length ? `SNS 발굴 ${active.length}건 진행·대기 중` : data.online ? "자동 실행기 연결됨" : "자동 실행기 오프라인"}</span><span className="connection-detail">{compact ? "진행·연결 상세" : "발굴 요청 이력"}</span></summary>
    <div className="automatic-connection-body"><p role="status" className="description">{error ? "진행 상태를 불러오지 못했습니다. 연결을 다시 확인하고 있습니다." : !data ? "실행기 연결 확인 중…" : data.online ? "요청하면 순서대로 SNS 탐색을 시작합니다." : "요청은 보존되며 실행 PC가 연결되면 시작합니다."}</p><p className="description">탐색·평가 중에는 실행 PC와 Codex 앱을 켜 두세요.</p>
    {!data?.requests.length && <p className="description mt-3">아직 발굴 요청이 없습니다.</p>}
    {data?.requests.map(job => <div key={job.id} className="request-history-row"><div className="flex gap-2 flex-wrap"><strong>{platformLabel(job.platform)} · {job.collected}/{job.requested}명</strong><span className="badge">{states[job.state] ?? job.state}</span></div>{job.state === "running" && job.phase && <p className="description mt-2">{phases[job.phase]}</p>}{job.error_code && <p role="status" className="form-error mt-3">{job.error_code === "workspace_spend_cap" ? spendCapMessage : errors[job.error_code] ?? `오류: ${job.error_code}`}</p>}{job.run_id && <Link className="source-link mt-3" href={`/campaigns/${campaignId}/discovery/runs/${job.run_id}`}>작업·원본 기록 →</Link>}{writable && job.cancellable && <CancelBrowserRequest campaignId={campaignId} requestId={job.id} />}</div>)}
    {data && data.requests.length >= 30 && <p className="description mt-3">최근 요청 30건입니다. 이전 내역은 상세 발굴 기록에서 확인하세요.</p>}</div>
  </details>;
}

import { ExternalLink } from "lucide-react";
export const runLabels: Record<string, string> = { prepared: "준비됨", collecting: "기록 중", awaiting_review: "검토 대기", completed: "검토 완료", partial: "일부 확인", blocked: "접근 차단", failed: "실패 기록", cancelled: "취소됨" };
export const stateLabels: Record<string, string> = { verification_pending: "근거 검토 대기", direct_sns_verified: "원본 근거 검토 완료", blocked: "차단", duplicate: "중복" };
export const sourceLabels: Record<string, string> = { work_manual_task: "Work 보고", manual_import: "수동 입력", codex_test: "합성 테스트" };
export function SourceBadge({ source }: { source: string }) { return <span className={`badge ${source === "codex_test" ? "badge-amber" : source === "work_manual_task" ? "badge-blue" : ""}`}>{sourceLabels[source] ?? "출처 미확인"}</span>; }
export function RunBadge({ status }: { status: string }) { return <span className={`badge ${status === "completed" ? "badge-green" : status === "collecting" ? "badge-blue" : ["awaiting_review", "blocked", "failed", "partial"].includes(status) ? "badge-amber" : ""}`}>{runLabels[status] ?? "상태 미확인"}</span>; }
export function VerificationBadge({ state }: { state: string }) { return <span className={`badge ${state === "direct_sns_verified" ? "badge-green" : "badge-amber"}`}>{stateLabels[state] ?? "미확인"}</span>; }
export function Timestamp({ value }: { value: Date | string | null }) {
  if (!value) return <span className="muted">아직 없음</span>;
  const date = new Date(value);
  return <time dateTime={date.toISOString()} title={date.toISOString()}>{new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date)}</time>;
}
function safeSource(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port && ["www.instagram.com", "instagram.com", "www.tiktok.com", "tiktok.com", "www.youtube.com", "youtube.com", "youtu.be"].includes(parsed.hostname);
  } catch { return false; }
}
export function SourceLink({ url, label = "SNS 원본" }: { url: string; label?: string }) {
  if (!safeSource(url)) return <span className="muted">SNS 원본 링크 미확인</span>;
  return <a className="source-link" href={url} target="_blank" rel="noopener noreferrer">{label}<ExternalLink size={12} aria-hidden="true" /></a>;
}
export function FollowerValue({ value, precision }: { value: string | number | null; precision?: string | null }) {
  if (value === null) return <span className="muted">미확인{precision === "hidden" ? " · 비공개" : ""}</span>;
  return <span>{precision === "rounded" ? "약 " : ""}{Number(value).toLocaleString("ko-KR")}{precision === "rounded" ? " · 반올림" : ""}</span>;
}

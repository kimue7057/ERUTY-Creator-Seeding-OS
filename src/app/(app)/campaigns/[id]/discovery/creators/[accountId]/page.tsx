import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { safeId } from "@/lib/validation/projects";
import { platformLabel } from "@/lib/validation/campaigns";
import { discoveryQueries } from "@/lib/discovery/queries";
import { PageHeading, Empty } from "@/components/ui";
import { SourceBadge, VerificationBadge, Timestamp } from "@/components/discovery/display";
import { EvidenceFacts } from "@/components/discovery/evidence";
import { ReviewForm } from "@/components/discovery/review-form";
export default async function DiscoveryCreator({ params, searchParams }: { params: Promise<{ id: string; accountId: string }>; searchParams: Promise<{ offset?: string }> }) {
  const actor = await requireActor(), { id, accountId } = await params, query = await searchParams;
  if (!safeId(id) || !safeId(accountId)) notFound();
  const offset = /^\d{1,6}$/.test(query.offset ?? "") ? Math.min(100000, Number(query.offset)) : 0;
  const data = await discoveryQueries().creator(actor, id, accountId, offset); if (!data) notFound();
  const profile = data.evidence.find(row => row.evidence.kind === "profile_observation")?.evidence;
  const name = profile?.facts.identity?.display_name ?? data.account.displayName ?? data.account.currentHandle ?? "이름 미확인";
  return <><div className="mb-5 text-xs muted"><Link href={`/campaigns/${id}/discovery`}>발굴 기록</Link> / 크리에이터 근거</div>
    <PageHeading eyebrow="Source evidence archive" title={name} description={`${platformLabel(data.account.platform)} · 계정별 원본 관찰과 검토 이력입니다.`} />
    <div className="flex gap-2 items-center mb-7"><VerificationBadge state={data.link.discoveryState} /><span className="muted text-xs">동일 계정의 과거 관찰을 덮어쓰지 않습니다.</span></div>
    {process.env.EVALUATION_ENABLED==="true"&&<Link className="btn mb-5" href={process.env.CODEX_DISCOVERY_ENABLED === "true" && process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED === "true" ? `/campaigns/${id}?tab=recommended&filter=all&candidate=${accountId}` : `/evaluations/${id}/${accountId}`}>캠페인에서 후보 검토 · 최종 선정 →</Link>}
    {!canWrite(actor) && <p className="info-banner">현재 계정은 조회 전용입니다. 근거 검토는 관리자·캠페인 매니저가 수행합니다.</p>}
    {data.evidence.length ? <div className="stack">{data.evidence.map(({ evidence, source, runStatus, briefVersion }) => <article className="surface panel-body evidence-card" key={evidence.id}>
      <header className="evidence-card-heading"><div><h2>{evidence.kind === "profile_observation" ? "프로필 관찰" : "게시물 관찰"}</h2><div className="flex gap-2 mt-3"><SourceBadge source={source} /><span className="badge">브리프 v{briefVersion}</span></div></div><Link className="btn" href={`/campaigns/${id}/discovery/runs/${evidence.runId}`}>작업 기록 →</Link></header>
      <EvidenceFacts row={evidence} />
      <section className="evidence-reviews" aria-label="근거 검토 이력"><h3>검토 이력</h3>{data.reviews.filter(review => review.evidenceId === evidence.id).map(review => <div className="review-record" key={review.id}><span className="badge">{review.verdict === "accepted" ? "근거 수락" : review.verdict === "rejected" ? "반려" : "추가 확인"}</span><span className="text-xs muted"><Timestamp value={review.createdAt} /></span><p className="body-copy">{review.reason}</p></div>)}{!data.reviews.some(review => review.evidenceId === evidence.id) && <p className="description">검토 기록이 없습니다.</p>}</section>
      {canWrite(actor) && ["collecting", "awaiting_review"].includes(runStatus) ? <details className="review-disclosure"><summary>이 근거 검토하기</summary><ReviewForm kind="evidence" campaignId={id} accountId={accountId} evidenceId={evidence.id} /></details> : ["collecting", "awaiting_review"].includes(runStatus) ? null : <p className="description mt-4">종료된 작업의 근거입니다. 정정이 필요하면 새로운 작업에서 관찰을 추가하세요.</p>}
    </article>)}</div> : <Empty title="이 페이지에 근거가 없습니다" text="이전 근거 페이지를 확인해 주세요." />}
    <nav aria-label="근거 페이지" className="discovery-pagination">{offset > 0 && <Link className="btn" href={`?offset=${Math.max(0, offset - 25)}`}>이전 근거</Link>}{data.nextOffset !== null && <Link className="btn" href={`?offset=${data.nextOffset}`}>다음 근거</Link>}</nav>
  </>;
}

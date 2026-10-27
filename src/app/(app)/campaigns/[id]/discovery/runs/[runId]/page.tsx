import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { safeId } from "@/lib/validation/projects";
import { platformLabel } from "@/lib/validation/campaigns";
import { DiscoveryError } from "@/lib/discovery/contracts";
import { discoveryService } from "@/lib/discovery/service";
import { discoveryStaff } from "@/lib/discovery/staff";
import { PageHeading, Empty } from "@/components/ui";
import { RunBadge, SourceBadge, SourceLink, Timestamp } from "@/components/discovery/display";
import { EvidenceFacts } from "@/components/discovery/evidence";
import { ReviewForm } from "@/components/discovery/review-form";
export default async function DiscoveryRun({ params, searchParams }: { params: Promise<{ id: string; runId: string }>; searchParams: Promise<{ cursor?: string; evidence?: string }> }) {
  const actor = await requireActor(), { id, runId } = await params, query = await searchParams;
  if (!safeId(id) || !safeId(runId)) notFound();
  const number = (raw?: string) => /^\d{1,6}$/.test(raw ?? "") ? Math.min(Number(raw), 100000) : 0;
  const cursor = number(query.cursor), evidenceCursor = number(query.evidence);
  const data = await discoveryService().getRun(discoveryStaff(actor), { contract_version: 1, run_id: runId, cursor, evidence_cursor: evidenceCursor }).catch(error => { if (error instanceof DiscoveryError && error.status === 404) notFound(); throw error; });
  if (data.campaign_id !== id) notFound();
  return <><div className="mb-5 text-xs muted"><Link href={`/campaigns/${id}/discovery`}>발굴 기록</Link> / 작업 {runId.slice(0, 8)}</div>
    <PageHeading eyebrow="Step 03 · Discovery run" title={`${platformLabel(data.platform)} 발굴 작업`} description="실제로 저장된 상태와 원본 탐색 경로입니다. 작업 제출과 사람의 검토 완료는 구분됩니다." />
    <div className="flex gap-2 mb-7"><RunBadge status={data.status} /><SourceBadge source={data.execution_source} /><span className="badge">브리프 v{data.brief_version}</span></div>
    {data.execution_source === "codex_browser" && <section className="surface panel-body mb-7" aria-label="브라우저 실행 근거"><h2>브라우저 실행 근거</h2><p className="description">{data.browser_execution_accepted ? "실행 경로 검토 완료 · 각 프로필·게시물 근거도 수락돼야 평가·승인이 가능합니다." : "실제 SNS 검색과 브라우저 캡처·원본 확인이 필요합니다. 근거별 검토와 별도로 기록합니다."}</p>{data.browser_reviews.map(row => <div className="review-record" key={row.id}><span className="badge">{row.verdict === "accepted" ? "실행 근거 수락" : row.verdict === "rejected" ? "실행 근거 반려" : "추가 확인 필요"}</span> <Timestamp value={row.createdAt} /><p>{row.reason}</p></div>)}{data.status === "awaiting_review" && canWrite(actor) && <details className="review-disclosure"><summary>브라우저 실행 검토하기</summary><ReviewForm kind="browser" campaignId={id} runId={runId} version={data.lock_version} /></details>}</section>}
    {data.environment.initial_validation && <div role="status" className="info-banner mb-7">초기 실증 작업입니다. 이 환경의 Work 연결·원본 탐색은 아직 검증되지 않았으며, 관찰 근거를 검토해도 자동으로 검증 완료가 되지 않습니다.</div>}
    <div className="detail-grid"><section className="surface panel-body"><h2 className="mb-5">작업 정보</h2><dl className="metadata"><dt>고유 계정 / 요청</dt><dd>{data.counts.discovered} / {data.requested_count}명</dd><dt>검토된 직접 계정</dt><dd>{data.counts.verified}명</dd><dt>실패 / 중복 관찰</dt><dd>{data.counts.failures} / {data.counts.duplicate_observations}건</dd><dt>생성</dt><dd><Timestamp value={data.created_at} /></dd><dt>기록 시작</dt><dd><Timestamp value={data.started_at} /></dd><dt>제출</dt><dd><Timestamp value={data.submitted_at} /></dd><dt>종료</dt><dd><Timestamp value={data.ended_at} /></dd></dl></section>
      <section className="surface panel-body"><h2 className="mb-5">고정 타겟팅</h2><dl className="metadata"><dt>대상 국가</dt><dd>{data.targeting_snapshot.countryCodes.join(", ")}</dd><dt>카테고리</dt><dd>{data.targeting_snapshot.categories.join(", ")}</dd><dt>팔로워 범위</dt><dd>{data.targeting_snapshot.followerMin.toLocaleString()}–{data.targeting_snapshot.followerMax.toLocaleString()}</dd><dt>추가 · 제외 조건</dt><dd className="whitespace-pre-wrap">{data.targeting_snapshot.notes || "없음"}<br />{data.targeting_snapshot.exclusions || "없음"}</dd></dl><details className="evidence-technical"><summary>작업 해시 · ID</summary><dl><dt>Run ID</dt><dd>{data.run_id}</dd><dt>Context SHA-256</dt><dd>{data.context_sha256}</dd><dt>Targeting SHA-256</dt><dd>{data.targeting_sha256}</dd></dl></details></section></div>
    {data.limitations.length > 0 && <div className="info-banner"><div><strong>작업 제약</strong><ul>{data.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul></div></div>}
    <div className="section-heading"><h2>검색 경로 · 실패 기록</h2><span className="muted text-xs">순서별 · 페이지당 25건</span></div>
    <section className="surface">{data.logs.length ? <ol className="discovery-timeline">{data.logs.map(log => <li key={log.id}><div className="timeline-sequence">{log.sequence}</div><div className="timeline-body"><div className="flex gap-2 flex-wrap items-center"><strong>{log.eventType}</strong><span className={`badge ${["blocked", "failed"].includes(log.outcome) ? "badge-amber" : ""}`}>{log.outcome}</span>{log.failureCode && <span className="badge badge-amber">{log.failureCode}</span>}<span className="muted text-xs ml-auto"><Timestamp value={log.occurredAt} /></span></div>{log.query && <p className="body-copy mt-3">검색어: {log.query}</p>}<p className="body-copy mt-2">{log.message}</p>{log.sourceUrl && <div className="mt-3"><SourceLink url={log.sourceUrl} /></div>}<details className="evidence-technical"><summary>경로 연결 정보</summary><p>Log ID: {log.id}<br />상위 로그: {log.parentLogId ?? "없음"}</p></details></div></li>)}</ol> : <Empty title="이 페이지에 탐색 로그가 없습니다" text="준비 상태는 Work 실행을 의미하지 않습니다." />}
      {(cursor > 0 || data.next_cursor !== null) && <nav aria-label="로그 페이지" className="discovery-pagination">{cursor > 0 && <Link className="btn" href={`?cursor=0&evidence=${evidenceCursor}`}>처음 로그</Link>}{data.next_cursor !== null && <Link className="btn" href={`?cursor=${data.next_cursor}&evidence=${evidenceCursor}`}>다음 로그</Link>}</nav>}
    </section>
    <div className="section-heading"><h2>관찰 근거</h2><span className="muted text-xs">프로필·게시물 구분</span></div>
    {data.evidence.length ? <div className="stack">{data.evidence.map(row => <article className="surface panel-body" key={row.id}><div className="evidence-card-heading"><h3>{row.kind === "profile_observation" ? "프로필 관찰" : "게시물 관찰"}</h3><Link className="source-link" href={`/campaigns/${id}/discovery/creators/${row.creatorAccountId}`}>계정 상세 · 근거 검토 →</Link></div><EvidenceFacts row={row} /></article>)}</div> : <section className="surface"><Empty title="이 페이지에 관찰 근거가 없습니다" text="실패한 탐색은 빈 크리에이터 대신 실패 로그로 남습니다." /></section>}
    {(evidenceCursor > 0 || data.next_evidence_cursor !== null) && <nav aria-label="작업 근거 페이지" className="discovery-pagination">{evidenceCursor > 0 && <Link className="btn" href={`?cursor=${cursor}&evidence=0`}>처음 근거</Link>}{data.next_evidence_cursor !== null && <Link className="btn" href={`?cursor=${cursor}&evidence=${data.next_evidence_cursor}`}>다음 근거</Link>}</nav>}
    {data.status === "awaiting_review" && <section className="surface panel-body mt-7"><h2 className="mb-4">작업 결과 검토</h2>{canWrite(actor) ? <ReviewForm kind="run" campaignId={id} runId={runId} version={data.lock_version} /> : <p className="description">현재 계정은 조회 전용입니다. 관리자·캠페인 매니저가 검토할 수 있습니다.</p>}</section>}
  </>;
}

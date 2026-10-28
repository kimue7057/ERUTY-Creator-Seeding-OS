import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { ScanSearch, ShieldCheck, FileSearch, Copy, CircleAlert } from "lucide-react";
import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { discoveryService } from "@/lib/discovery/service";
import { discoveryStaff } from "@/lib/discovery/staff";
import { browserRequestService, browserRequestPrompt } from "@/lib/discovery/browser-requests";
import { BrowserRequestForm, RequestHandoff, CancelBrowserRequest } from "@/components/discovery/browser-request-form";
import { AutomaticProgress } from "@/components/discovery/automatic-progress";
import { safeId } from "@/lib/validation/projects";
import { discoveryQueries, discoveryFilters, type DiscoveryFilters } from "@/lib/discovery/queries";
import { DISCOVERY_PLATFORMS } from "@/lib/db/discovery-schema";
import { PLATFORMS, platformLabel } from "@/lib/validation/campaigns";
import { PageHeading, Empty } from "@/components/ui";
import { SourceBadge, RunBadge, VerificationBadge, FollowerValue, SourceLink, Timestamp, stateLabels, sourceLabels } from "@/components/discovery/display";

export default async function CampaignDiscovery({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor(), { id } = await params; if (!safeId(id)) notFound();
  const query = await searchParams;
  const input = Object.fromEntries(["platform", "category", "state", "source", "min", "max", "page"].map(key => [key, typeof query[key] === "string" && query[key] !== "" ? query[key] : undefined]));
  const parsed = discoveryFilters.safeParse(input), filters: DiscoveryFilters = parsed.success ? parsed.data : { page: 1 };
  const data = await discoveryQueries().dashboard(actor, id, filters); if (!data) notFound();
  const { campaign, counts } = data;
  const enabled = process.env.CODEX_DISCOVERY_ENABLED === "true";
  const automatic = enabled && process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED === "true";
  const [browserRequests, currentContext] = await Promise.all([browserRequestService().list(actor, id), enabled && canWrite(actor) ? discoveryService().getContext(discoveryStaff(actor), { contract_version: 1, campaign_id: id }) : null]);
  const currentEnvironment = /^[a-f0-9]{64}$/.test(process.env.DISCOVERY_CURRENT_ENVIRONMENT_SHA256 ?? "") ? process.env.DISCOVERY_CURRENT_ENVIRONMENT_SHA256 : null;
  const pageUrl = (page: number) => { const search = new URLSearchParams(); for (const [key, value] of Object.entries({ ...filters, page })) if (value !== undefined) search.set(key, String(value)); return `/campaigns/${id}/discovery?${search}`; };
  return <><div className="mb-5 text-xs muted"><Link href="/campaigns">캠페인</Link> / <Link href={`/campaigns/${id}`}>{campaign.title}</Link> / 발굴 기록</div>
    <PageHeading eyebrow="Step 03 · Campaign discovery" title={campaign.title} description="저장된 작업과 크리에이터 원본 근거를 확인하고 검토하세요." />
    <div className="flex gap-2 flex-wrap mb-7"><span className="badge">기록 조회</span><span className="badge badge-blue">브리프 v{campaign.briefVersion}</span><span className="description ml-auto">Work 보고 {counts.work_runs}개 · Codex 직접 탐색 {counts.codex_runs}개 · 합성 작업 {counts.synthetic_runs}개</span></div>
    <section className="surface panel-body mb-7" aria-label="Codex 직접 발굴 요청"><h2>Codex 직접 발굴</h2>
      {currentContext && campaign.status !== "archived" ? <BrowserRequestForm automatic={automatic} campaignId={id} contextHash={currentContext.context_sha256} platforms={PLATFORMS.filter(p => campaign.platforms.includes(p.value))} goal={campaign.goalCount} requestKey={randomUUID()} /> : <p className="description">{!canWrite(actor) ? "현재 계정은 발굴 요청을 조회할 수 있습니다." : campaign.status === "archived" ? "보관된 캠페인은 새 탐색을 요청할 수 없습니다." : "직접 발굴 실행 설정이 준비되지 않았습니다."}</p>}
      {automatic && <AutomaticProgress campaignId={id} writable={canWrite(actor)} />}
      {!automatic && browserRequests.length > 0 && <div className="mt-6"><h3>최근 실행 요청</h3>{browserRequests.map(({ request: job, run, collected }) => <details className="review-disclosure" key={job.id}><summary>{platformLabel(job.platform)} · {collected}/{job.requestedCount}명 · {job.state === "cancelled" ? "취소됨" : run ? ({ prepared: "실행 준비", collecting: "수집 중", awaiting_review: "검토 대기", completed: "검토 완료", partial: "일부 확인", blocked: "접근 차단", failed: "실패", cancelled: "취소됨" })[run.status] : job.state === "queued" ? "Codex 전달 대기" : "실행 준비"}</summary>
        <p className="description">요청 {job.id.slice(0, 8)} · <Timestamp value={job.createdAt} /></p>{job.expiresAt && job.expiresAt < new Date() && !run?.submittedAt && job.state !== "cancelled" && <p role="status" className="description">실행 기한이 만료됐습니다. 기존 요청을 취소하고 새 요청으로 진행해 주세요.</p>}
        {run && <Link className="btn mt-3" href={`/campaigns/${id}/discovery/runs/${run.id}`}>작업·근거 확인 →</Link>}
        {canWrite(actor) && job.state !== "cancelled" && (!run || ["prepared", "collecting"].includes(run.status)) && <><RequestHandoff prompt={browserRequestPrompt(job.id)} /><CancelBrowserRequest campaignId={id} requestId={job.id} /></>}
      </details>)}</div>}
    </section>
    <div className="stats-grid">{[{ title: "기록된 계정", value: counts.total, note: "캠페인 내 중복 제거", Icon: FileSearch }, { title: "원본 근거 검토 완료", value: counts.verified, note: "실행 경로·프로필·콘텐츠 검토", Icon: ShieldCheck }, { title: "접근·검색 실패 기록", value: counts.failures, note: "로그인·차단·미확인 사유 보존", Icon: CircleAlert }, { title: "중복 관찰", value: counts.duplicates, note: "동일 계정의 추가 관찰", Icon: Copy }].map(({ title, value, note, Icon }) => <section key={title} className="stat-card"><div className="stat-title">{title}<Icon size={15} aria-hidden="true" /></div><div className="stat-value">{value.toLocaleString("ko-KR")}</div><div className="stat-note">{note}</div></section>)}</div>
    <section aria-label="플랫폼별 Work 실증" className="platform-checks">{DISCOVERY_PLATFORMS.map(platform => {
      const rows = data.capabilities.filter(row => row.platform === platform && row.environment === currentEnvironment), native = rows.find(row => row.kind === "sns_native_search"), mcp = rows.find(row => row.kind === "work_mcp_write");
      const verified = native?.verdict === "verified" && mcp?.verdict === "verified" && native.facts.native_search && native.facts.direct_profiles >= 5 && native.facts.recent_content_profiles >= 5;
      const blocked = native?.verdict === "blocked" || mcp?.verdict === "blocked";
      const initial = rows.some(row => row.kind === "initial_validation");
      const label = verified ? "5명 실증 검토" : blocked ? "제한 기록 있음" : native ? "일부 실증 기록" : initial ? "초기 실증 · 환경 미검증" : data.capabilities.some(row => row.platform === platform) ? "환경 재확인 필요" : "실증 미검증";
      return <div className="platform-check" key={platform}><span className="font-semibold">{platformLabel(platform)}</span><span className={`badge ${verified ? "badge-green" : "badge-amber"}`}>{label}</span></div>;
    })}</section>
    <div className="info-banner discovery-notice"><ScanSearch size={19} aria-hidden="true" /><div>합성 테스트와 수동 입력은 Work 직접 발굴 완료에 포함하지 않습니다. 플랫폼별 검색 안정성은 해당 환경에서 수행한 실증 기록으로 확인합니다.</div></div>
    <div className="section-heading"><h2>크리에이터 <span className="muted text-xs font-normal ml-2">필터 결과 {data.totalFiltered}명</span></h2><Link className="text-xs muted" href={`/campaigns/${id}`}>캠페인 브리프 →</Link></div>
    <section className="surface"><form key={JSON.stringify(filters)} className="discovery-filters" aria-label="크리에이터 필터">
      <label className="field">플랫폼<select aria-label="플랫폼" name="platform" className="input" defaultValue={filters.platform ?? ""}><option value="">전체 플랫폼</option>{PLATFORMS.map(p => <option value={p.value} key={p.value}>{p.label}</option>)}</select></label>
      <label className="field">카테고리<input name="category" className="input" maxLength={100} placeholder="카테고리명" defaultValue={filters.category ?? ""} /></label>
      <label className="field">최소 팔로워<input name="min" type="number" min={0} max={Number.MAX_SAFE_INTEGER} className="input" defaultValue={filters.min ?? ""} /></label>
      <label className="field">최대 팔로워<input name="max" type="number" min={0} max={Number.MAX_SAFE_INTEGER} className="input" defaultValue={filters.max ?? ""} /></label>
      <label className="field">검증 상태<select aria-label="검증 상태" name="state" className="input" defaultValue={filters.state ?? ""}><option value="">전체 상태</option>{Object.entries(stateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field">기록 출처<select aria-label="기록 출처" name="source" className="input" defaultValue={filters.source ?? ""}><option value="">전체 출처</option>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="flex gap-2 items-end"><button className="btn btn-primary" type="submit">필터 적용</button><Link className="btn" href={`/campaigns/${id}/discovery`}>초기화</Link></div>
      <p className="field-full text-xs muted">팔로워 범위는 확인된 정확 수치에 적용합니다. 반올림·비공개·미확인 계정은 범위를 비우면 표시됩니다.</p>
    </form>{!parsed.success && <p role="alert" className="form-error mx-5">필터 값을 확인해 주세요. 최소·최대 팔로워와 허용된 조건을 다시 선택해 주세요.</p>}
      {data.creators.length ? <div className="table-scroll"><table aria-label="크리에이터 목록"><thead><tr><th>크리에이터</th><th>팔로워 · 구독자</th><th>카테고리 · 국가</th><th>근거 상태</th><th>확인 시각 · 원본</th></tr></thead><tbody>{data.creators.map(c => <tr key={c.campaign_creator_id}><td><Link className="creator-name" href={`/campaigns/${id}/discovery/creators/${c.account_id}`}>{c.facts.identity?.display_name ?? c.display_name ?? c.facts.identity?.handle ?? c.handle ?? "이름 미확인"}</Link><div className="text-xs muted mt-2">{platformLabel(c.platform)} · @{c.facts.identity?.handle ?? c.handle ?? "미확인"}</div><div className="mt-2"><SourceBadge source={c.execution_source} /></div></td><td><FollowerValue value={c.followers} precision={c.follower_precision} /><div className="text-[10px] muted mt-2">타겟 범위 {c.facts.targeting?.followers === "match" ? "부합" : c.facts.targeting?.followers === "outside" ? "벗어남" : "미확인"}</div></td><td>{c.facts.categories?.join(", ") || "카테고리 미확인"}<div className="text-xs muted mt-2">{c.facts.country?.code ?? "국가 미확인"} · 시청자 국가 미확인</div></td><td><VerificationBadge state={c.state} /></td><td className="text-xs"><Timestamp value={c.observed_at} /><div className="mt-3"><SourceLink url={c.profile_url} label="프로필 원본" /></div></td></tr>)}</tbody></table></div> : <Empty title={counts.total ? "조건에 맞는 계정이 없습니다" : "아직 저장된 크리에이터가 없습니다"} text={counts.total ? "필터 범위를 조정하거나 초기화해 주세요." : "Codex 또는 연결된 Work에서 SNS를 직접 탐색해 저장한 근거가 표시됩니다."} />}
      {(filters.page > 1 || filters.page * data.pageSize < data.totalFiltered) && <nav aria-label="크리에이터 페이지" className="discovery-pagination">{filters.page > 1 && <Link className="btn" href={pageUrl(filters.page - 1)}>이전 페이지</Link>}<span className="muted text-xs">{filters.page} 페이지</span>{filters.page * data.pageSize < data.totalFiltered && <Link className="btn" href={pageUrl(filters.page + 1)}>다음 페이지</Link>}</nav>}
    </section>
    <div className="section-heading"><h2>발굴 작업 이력</h2><span className="text-xs muted">최근 25개 · 저장 상태 기준</span></div>
    <section className="surface">{data.runs.length ? <div className="table-scroll"><table aria-label="발굴 작업 이력"><thead><tr><th>작업 · 플랫폼</th><th>상태</th><th>기록 / 요청</th><th>실패</th><th>생성 시각</th></tr></thead><tbody>{data.runs.map(({ run, discovered, failures }) => <tr key={run.id}><td><Link className="creator-name" href={`/campaigns/${id}/discovery/runs/${run.id}`}>{platformLabel(run.platform)} · {run.id.slice(0, 8)}</Link><div className="mt-2"><SourceBadge source={run.executionSource} /></div></td><td><RunBadge status={run.status} /></td><td>{discovered} / {run.requestedCount}명</td><td>{failures}건</td><td><Timestamp value={run.createdAt} /></td></tr>)}</tbody></table></div> : <Empty title="저장된 발굴 작업이 없습니다" text="작업 준비는 Work 시작과 별개입니다. 실제로 저장된 run만 이력에 표시됩니다." />}</section>
  </>;
}

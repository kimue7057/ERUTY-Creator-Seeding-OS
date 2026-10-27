import { SourceLink, Timestamp, FollowerValue } from "./display";
import type { discoveryEvidence } from "@/lib/db/discovery-schema";
const metricLabels = { followers: "팔로워", subscribers: "구독자", views: "조회", likes: "좋아요", comments: "댓글" };
export function EvidenceFacts({ row }: { row: typeof discoveryEvidence.$inferSelect }) {
  return <><div className="evidence-meta"><SourceLink url={row.sourceUrl} label={row.kind === "profile_observation" ? "프로필 원본" : "게시물 원본"} /><span>확인 <Timestamp value={row.observedAt} /></span><span>저장 <Timestamp value={row.recordedAt} /></span></div>
    <dl className="metadata evidence-details"><dt>직접 열람 주장</dt><dd>{row.facts.opened_directly ? "직접 열람 보고" : "직접 열람 미확인"} · {row.observationMethod}</dd>{row.facts.identity && <><dt>관찰한 계정</dt><dd>{row.facts.identity.display_name ?? "이름 미확인"} · @{row.facts.identity.handle ?? "미확인"}</dd></>}
      {row.kind === "profile_observation" && <><dt>국가 · 카테고리</dt><dd>{row.facts.country?.code ?? "국가 미확인"} · {row.facts.categories?.join(", ") || "분류 미확인"}<div className="muted text-xs mt-2">{row.facts.country?.basis} · 시청자 국가는 미확인</div></dd></>}
      {row.kind === "content_observation" && <><dt>게시 시각</dt><dd><Timestamp value={row.publishedAt} /></dd><dt>최근 콘텐츠 근거</dt><dd>{row.facts.recent_basis || "미확인"}</dd></>}
      <dt>관찰 내용</dt><dd className="whitespace-pre-wrap">{row.facts.note || "내용 미등록"}</dd>
    </dl>
    {row.facts.metrics.length ? <div className="evidence-metrics">{row.facts.metrics.map(metric => <div key={metric.name}><span className="muted text-xs">{metricLabels[metric.name]}</span><strong><FollowerValue value={metric.value} precision={metric.precision} /></strong><span className="text-xs muted">표시 원문: {metric.raw_display ?? "확인 불가"}</span><span className="text-[10px] muted"><Timestamp value={metric.observed_at} /></span><SourceLink url={metric.source_url} label="지표 출처" /></div>)}</div> : <p className="description">공개 지표 미확인</p>}
    {row.limitations.length > 0 && <div className="evidence-limitations"><strong>확인 제약</strong><ul>{row.limitations.map((text, i) => <li key={i}>{text}</li>)}</ul></div>}
    {row.browserTraceReference && /^\/api\/discovery\/browser\/captures\/[a-f0-9-]{36}$/.test(row.browserTraceReference) && <a className="source-link" href={row.browserTraceReference} target="_blank" rel="noreferrer">검색·프로필·콘텐츠 원본 캡처 확인 →</a>}
    <details className="evidence-technical"><summary>근거 식별 정보</summary><dl><dt>Evidence ID</dt><dd>{row.id}</dd><dt>Payload SHA-256</dt><dd>{row.payloadSha256}</dd><dt>이전 근거 정정</dt><dd>{row.supersedesId ?? "없음"}</dd></dl></details>
  </>;
}

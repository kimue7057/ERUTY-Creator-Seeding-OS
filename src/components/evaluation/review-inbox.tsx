"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { candidateGroup, candidateName, campaignHref, type Candidate } from "@/lib/evaluation/presentation";
import { PLATFORMS } from "@/lib/validation/campaigns";
import { ChannelFilter } from "./channel-filter";
import { CreatorLinks } from "./creator-links";

type Row = { candidate: Candidate; campaign: { campaign_id: string; campaign_title: string } };
export function ReviewInbox({ rows }: { rows: Row[] }) {
  const params = useSearchParams(), platform = PLATFORMS.some(p => p.value === params.get("platform")) ? params.get("platform")! : "";
  const visible = rows.filter(row => !platform || row.candidate.platform === platform);
  return <>
    <ChannelFilter candidates={rows.map(row => row.candidate)} value={platform} onChange={value => {
      const url = new URL(window.location.href); if (value) url.searchParams.set("platform", value); else url.searchParams.delete("platform");
      window.history.pushState(null, "", `${url.pathname}${url.search}`);
    }} />
    <p className="description mb-4">현재 채널의 검토 대기 {visible.length}명 · SNS는 새 탭으로 열립니다.</p>
    <div className="inbox-list">{visible.map(({ candidate: c, campaign }) => <article className="surface inbox-row" key={`${campaign.campaign_id}/${c.id}`}>
      <div><Link className="inbox-primary" href={`${campaignHref(campaign.campaign_id, "recommended", c.id)}${platform ? `&platform=${platform}` : ""}`}><p className="description">{campaign.campaign_title}</p><h2>{candidateName(c)} <span className="badge">{candidateGroup(c) === "recommended" ? "AI 추천" : "정보 부족 · 직접 판정"}</span></h2><p className="inbox-reason">{c.evaluation?.output.summary}</p></Link><CreatorLinks candidate={c} compact /></div>
      <Link className="btn" href={`${campaignHref(campaign.campaign_id, "recommended", c.id)}${platform ? `&platform=${platform}` : ""}`}>검토·선정 →</Link>
    </article>)}</div>
    {!visible.length && <div className="surface workspace-empty"><h3>이 채널에 검토 대기 후보가 없습니다</h3><p className="description">다른 채널을 선택하거나 캠페인에서 발굴 진행 상황을 확인하세요.</p></div>}
  </>;
}

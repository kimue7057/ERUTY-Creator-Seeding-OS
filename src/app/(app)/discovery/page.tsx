import Link from "next/link";
import { ScanSearch, ArrowUpRight } from "lucide-react";
import { requireActor } from "@/lib/auth/session";
import { discoveryQueries } from "@/lib/discovery/queries";
import { PageHeading, Empty } from "@/components/ui";
import { platformLabel } from "@/lib/validation/campaigns";
export default async function DiscoveryIndex() {
  const actor = await requireActor();
  const campaigns = await discoveryQueries().campaigns(actor);
  return <><PageHeading eyebrow="Discovery archive" title="크리에이터 발굴 기록" description="캠페인별 탐색 과정과 원본 근거, 검토 상태를 확인하세요." />
    <div className="info-banner discovery-notice"><ScanSearch size={20} aria-hidden="true" /><div><strong>캠페인을 선택해 저장된 기록을 확인하세요.</strong><br />새 발굴 요청과 추천 후보 선정은 캠페인에서 진행합니다. 이곳에서는 저장된 원본과 과거 검토 이력을 확인할 수 있습니다.</div></div>
    {campaigns.length ? <div className="project-grid mt-7">{campaigns.map(c => <Link href={`/campaigns/${c.id}?tab=history`} key={c.id} className="project-card"><div className="eyebrow mb-4">{c.projectName}</div><h2>{c.title}</h2><div className="flex gap-2 flex-wrap mt-4">{c.platforms.map(platform => <span className="badge" key={platform}>{platformLabel(platform)}</span>)}</div><div className="card-footer"><span>작업 {c.runCount}개 · 계정 {c.creatorCount}명</span><ArrowUpRight size={15} aria-hidden="true" /></div></Link>)}</div> : <section className="surface mt-7"><Empty title="먼저 캠페인을 준비하세요" text="프로젝트와 제품, 대상 국가·플랫폼을 정하면 캠페인별 발굴 기록을 관리할 수 있습니다." href="/campaigns/new" label="캠페인 만들기" /></section>}
  </>;
}

import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { listCampaigns } from "@/lib/campaigns/service";
import { workspaceBoards } from "@/lib/evaluation/workspace";
import { isReviewPending } from "@/lib/evaluation/presentation";
import { ReviewInbox } from "@/components/evaluation/review-inbox";
import { PageHeading, Empty } from "@/components/ui";
export default async function Evaluations() {
  const actor = await requireActor();
  if (process.env.EVALUATION_ENABLED !== "true") return <Empty title="평가 기능 준비 중" text="운영 설정이 완료되면 추천 후보를 확인할 수 있습니다." />;
  const campaigns = await listCampaigns(actor);
  const boards = await workspaceBoards(actor, campaigns.filter(c => c.campaign.status !== "archived").map(c => c.campaign.id));
  const rows = boards.flatMap(board => board.candidates.filter(c => isReviewPending(c)).map(candidate => ({ candidate, campaign: board })));
  return <><PageHeading eyebrow="Review inbox" title="검토함" description="AI 추천과 정보 부족 후보를 확인하고 사람이 최종 선정·보류·제외를 결정합니다." />
    <div className="section-heading"><h2>검토 대기 · {rows.length}명</h2><Link className="source-link" href="/campaigns">캠페인 전체 보기 →</Link></div>
    {rows.length ? <ReviewInbox rows={rows.map(row => ({ candidate: row.candidate, campaign: { campaign_id: row.campaign.campaign_id, campaign_title: row.campaign.campaign_title } }))} /> : <section className="surface"><Empty title="지금 검토 대기 중인 후보가 없습니다" text="자동 평가가 완료되면 AI 추천·정보 부족 후보가 이곳에 모입니다. 평가 진행 상황은 해당 캠페인에서 확인하세요." href="/campaigns" label="캠페인 확인" /></section>}
    <p className="description mt-5">최근 캠페인 최대 100개 · 캠페인별 최대 200명 기준입니다. 보관된 캠페인은 제외합니다.</p></>;
}

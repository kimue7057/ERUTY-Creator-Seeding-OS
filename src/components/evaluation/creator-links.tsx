import { SourceLink } from "@/components/discovery/display";
import { platformLabel } from "@/lib/validation/campaigns";
import { candidateContent, type Candidate } from "@/lib/evaluation/presentation";

export function CreatorLinks({ candidate, compact = false }: { candidate: Candidate; compact?: boolean }) {
  const contents = candidateContent(candidate);
  return <div className={`creator-links ${compact ? "creator-links-compact" : ""}`} aria-label={`${candidate.name || candidate.handle} SNS 바로가기`}>
    <SourceLink url={candidate.url} label={`${platformLabel(candidate.platform)} ${candidate.platform === "youtube" ? "채널" : "프로필"}`} />
    {contents.slice(0, compact ? 1 : 3).map((e, i) => <SourceLink key={e.id} url={e.url} label={compact ? "콘텐츠 보기" : `콘텐츠 ${i + 1}`} />)}
    {!compact && <span className="description">새 탭에서 열립니다</span>}
  </div>;
}

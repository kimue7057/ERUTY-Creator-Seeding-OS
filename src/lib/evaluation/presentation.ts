import type { ShortlistBoard } from "./shortlist";

export type Candidate = ShortlistBoard["candidates"][number];
export const GROUPS = {
  recommended: "검토할 추천", selected: "최종 선정", hold: "보류",
  needs_info: "정보 부족", excluded: "추천 제외", processing: "평가 중", interrupted: "평가 중단", unassessed: "평가 필요",
} as const;
export type CandidateGroup = keyof typeof GROUPS;
export function candidateGroup(c: Pick<Candidate, "state" | "verdict" | "recommendation">): CandidateGroup {
  if (["queued", "running"].includes(c.state)) return "processing";
  if (["failed", "cancelled"].includes(c.state)) return "interrupted";
  if (["unassessed", "stale"].includes(c.state)) return "unassessed";
  if (c.verdict === "approved") return "selected";
  if (c.verdict === "rejected") return "excluded";
  if (c.verdict === "hold") return "hold";
  if (c.recommendation === "recommended") return "recommended";
  return c.recommendation === "excluded" ? "excluded" : "needs_info";
}
export function shortlistCounts(candidates: Pick<Candidate, "state" | "verdict" | "recommendation">[]) {
  const counts = { discovered: candidates.length, evaluated: 0, recommended: 0, selected: 0, hold: 0, needs_info: 0, excluded: 0, processing: 0, interrupted: 0, unassessed: 0 };
  for (const candidate of candidates) {
    counts[candidateGroup(candidate)]++;
    if (candidate.state === "completed") counts.evaluated++;
  }
  return counts;
}
export type ShortlistCounts = ReturnType<typeof shortlistCounts>;
export function candidateLabel(c: Candidate) {
  return c.state === "queued" ? "평가 대기" : c.state === "running" ? "자동 평가 중" : c.state === "stale" ? "조건 변경 · 재평가 필요" : GROUPS[candidateGroup(c)];
}
export function candidateName(c: Candidate) { return c.name || c.handle || "이름 미확인"; }
export function candidateProfile(c: Candidate) {
  const profile = c.evidence.filter(e => e.kind === "profile_observation").sort((a,b) => b.observed_at.localeCompare(a.observed_at))[0];
  return { country: profile?.facts.country?.code, follower: profile?.facts.metrics.find(m => m.name === (c.platform === "youtube" ? "subscribers" : "followers")) };
}
export function campaignHref(campaignId: string, tab = "recommended", candidateId?: string) {
  const params = new URLSearchParams({ tab });
  if (candidateId) params.set("candidate", candidateId);
  return `/campaigns/${campaignId}?${params}`;
}

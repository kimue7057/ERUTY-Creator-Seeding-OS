import { LABELS, RUBRIC } from "@/lib/evaluation/contracts";
import type { Candidate } from "@/lib/evaluation/presentation";
import { SourceLink } from "@/components/discovery/display";

export function AssessmentReport({ candidate, evaluation }: { candidate: Candidate; evaluation: NonNullable<Candidate["evaluation"]> }) {
  return <section className="assessment-report" aria-label="AI 평가 자료">
    <div className="assessment-summary"><h3>AI 평가 요약</h3><p className="candidate-summary">{evaluation.output.summary}</p><p className="description">평가 신뢰도 {Math.round(evaluation.output.confidence * 100)}%{evaluation.total === null && ` · ${evaluation.unknown_count}개 항목 미확인 · 총점 미확정`}</p></div>
    <div className="assessment-heading"><h3>항목별 평가와 근거</h3><p className="description">점수 아래에서 판단 이유와 사용한 SNS 원본을 바로 확인하세요.</p></div>
    <div className="assessment-grid">{(Object.keys(RUBRIC) as (keyof typeof RUBRIC)[]).map(key => {
      const value = evaluation.output.criteria[key], evidence = candidate.evidence.filter(e => value.evidence_ids.includes(e.id));
      return <article key={key} className={`assessment-criterion ${value.score === null ? "assessment-unknown" : ""}`} aria-label={`${LABELS[key]} 평가`}>
        <div className="assessment-criterion-heading"><h4>{LABELS[key]}</h4><strong>{value.score === null ? "미확인" : <>{value.score}<small> / {RUBRIC[key]}</small></>}</strong></div>
        <p className="assessment-reason">{value.reason}</p>
        <div className="assessment-sources">{evidence.map((e,i) => <SourceLink key={e.id} url={e.url} label={`근거 ${i+1} · ${e.kind === "profile_observation" ? "프로필" : "콘텐츠"}`} />)}{!evidence.length && <span className="description">연결된 SNS 원본 없음</span>}</div>
      </article>;
    })}</div>
    <section className="candidate-section candidate-unknowns"><h3>선정 전에 확인할 점</h3><p className="description mt-3">시청자 국가 분포는 별도 확인되지 않았습니다. 거주 국가와 시청자 국가는 다를 수 있습니다.</p>{evaluation.output.risk_flags.filter(r => r !== "audience_country_unverified").map(flag => <p className="description mt-2" key={flag}>{flag}</p>)}</section>
  </section>;
}

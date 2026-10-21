import { PageHeading, Steps, Empty } from "@/components/ui";
export default function Overview() {
  return <><PageHeading eyebrow="Workspace overview" title="좋은 연결의 시작, 프로젝트부터." description="브랜드의 이야기를 모으고, 크리에이터와 만날 다음 캠페인을 준비하세요." /><Steps /><section className="surface"><Empty title="새 워크스페이스를 준비하고 있습니다" text="프로젝트와 캠페인 관리 기능은 다음 PR에서 연결됩니다." /></section><div className="info-banner">STEP 3의 SNS 직접 탐색과 GPT Work 연동은 실증 대기 중입니다. STEP 5는 사전 제작 디자인 템플릿에 AI가 내용을 작성하는 방식으로 확장합니다.</div></>;
}

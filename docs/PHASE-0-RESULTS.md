# Phase 0 상태 — 실험 미실행

기록일: 2026-10-21 (Asia/Seoul). 담당: 실제 ChatGPT Work 실험 수행자 미배정. STEP 1–2 로컬 MVP는 검증 완료이며, discovery-00 준비 문서를 작성했다. 실제 Work의 SNS 탐색/MCP 쓰기 실험은 실행하지 않았다.

| 플랫폼 | 원본 사이트 방문 | SNS 내부 검색 | 5명 프로필/최근 콘텐츠 | 팔로워/출처 근거 | 판정 |
| --- | --- | --- | --- | --- | --- |
| Instagram | 미실험 | 미실험 | 0명, 미실험 | 없음 | not_tested |
| TikTok | 미실험 | 미실험 | 0명, 미실험 | 없음 | not_tested |
| YouTube | 미실험 | 미실험 | 0명, 미실험 | 없음 | not_tested |

- Work의 인증된 MCP 쓰기: **unverified**. 실제 쓰기 호출 근거 없음.
- 외부 대시보드에서 일반 GPT Work 작업 시작/재개: **not_supported_or_unverified**. 지원 경로를 확인하지 않았고 실행 버튼/API를 구현하지 않았다.
- 이번 로컬 브라우저 검수는 ERUTY 앱 UI 테스트이며 Work/SNS 실증이 아니다.
- Google 검색/인플루언서 벤더 API로 직접 SNS 검색 요건을 대체하지 않았다.

다음 담당자는 [PHASE-0-SNS-SPIKE](PHASE-0-SNS-SPIKE.md)의 실험을 Work에서 수행하고 원본 링크, 확인 시각, 접근 제한과 쓰기 결과를 여기에 기록해야 한다. 이 결과 전에는 Phase 2 연동 방식과 가능한 플랫폼을 확정하지 않는다.

## 준비 산출물 (구현/실행 결과와 구분)

- [실증 runbook](PHASE-0-RUNBOOK.md): Instagram/TikTok/YouTube 각각의 내부 검색·5명 프로필/최근 콘텐츠·공개 지표·실패 기록과 MCP-01 write/read-back 체크리스트.
- [STEP 3 DB/MCP 설계](STEP-3-DATA-MCP-DESIGN.md): 조직별 계정 중복 방지, 불변 run/관찰·현재 검토 상태, 인증·범위·idempotency 계약. 신규 테이블/도구는 아직 구현하지 않았다.
- [병합 준비 검토](PR-MERGE-READINESS.md), [운영 준비 작업표](OPERATIONS-READINESS.md), [작은 PR 계획](STEP-3-PR-PLAN.md).

실제 실험 후에는 위 표에 attempted/direct profiles/native search/recent content accounts/visible metric accounts/elapsed/session/실패 사유를 별도로 기록한다. 후보 원본·Work 채팅·MCP receipt/DB row 검증 근거는 승인된 비공개 저장소에 두고 이 Public 저장소에는 비식별 집계만 남긴다. 템플릿을 채운 것만으로 성공 판정하지 않는다.

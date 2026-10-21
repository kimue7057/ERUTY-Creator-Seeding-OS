# ERUTY Creator Seeding OS — Codex Handoff v1.2

새로운 독립 프로젝트용 개발 인계 패키지입니다. 기존 ERUTY Campaign OS에 코드를 추가하지 않습니다.

## 목적

프로젝트별 브랜드·제품 자료를 저장하고, 캠페인별 SNS 타겟팅을 설정한 뒤, **GPT Work의 SNS 사이트 직접 방문 및 내부 검색을 우선하는** 크리에이터 발굴을 수행합니다. 이후 AI 평가와 사람 승인, AI 이메일 생성/발송, 회신 CRM, 계약/성과 측정까지 확장합니다.

## 파일 안내

- `AGENTS.md`: Codex가 매 작업에서 준수할 저장소 규칙
- `docs/PRD-v1.2.md`: 7개 단계의 승인된 제품 요구사항
- `docs/ARCHITECTURE.md`: 데이터 모델과 통합 경계, 보안 원칙
- `docs/PHASE-0-SNS-SPIKE.md`: GPT Work의 Instagram/TikTok/YouTube 직접 탐색 검증
- `docs/PHASE-1-MVP.md`: 실제 구현할 1차 기능과 완료 기준
- `docs/ROADMAP.md`: 순차 작업과 승인 게이트
- `CODEX_START_PROMPT.md`: Codex에 바로 보낼 첫 작업 지시문

## 시작 순서

1. GitHub에서 **새 비공개 저장소** `ERUTY-Creator-Seeding-OS`를 생성합니다.
2. 이 ZIP의 압축을 풀어 위 파일을 저장소 루트와 `docs/` 경로에 그대로 커밋합니다. ZIP 자체만 올리면 Codex가 문서를 직접 읽기 불편합니다.
3. Codex에서 해당 저장소를 선택해 `CODEX_START_PROMPT.md`의 작업 지시를 실행합니다.
4. 동시에 ChatGPT **Work**에서 `docs/PHASE-0-SNS-SPIKE.md`의 브라우저 실험을 수행합니다. Codex 코딩과 Work SNS 탐색 시험은 별도 실행입니다.
5. 결과를 검토한 다음 STEP 1~2 구현을 합치고 STEP 3 연동 방식에 대한 결정을 기록합니다.

## 주의

- 이 파일은 **개발 설계 패키지**이지 완성된 애플리케이션이 아닙니다.
- 일반 GPT Work를 외부 대시보드 버튼에서 자동 실행하는 경로와 Work의 커스텀 MCP 쓰기 권한은 사전에 실증해야 합니다.
- 모든 SNS 데이터는 확인한 원본 링크와 시간을 함께 저장해야 합니다.
- 개인정보·계정 로그인·API 키는 레포지토리에 커밋하지 않습니다.

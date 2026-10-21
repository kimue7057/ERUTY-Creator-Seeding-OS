# Codex first task — copy this into Codex

당신은 신규 프로젝트 `ERUTY Creator Seeding OS`의 리드 개발자입니다. 기존 `ERUTY-Campaign-OS` 저장소는 수정하지 마세요.

먼저 루트의 `AGENTS.md`와 `docs/PRD-v1.2.md`, `docs/ARCHITECTURE.md`, `docs/PHASE-0-SNS-SPIKE.md`, `docs/PHASE-1-MVP.md`, `docs/ROADMAP.md`를 읽으세요.

## 개발 방향
- STEP 1~4의 확정된 요구사항과 STEP 5의 '사전 제작 디자인 템플릿 + AI 직접 이메일 내용 작성' 원칙을 유지하세요.
- 특히 STEP 3은 GPT Work가 실제 Instagram/TikTok/YouTube에 직접 접속해 **플랫폼 내부에서 검색**하는 것이 핵심입니다. 외부 인플루언서 검색 API나 Google 검색으로 대체하지 마세요.
- 일반 GPT Work를 외부 대시보드에서 자동 실행할 수 있다는 가정, Work에서 MCP 쓰기가 가능하다는 가정을 코딩으로 사실처럼 표현하지 마세요. 이는 별도 PoC에서 검증합니다.

## 이번 작업 범위 — 첫 PR만
1. 신규 Next.js + TypeScript + Tailwind 애플리케이션의 실행 가능한 기초 구조와 기본 레이아웃을 구성합니다.
2. PostgreSQL용 ORM과 초기 마이그레이션/시드 전략을 정합니다. 프로젝트·제품·프로젝트 파일·캠페인 간 관계를 중심으로 설계합니다.
3. STEP 1 프로젝트 목록/생성/편집/상세, STEP 2 캠페인 목록/생성/편집/상세를 구현하기 위한 상세 작업 계획과 체크리스트를 만듭니다.
4. 가능하면 첫 PR에서 프로젝트 및 캠페인의 기본 CRUD를 실제 DB에 연결하여 동작하도록 구현합니다. 파일 업로드는 단계적으로 구현하되 동작하지 않는 업로드를 동작하는 것처럼 표시하지 마세요.
5. `.env.example`, 로컬 실행 안내, 기본 테스트·린트·타입 검사·빌드 스크립트를 작성합니다.
6. `docs/PHASE-0-SNS-SPIKE.md`의 Work 브라우저 실험은 실제 Work에서 별도로 실행되어야 하므로 Codex 코드만으로 성공했다고 주장하지 마세요.

## 결과 보고
- 작업/수정 파일 목록
- DB 및 UI 설계 결정
- 실행 및 테스트 결과
- 아직 미구현된 기능과 기술적 리스크
- 다음 PR의 범위와 수용 기준

대규모 전체 구축은 한 번에 하지 말고, 검토 가능한 PR 단위로 진행하세요.

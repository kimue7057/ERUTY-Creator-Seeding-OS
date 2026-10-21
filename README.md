# ERUTY Creator Seeding OS

기존 Campaign OS와 독립된 Next.js 운영 대시보드. 승인된 제품 기획은 [PRD v1.2](docs/PRD-v1.2.md), 현재 개발 기록과 미구현 범위는 [IMPLEMENTATION](docs/IMPLEMENTATION.md)에 있다.

## Windows 로컬 실행

Node.js 22.12 이상(검증 환경: 24), pnpm 11.25.0, Git이 필요하다. Google Drive 밖의 로컬 Git checkout에서 실행한다. pnpm이 없다면 Corepack 또는 pnpm 공식 설치 방법으로 설치한다.

```powershell
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:local
```

`db:local`은 PostgreSQL 18 프로세스를 loopback:55432에서 실행한다. 해당 터미널을 유지하고 다른 터미널에서 실행한다.

```powershell
pnpm db:migrate
pnpm db:seed
pnpm db:demo # 선택: [샘플] 표시된 합성 프로젝트/제품/캠페인
pnpm dev
```

[http://127.0.0.1:3000](http://127.0.0.1:3000)에 접속한다. `setup:local`이 만든 **Git에서 제외되는 `.env`**의 BOOTSTRAP_EMAIL/BOOTSTRAP_PASSWORD로 로그인한다. 비밀번호는 무작위 생성되며 출력/커밋하지 않는다. `db:seed`는 워크스페이스와 관리자만 만들고 기존 비밀번호는 덮어쓰지 않는다. 실제 브랜드·이메일·크리에이터 데이터 fixture는 없다. 계정은 현재 CLI로 초기 설정하며 팀 초대 UI는 후속 범위다.

기존 PostgreSQL을 사용하려면 `.env.example`을 `.env`로 복사하고 전용 DATABASE_URL과 안전한 관리자 자격 증명을 설정한다. 이 경우 `db:local`은 실행하지 않는다. 운영은 별도 PostgreSQL과 HTTPS를 사용해야 한다. `pnpm build` 후 `pnpm start`는 운영 보안 쿠키를 사용하므로 로컬 HTTP UI 검증은 `pnpm dev`로 진행한다.

## 개발 및 검증

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build
```

브라우저 회귀 검사는 **별도 테스트 DB**를 마이그레이션/시드한 뒤 실행한다. 테스트가 합성 레코드를 만들므로 운영 DB에서는 실행하지 않는다. CI는 임시 PostgreSQL 서비스에서 실행한다.

```powershell
pnpm exec playwright install chromium
$env:E2E_ALLOW_WRITES = 'true'
pnpm test:smoke
```

스키마 변경은 `pnpm db:generate`로 SQL을 생성하고 검토 후 `pnpm db:migrate`로 적용한다. `drizzle/`을 반드시 함께 커밋한다. `.local/postgres`는 재시작 후 유지된다. 개발 DB 종료는 DB 터미널에서 Ctrl+C. 운영 DB에 로컬 helper를 사용하지 않는다.

## 경계와 상태

- 구현: 로그인/역할, 프로젝트 목록·생성·편집·상세, 브랜드/USP/참고 링크, 제품 추가·수정·보관, 조직 범위 검색 및 감사 기록.
- 구현: 캠페인 목록·검색·필터·생성·편집·상세, 다중 국가(24개 선택지)/플랫폼, 카테고리, 팔로워 min/max, 프리셋/직접 목표, 제외 조건, 정수 단위 예산·일정·상태.
- 캠페인 생성 시 브랜드/선택 제품/관련 파일 메타데이터의 브리프 v1을 저장한다. 프로젝트·제품 원본 수정은 기존 브리프를 바꾸지 않는다. 연결 제품 변경은 새 브리프 버전을 추가한다. DB 트리거는 초기 스냅샷과 기존 버전의 UPDATE를 차단한다.
- 파일 업로드: 아직 미구현. 비공개 object storage와 버전 메타데이터 연결이 다음 PR 범위다.
- STEP 3: Work가 SNS에 직접 접속해 내부 검색해야 한다. 실제 Work 실험, MCP 쓰기 및 외부 대시보드 실행 경로는 **미검증**이다. [Phase 0 실증 명세](docs/PHASE-0-SNS-SPIKE.md)에 따라 별도로 확인한다.
- STEP 4–7: 미구현. STEP 5는 미리 준비한 이메일 디자인에 AI가 내용을 작성하며, 발송에는 명시적 승인이 필요하다.

문서상 설계를 동작하는 외부 연동으로 간주하지 않는다. 현재 SNS 검색·실제 이메일·계약 실행 기능은 없다.

기술 선택의 공식 참고: [Next.js App Router](https://nextjs.org/docs/app/getting-started/installation), [Drizzle migrations](https://orm.drizzle.team/docs/migrations), [embedded-postgres](https://github.com/leinelissen/embedded-postgres).

검증 근거와 제한은 [TEST-RESULTS](docs/TEST-RESULTS.md), Work 실증 상태는 [PHASE-0-RESULTS](docs/PHASE-0-RESULTS.md)를 참고한다.

## 마이그레이션/운영 메모

`0001`은 기존 캠페인의 생성 스냅샷을 브리프 v1으로 backfill하고, 현재 버전 FK와 UPDATE 방지 트리거를 추가한다. 지연 검사 FK(DEFERRABLE)와 트리거는 Drizzle 스키마가 표현하지 못하는 수동 SQL이므로 향후 마이그레이션에서도 유지한다. 제품 보관은 과거 참조를 유지한다. 프로젝트/캠페인 영구 삭제는 제공하지 않고 캠페인은 보관 상태를 사용할 수 있다.

목록은 검색/필터 결과의 최신 100개를 표시하며 페이지네이션은 후속 범위다. 초기 인증은 CLI 계정 기반으로, 팀 초대·SSO·비밀번호 복구와 운영 배포까지 완료된 제품은 아니다.

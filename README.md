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
pnpm dev
```

[http://127.0.0.1:3000](http://127.0.0.1:3000)에 접속한다. `setup:local`이 만든 **Git에서 제외되는 `.env`**의 BOOTSTRAP_EMAIL/BOOTSTRAP_PASSWORD로 로그인한다. 비밀번호는 무작위 생성되며 출력/커밋하지 않는다. `db:seed`는 워크스페이스와 관리자만 만들고 기존 비밀번호는 덮어쓰지 않는다. 실제 브랜드·이메일·크리에이터 데이터 fixture는 없다. 계정은 현재 CLI로 초기 설정하며 팀 초대 UI는 후속 범위다.

기존 PostgreSQL을 사용하려면 `.env.example`을 `.env`로 복사하고 전용 DATABASE_URL과 안전한 관리자 자격 증명을 설정한다. 이 경우 `db:local`은 실행하지 않는다. 운영은 별도 PostgreSQL과 HTTPS를 사용해야 한다. `pnpm build` 후 `pnpm start`는 운영 보안 쿠키를 사용하므로 로컬 HTTP UI 검증은 `pnpm dev`로 진행한다.

## 개발 및 검증

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

스키마 변경은 `pnpm db:generate`로 SQL을 생성하고 검토 후 `pnpm db:migrate`로 적용한다. `drizzle/`을 반드시 함께 커밋한다. `.local/postgres`는 재시작 후 유지된다. 개발 DB 종료는 DB 터미널에서 Ctrl+C. 운영 DB에 로컬 helper를 사용하지 않는다.

## 경계와 상태

- Phase 1: 인증, 프로젝트 라이브러리와 캠페인 타겟팅을 순차 개발한다.
- 파일 업로드: 아직 미구현. 비공개 object storage와 버전 메타데이터 연결이 다음 PR 범위다.
- STEP 3: Work가 SNS에 직접 접속해 내부 검색해야 한다. 실제 Work 실험, MCP 쓰기 및 외부 대시보드 실행 경로는 **미검증**이다. [Phase 0 실증 명세](docs/PHASE-0-SNS-SPIKE.md)에 따라 별도로 확인한다.
- STEP 4–7: 미구현. STEP 5는 미리 준비한 이메일 디자인에 AI가 내용을 작성하며, 발송에는 명시적 승인이 필요하다.

문서상 설계를 동작하는 외부 연동으로 간주하지 않는다. 현재 SNS 검색·실제 이메일·계약 실행 기능은 없다.

기술 선택의 공식 참고: [Next.js App Router](https://nextjs.org/docs/app/getting-started/installation), [Drizzle migrations](https://orm.drizzle.team/docs/migrations), [embedded-postgres](https://github.com/leinelissen/embedded-postgres).

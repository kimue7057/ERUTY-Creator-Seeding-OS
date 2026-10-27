# ERUTY Creator Seeding OS

MCP 연결 장애는 [요청 추적·오류 코드·격리 회귀·OAuth/Tunnel 복구 절차](docs/MCP-STABILITY.md)로 진단한다. 로컬 테스트 성공과 실제 hosted Work 성공을 구분한다.

현재는 PC를 켜두는 임시 운영을 선택했다. [로컬 PC 운영·재개 안내](docs/LOCAL-PC-OPERATIONS.md)를 따른다. [상시 Linux 서버 전환 구성·비용·보존 및 승인 절차](docs/ALWAYS-ON-MIGRATION.md)는 추후 전환용으로 보관한다.

반복 실증 grant와 분리한 [관리자 운영 승인 정책](docs/DISCOVERY-OPERATING-APPROVALS.md)을 추가했다. 기본값은 비활성화이며, 최대 7일·캠페인 allowlist·scope·환경 hash를 제한한다. 운영 환경 적용은 별도 승인 후 진행하며 기존 만료·철회 grant를 되살리지 않는다.

STEP 3은 [구현·실증 상태](docs/DISCOVERY-IMPLEMENTATION.md)를 따른다. `0004`는 독립 discovery 데이터 모델과 불변 이력을 추가하며, 기존 브리프/파일 버전을 유지한다. 2026-10-26 기존 Work 성공 보고와 독립 PostgreSQL을 대조해 크리에이터 1명·증거 2건·제출 run 및 원본 링크·저장 응답 해시 일치를 확인했다. 상태는 검토 대기이며 기존 기록을 변경하지 않았다. 새 OAuth/권한 환경의 실제 업무 호출이나 전체 STEP 3 완료로 확대 해석하지 않는다.

`MCP_SERVER_MODE=discovery`는 기존 probe와 분리된 6개 discovery 도구를 제공한다. `0005`의 캠페인 allowlist grant와 별도 runtime/verifier 계정, explicit operator 명령을 사용한다. [실행 및 실제 Work 수용 절차](docs/DISCOVERY-MCP.md)를 확인한다. 기존 Tunnel·플러그인 연결을 자동 변경하지 않는다.

`/discovery` 또는 캠페인 상세의 **발굴 기록 보기**에서 저장된 run/계정/근거/실패 로그를 조회한다. 플랫폼·카테고리·팔로워·검증 상태·출처 필터와 원본 링크·확인 시각·과거 관찰을 제공한다. 관리자/매니저의 근거 검토는 추가 이력으로 저장하며 reviewer는 조회만 한다. 합성 자료는 검토 후에도 Work 검증 수에 포함되지 않는다. 대시보드의 Work 자동 실행 버튼과 STEP 5 발송은 제공하지 않는다.

STEP 4의 [근거 기반 평가·담당자 승인](docs/EVALUATION-01.md)을 추가했다. `0009` 적용 후 `EVALUATION_ENABLED=true`로 활성화한다. Work JSON 가져오기와 선택적인 서버 AI 공급자를 제공하며, 미확인 점수·원본 검토·입력 변경·승인 이력을 구분한다. API 키가 없는 환경에서는 서버 AI를 실행하지 않는다.

MCP 실증은 [실행 구성·OAuth·Work 체크리스트](staging/probe/README.md)를 따른다. 전용 PostgreSQL·제한된 MCP 계정·독립 read-only 검증 계정을 사용한다. Windows 로컬 E2E용 Secure MCP Tunnel 및 테스트 OAuth 구성도 제공한다. hosted Work 로그인·세 도구 호출·DB 대조·철회 후 차단이 모두 확인되기 전에는 Work 연결 완료로 판정하지 않는다.

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
pnpm mcp:build
pnpm test:integration
pnpm build
```

브라우저 회귀 검사는 **별도 테스트 DB**를 마이그레이션/시드한 뒤 실행한다. 테스트가 합성 레코드를 만들므로 운영 DB에서는 실행하지 않는다. CI는 임시 PostgreSQL 서비스에서 실행한다.

discovery 브라우저 검사는 loopback DB만 허용하고 별도 합성 조직/세션을 만든다. 세션은 종료 시 제거하며 불변 관찰/검토 이력은 테스트 DB에 남는다. 임시 DB는 검사 후 폐기하거나 로컬 합성 데이터로 보관한다. 스크린샷에는 합성 데이터만 포함되며 Git에 커밋하지 않는다.

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
- 파일 자료실: 비공개 S3 어댑터, 드롭/제품별 업로드, 종류·크기·시그니처/내용 검증, SHA-256, 새 버전과 이력, 미리보기/다운로드, 업로드 취소·고아 객체 정리를 구현했다. 실제 검증 상태는 [projects-02](docs/PROJECTS-02.md)를 참고한다.
- STEP 3: Work가 SNS에 직접 접속해 내부 검색해야 한다. 실제 Work 실험, MCP 쓰기 및 외부 대시보드 실행 경로는 **미검증**이다. [Phase 0 실증 명세](docs/PHASE-0-SNS-SPIKE.md)에 따라 별도로 확인한다.
- STEP 4: 평가 초안·근거·담당자 승인 이력 구현. 실제 SNS 방문과 실제 AI API 호출의 검증 상태는 별도로 관리한다. STEP 5–7은 미구현이며 실제 발송은 명시적 승인이 필요하다.

문서상 설계를 동작하는 외부 연동으로 간주하지 않는다. 현재 SNS 검색·실제 이메일·계약 실행 기능은 없다.

기술 선택의 공식 참고: [Next.js App Router](https://nextjs.org/docs/app/getting-started/installation), [Drizzle migrations](https://orm.drizzle.team/docs/migrations), [embedded-postgres](https://github.com/leinelissen/embedded-postgres).

검증 근거와 제한은 [TEST-RESULTS](docs/TEST-RESULTS.md), Work 실증 상태는 [PHASE-0-RESULTS](docs/PHASE-0-RESULTS.md)를 참고한다.

## STEP 3 실증 준비

STEP 1–2 로컬 MVP는 검증 완료이며, 실제 Work SNS 탐색/MCP 쓰기는 아직 미실험이다. 이번 준비 문서는 실행 연동이나 신규 DB 구현이 아니다.

- [플랫폼별 Phase 0 체크리스트와 Work 프롬프트](docs/PHASE-0-RUNBOOK.md)
- [STEP 3 DB 및 MCP 인터페이스 설계](docs/STEP-3-DATA-MCP-DESIGN.md)
- [PR #1–4 병합 준비와 CI 재검증 순서](docs/PR-MERGE-READINESS.md)
- [운영 환경·저장소 보안 확인과 후속 작업](docs/OPERATIONS-READINESS.md)
- [STEP 3 작은 PR 단위 개발 계획](docs/STEP-3-PR-PLAN.md)

현재 저장소는 Public이다. 실제 크리에이터 증거·비공개 브리프/Work 채팅/토큰은 저장소·이슈·공개 CI artifact에 넣지 않는다. Private 전환과 main 보호 설정을 검토하되 사용자 승인 전 실제 변경·병합·배포는 수행하지 않는다.

### discovery-probe-01: 최소 MCP 서버

독립 Node 프로세스의 인증된 Streamable HTTP MCP와 `eruty_capabilities`, `write_discovery_probe`, `read_discovery_probe`를 구현했다. synthetic UUID만 받으며 전용 테스트 조직/subject grant·현재 membership/scope·토큰 서명을 검증한다. 실제 PostgreSQL probe 행과 감사 기록, 멱등성 및 독립 DB read-back을 로컬에서 확인했다. 전체 discovery 기능이나 Work 실행 버튼은 없다.

`pnpm db:migrate`로 additive `0003`을 적용한다. 통합 테스트 전에 `pnpm mcp:build`가 필요하다. `pnpm mcp:dev`/`mcp:start`는 별도 프로세스이며 유효 설정 없이는 시작하지 않는다. `.env.example`은 주석 처리된 설정 안내만 제공한다. 테스트용 전용 조직은 명시적인 `mcp:provision` CLI로만 만들며 기존 조직을 등록하지 않는다.

`MCP_RESOURCE_URL`은 OAuth 요청의 `resource` 및 JWT `aud`와 정확히 일치해야 하며, 로컬 HTTP 전송 경로 `/mcp`와 다른 경로를 사용할 수 있다. 터널 연결은 실제 요청에서 확인한 해당 테스트 터널의 식별자를 사용하고 IdP의 resource 설정도 같은 값으로 맞춘다. 보호 리소스 메타데이터와 인증 챌린지는 설정한 resource 경로를 반영한다. 다른 대상의 토큰을 함께 허용하거나 요청 파라미터를 재작성하지 않는다.

2026-10-24 실제 hosted Work의 Discovery 캠페인 조회 응답을 실행 기록·서버 요청 시각·독립 DB hash와 대조했다. **실제 SNS 관찰 저장→재조회→대시보드 검증은 아직 미완료**이며, 조회 성공으로 전체 STEP 3를 완료 처리하지 않는다. 실행/권한/IdP·protocol 제약과 검증 순서는 [MCP 실행 안내](staging/probe/README.md), [DISCOVERY-PROBE-01](docs/DISCOVERY-PROBE-01.md), 검토용 예시는 [work-probe](integrations/work-probe/README.md)에 있다.

## 마이그레이션/운영 메모

`0001`은 기존 캠페인의 생성 스냅샷을 브리프 v1으로 backfill하고, 현재 버전 FK와 UPDATE 방지 트리거를 추가한다. 지연 검사 FK(DEFERRABLE)와 트리거는 Drizzle 스키마가 표현하지 못하는 수동 SQL이므로 향후 마이그레이션에서도 유지한다. 제품 보관은 과거 참조를 유지한다. 프로젝트/캠페인 영구 삭제는 제공하지 않고 캠페인은 보관 상태를 사용할 수 있다.

목록은 검색/필터 결과의 최신 100개를 표시하며 페이지네이션은 후속 범위다. 초기 인증은 CLI 계정 기반으로, 팀 초대·SSO·비밀번호 복구와 운영 배포까지 완료된 제품은 아니다.

## 비공개 파일 저장소: projects-02

별도 터미널에서 아래 순서로 준비한다. `storage:install`은 공식 SeaweedFS 4.48 바이너리를 고정 SHA-256으로 검증해 `.local/bin`에 설치한다. 현재 helper는 Windows/Linux x64용이다. 운영용 서비스 설치 명령이 아닌 로컬 S3 호환 테스트 서버다.

```powershell
pnpm storage:install
pnpm storage:local
```

`storage:local` 터미널을 유지하고 다른 터미널에서 실행한다. 로컬 helper는 `.env`에 없는 S3 개발 자격 증명만 무작위 생성하고, 인증 파일/객체를 `.local/storage`에 저장한다. 키를 로그로 출력하지 않는다. DB 서버도 `pnpm db:local`로 실행한 상태여야 한다.

```powershell
pnpm storage:init
pnpm db:migrate
pnpm db:seed
pnpm db:demo
pnpm assets:demo # 선택: 리플러츠 합성 PDF·이미지 실제 업로드, v2 생성, 과거 브리프 다운로드 검증
pnpm dev
```

기존 `.env`에 S3 설정을 추가한 뒤 Next.js 서버를 재시작한다. PDF 20MiB, JPG/PNG/WebP 10MiB, MP4 50MiB 한도다. 브라우저 파일 선언과 확장자, 서버 시그니처, 이미지 디코드/PDF 파싱/MP4 박스 구조를 검사한다. 파일을 OS 임시 폴더로 제한 수신하고 검증한 뒤 S3에 게시하며, S3에서 다시 읽은 바이트의 SHA-256도 확인한다. 원본 이미지는 재인코딩하지 않는다.

자료 ID와 버전을 분리하고 매 업로드에 고유 객체 키를 쓴다. S3 `If-None-Match: *`와 저장소 version ID로 덮어쓰기를 막는다. 캠페인 생성 시 파일 version ID/객체 키/해시를 보존한다. 새 버전이 생겨도 이전 캠페인의 파일 링크는 변경하지 않는다. 이전 파일 접근도 서버에서 조직·프로젝트·현재 사용자 역할을 확인한 뒤 **60초** 서명 URL을 발급한다. 발급된 링크는 만료까지 보유자가 사용할 수 있으므로 공유/로그 저장하지 않는다.

`0002`는 기존 `project_assets` ID/path/version 및 브리프 JSON을 보존한다. 기존 메타데이터는 `legacy_unverified`로 이관하며 실제 객체나 해시를 만들어내지 않는다. 미검증 이전 자료는 새 업로드와 구분하고 다운로드를 차단한다. 파일 버전 UPDATE 방지, 조직/프로젝트 복합 FK, 캠페인의 파일 버전 FK를 유지한다.

```powershell
pnpm assets:cleanup
```

cleanup은 만료된 intent, 취소/실패 객체, 24시간 넘은 미게시 객체와 1시간 넘은 임시 파일을 정리한다. 게시된 파일 버전은 보존한다. DB/S3 장애 후 재실행해도 안전하며, 실제 운영에서는 운영자가 주기 실행하도록 별도 설정해야 한다. 이번 PR은 스케줄러를 만들지 않는다.

외부 S3 사용 시 전용 비공개 버킷에 versioning을 활성화하고 `.env.example`의 서버 전용 설정을 공급한다. 앱은 공개/그룹 ACL 또는 bucket policy가 있는 버킷과 versioning이 꺼진 버킷의 업로드·서명 발급을 거절한다. 이 전용 버킷은 IAM/자격 증명 권한으로 관리한다. 서버 권한에는 객체 Put/Get/DeleteVersion/ListVersions와 버킷 ACL/정책/버전 상태 조회가 필요하다. AWS의 경우 `S3_ENDPOINT`를 생략하고 region을 지정할 수 있다. 운영 endpoint는 HTTPS여야 한다. 내부 filer/volume 포트가 노출되는 개발용 `weed mini`를 운영 공개 서버로 배포하지 않는다.

현재 50MiB 스트림 업로드는 Node 서버를 대상으로 한다. 플랫폼의 요청 본문/실행 시간/메모리 한도가 더 작은 서버리스 환경에는 별도 배포 검증이 필요하다. MP4 코덱 변환, 바이러스 검사, CDN 공개 배포, 파일 영구 삭제 UI는 이번 범위가 아니다.

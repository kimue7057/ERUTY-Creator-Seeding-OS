# 다른 컴퓨터에서 Codex 발굴 실행

대시보드와 PostgreSQL은 Vercel/Neon에서 공유한다. 실제 SNS 브라우저는 작업하는 PC의 **Codex 데스크톱 앱**이 제어한다. 대시보드 요청은 Codex를 자동 실행하지 않는다. 터미널 전용 CLI에는 별도 브라우저 도구가 필요하다.

## PC 최초 준비

1. Node.js 22.12 이상과 pnpm을 설치하고 이 저장소를 내려받아 `pnpm install --frozen-lockfile`을 실행한다.
2. `skills/eruty-codex-discovery` 폴더를 사용자 `.codex/skills/eruty-codex-discovery`로 복사한다. Windows에서는 `Copy-Item -Recurse -Force skills/eruty-codex-discovery "$env:USERPROFILE/.codex/skills/"`를 사용할 수 있다. 앱에 스킬이 표시되는지 확인한다.
3. Codex 앱의 인앱 브라우저 또는 본인이 선택한 Chrome에서 필요한 SNS에 직접 로그인한다. SNS 비밀번호·쿠키를 CLI나 채팅으로 넘기지 않는다.
4. 대시보드의 기존 계정으로 로그인한다. 관리자/매니저만 발굴 작업을 실행할 수 있다. 계정 발급·팀 초대·비밀번호 재설정 UI는 아직 제공하지 않는다.

## 발굴 전용 연결

저장소 아래 `.local/discovery/codex-browser/credentials.private.json`을 로컬 편집기로 만들고 대시보드 로그인 계정을 입력한다. 채팅·Git에 올리지 않는다.

```json
{"email":"YOUR_DASHBOARD_EMAIL","password":"YOUR_DASHBOARD_PASSWORD"}
```

```powershell
pnpm exec tsx scripts/codex-discovery-remote.ts login https://eruty-creator-seeding-os.vercel.app .local/discovery/codex-browser/credentials.private.json
pnpm exec tsx scripts/codex-discovery-remote.ts requests
pnpm exec tsx scripts/codex-discovery-remote.ts claim REQUEST_UUID iab "Codex desktop execution reference"
pnpm exec tsx scripts/codex-discovery-remote.ts context .local/discovery/codex-browser/requests/REQUEST_UUID/authorization.json
```

연결 토큰은 8시간 동안 **발굴 전용 API에만** 유효하며 `.local/discovery/codex-browser/remote-connection.private.json`에 저장된다. 서버에는 토큰 해시만 저장한다. 요청 claim은 별도로 최대 4시간, 고정 캠페인·플랫폼·1–20명에 한정된다. 사용자 역할/소속은 호출마다 다시 확인한다. 다른 PC에 DB URL이나 DB 비밀번호를 설치하지 않는다. CLI는 HTTPS를 요구하고 리디렉션에 자격 증명을 전달하지 않는다.

대시보드에서 발굴 요청을 저장하고 실행 안내를 **이 저장소를 연 Codex 앱 채팅**에 붙여넣는다. 검색 과정과 캡처 형식은 [기존 가이드](CODEX-BROWSER-DISCOVERY.md)를 따른다. 로컬 DB CLI 대신 아래 HTTPS CLI를 쓴다. 원본 캡처 파일의 SHA-256·URL·시각·검색어·지표 원문을 클라이언트와 서버 모두 검사한다.

```powershell
pnpm exec tsx scripts/codex-discovery-remote.ts collect .local/discovery/codex-browser/requests/REQUEST_UUID/authorization.json .local/discovery/codex-browser/RUN/batch.json
pnpm exec tsx scripts/codex-discovery-remote.ts submit .local/discovery/codex-browser/requests/REQUEST_UUID/authorization.json .local/discovery/codex-browser/RUN/submit.json
pnpm exec tsx scripts/codex-discovery-remote.ts logout
```

원본 텍스트 캡처는 발굴 API를 통해 비공개 DB의 수정 불가 이력으로 보관하며, 대시보드 근거 카드에서 같은 조직의 로그인 사용자만 열 수 있다. 후보·원본은 **검토 대기**로 저장된다. 사람이 프로필/게시물 근거와 브라우저 실행을 각각 검토하고, 별도로 적합성을 승인해야 한다. 브라우저 캡처 자체는 독립적인 방문 증명이 아니다.

## 배포·운영 범위

- `0013_remote_capture_scope.sql`까지 마이그레이션한 전용 DB, 서버 전용 `APP_DATABASE_URL`, `APP_ORIGIN`, `CODEX_DISCOVERY_ENABLED=true`, `EVALUATION_ENABLED=true`를 사용한다. Vercel production은 앱 역할의 `APP_DATABASE_URL`을 필수로 요구한다. 통합의 `DATABASE_URL`은 운영자가 마이그레이션할 때만 사용한다. 자동 AI 평가는 별도 opt-in이다.
- 운영 DB는 production에만 연결한다. 미리보기 배포에 운영 DB 자격 증명을 복사하지 않는다. 마이그레이션 소유자와 실제 앱 DB 역할을 분리한다.
- 프로젝트·제품·캠페인·브리프·발굴·평가 데이터는 공유된다. **첨부자료 업로드는 비공개 S3 저장소가 연결될 때까지 비활성**이다. 서버리스 본문 한도보다 큰 파일은 별도 직접 업로드 경로가 필요하다.
- 기존 로컬 DB/Work/Probe/OAuth 세션은 보존한다. 운영 이전 시 대시보드 세션, 발굴 API 토큰, 기존 MCP/Probe 접근 자격 증명을 가져오지 않는다. 기존 비공개 로컬 캡처 경로는 다른 PC에서 자동으로 열리지 않는다.
- Vercel이 로그인을 추가 요구하는 환경에서는 팀 접근도 필요하다. 보호를 임의로 끄지 말고 계정/팀 정책에 맞춰 접속한다.
- 외부 연락, DM, 팔로우, 좋아요, 댓글은 이 실행 범위에 없다.

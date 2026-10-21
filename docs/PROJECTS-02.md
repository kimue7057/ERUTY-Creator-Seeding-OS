# projects-02 — Private versioned project assets

상태: 구현 및 로컬·CI 검증 완료, Draft PR 검토 대기. 담당: Codex. 기준: PRD v1.2 / PHASE-1-MVP. STEP 1–4 및 STEP 5 방향, PostgreSQL/Next.js 구조는 유지한다.

## 브랜치 의존성

2026-10-21 확인: PR #1, #2, #3은 모두 OPEN Draft이며 미병합이다. `feat/projects-02`는 원격 `feat/campaigns-01`의 `a0cd931`에서 시작하며, [Draft PR #4](https://github.com/kimue7057/ERUTY-Creator-Seeding-OS/pull/4)의 base는 `feat/campaigns-01`이다. 선행 PR을 임의로 병합하지 않는다.

## 범위와 수용 계획

1. S3 어댑터와 인증된 로컬 S3 호환 서버를 준비한다. 버킷/객체 익명 접근 거절, 실제 PUT/GET와 SHA-256 일치, 짧은 서명 URL 만료를 검증한다.
2. `project_assets`의 안정된 ID와 기존 필드를 유지하면서 불변 `project_asset_versions`를 분리한다. 기존 자료는 미검증 legacy 버전으로 backfill하며, 기존 브리프 JSON을 수정하지 않는다.
3. 서버가 업로드 intent와 조직·프로젝트·역할·업로더 권한을 검증한다. 스트림을 용량 제한 내 임시 파일로 수신하고 실제 시그니처/유형을 검사한 뒤 고유 객체 키에 저장한다. 저장 후 내용 해시를 다시 검증하고 DB에 게시한다.
4. 실패/취소 시 임시 파일과 미게시 객체를 정리한다. 서버 중단 후 남은 intent/고아 객체는 재실행 가능한 cleanup 명령으로 회수한다. 게시된 버전과 브리프 참조 객체는 지우지 않는다.
5. 프로젝트 자료 패널에 드롭 업로드, 제품 연결/분류, 진행률/취소/오류/권한, 현재 버전과 이력, 미리보기/다운로드를 연결한다. 캠페인 자료 링크는 보존된 정확한 버전을 사용한다.
6. 실제 PDF·PNG/JPG/WebP·MP4 업로드/조회/다운로드, 위조/초과/중단, 조직 격리, 과거 브리프 보존과 마이그레이션 호환성을 검증한다. 타입/린트/단위/DB·S3 통합/빌드/브라우저 회귀를 실행하고 결과를 기록한다.

완료 표시는 실제 저장소 업로드 및 다운로드가 통과한 후에만 한다. 운영 스토리지 배포/비밀키 발급, STEP 3–7은 이번 범위가 아니다.

## 실제 저장소와 무결성

실제 SeaweedFS 4.48 프로세스의 인증된 S3 API를 사용했다. 공식 릴리스 archive의 SHA-256을 고정해 설치한다. Windows와 CI Linux에서 같은 릴리스를 사용하며 mock/in-memory S3로 대체하지 않는다. loopback 전용이며 버킷 정책/공개 ACL 없음, bucket versioning 활성, 익명 bucket/object 요청 거절을 확인한다. S3 어댑터는 업로드와 서명 발급 전에 공개 ACL/정책 또는 버전 관리 해제를 거절한다.

업로드는 15분 intent → 업로더 한정 5분 스트림 → 확장자·MIME·실제 시그니처/내용 검사 → 고유 S3 키의 조건부 PUT → 저장된 객체 재다운로드 해시 검증 → DB 불변 버전 게시 순서다. 클라이언트에는 직접 쓰기 S3 URL이나 비밀키를 제공하지 않는다. 실제 storage version ID도 고정해 이전 버전을 조회한다.

`project_assets`는 현재 이름/분류/제품 연결과 현재 버전을 가리킨다. `project_asset_versions`는 원래 파일명·확인 MIME·바이트 수·SHA-256·S3 version ID·행위자를 보존하고 UPDATE를 거절한다. 캠페인의 파일 버전 FK는 참조된 버전 삭제를 거절한다. 브리프 JSON은 변경하지 않는다.

## 로컬 검증 기록 (2026-10-21, Asia/Seoul)

| 항목 | 결과 |
| --- | --- |
| PostgreSQL 18.4 마이그레이션 0002 | 통과 |
| 0000/0001 데이터에서 0002로 이관 | 통과. 중복 legacy 경로/기존 ID·v7/브리프 JSON 유지, 미검증 상태 구분 |
| 타입 검사 / 린트 / 프로덕션 빌드 | 통과. 린트 및 빌드 경고 0 |
| 단위 테스트 | 5건 통과 |
| PostgreSQL + 실제 S3 통합 테스트 | 11건 통과 |
| 브라우저 | CI Chromium 4건 통과. 로컬 브라우저 제어는 Work 설정상 비활성 |

기능 코드 `4ed8ea7`의 [CI 실행 39545628423](https://github.com/kimue7057/ERUTY-Creator-Seeding-OS/actions/runs/39545628423)에서 설치/실제 PostgreSQL 18·SeaweedFS/마이그레이션/시드/타입/린트/단위 5건/DB·S3 통합 11건/빌드/**브라우저 4건 전체 통과**를 확인했다. 브라우저는 실제 PDF 선택·PNG 드롭 업로드, 새로고침 후 자료/제품 분류 유지, 실제 이미지 미리보기, 다운로드 원본 바이트 일치, 새 버전 업로드 후 캠페인 v1 원본 다운로드를 검증한다. 실제 HTTP 라우트의 세션/조직/현재 역할/Origin 검증과 기존 프로젝트·캠페인 회귀도 포함한다.

캡처는 해당 실행의 `asset-browser-screenshots` artifact와 로컬 Git 제외 폴더 `.local/qa/ci-39545628423/`에 보관했다. 프로젝트 자료실의 현재 v2/이력 v1·v2, 캠페인의 v1 파일 접근 화면을 확인했다. GitHub Actions 자체의 Node 런타임 전환 안내가 있으나 앱 린트/빌드 경고는 없다.

실제 S3 검증 범위: PDF/JPG/PNG/WebP/MP4 왕복 SHA-256 일치, 익명/다른 조직 접근 거절, reviewer 업로드 거절, 같은 조직의 다른 사용자 intent 사용 거절, 짧은 서명 URL 만료, 동시 버전 직렬화, 이전 브리프 원본 바이트 보존, DB 버전 수정/참조 버전 삭제/객체 덮어쓰기 거절. 위조·크기 초과·불완전·중간 중단 스트림과 S3 응답 유실/DB 게시 전 취소를 주입해 미게시 및 cleanup 재실행을 확인했다.

Windows에서 이미지 검사/S3 스트림 핸들이 임시 파일 삭제를 방해하던 문제를 수정하고, 중단 후 임시 파일이 0개인지 회귀 검증했다. 오류 주입의 덮어쓰기 거절 테스트에서 AWS SDK의 non-retryable streaming 안내가 출력되지만 예상된 412 거절이며 테스트는 통과한다.

Next.js 번들에서 파일 감지 라이브러리의 동적 Node import가 실패하던 문제는 크기 제한을 통과한 동일 바이트 버퍼로 시그니처/내용을 검사하도록 수정했다. 검사 기준을 완화하지 않았으며 실제 HTTP 업로드·다운로드와 CI 브라우저 흐름으로 검증했다.

## 로컬 리플러츠 완료 기준 실증

`pnpm assets:demo`로 `[샘플] 리플러츠` 프로젝트에 합성 브랜드 PDF 및 제품 PNG를 **실제 업로드**했다. 파일은 각각 브랜드 소개서/제품 이미지로 분류했고 이미지는 해당 프로젝트 제품에 연결했다. 업로드 후 별도 DB 조회에서도 2개 자료가 유지된다.

`[샘플] 자료 버전 보존 검증` 캠페인은 이미지 v1을 보존한다. 프로젝트 자료실은 이미지 v2를 현재 버전으로 표시하며, 이 캠페인에서 PDF v1 및 이미지 v1을 실제 서명 URL로 다운로드하고 저장된 SHA-256과 일치하는 것을 확인했다. 다운로드된 합성 예제는 Git에서 제외되는 `.local/qa/downloads/brand-brief-v1.pdf`, `product-image-v1.png`에 있다. 실제 브랜드의 비공개 소개서나 제품 이미지라고 주장하지 않는다.

## 운영 범위와 제한

- 다운로드 URL은 60초 bearer URL이다. URL 발급 시 현재 사용자/조직/프로젝트/브리프 참조를 검증한다. 만료 전 이미 발급된 링크의 보유자 접근까지 즉시 회수하지는 않는다.
- CLI cleanup은 미게시 객체만 삭제한다. 실패 시 재실행할 수 있다. 이번 PR에서 정기 스케줄러를 만들지 않았으므로 운영자가 주기 실행해야 한다.
- 운영 S3/관리형 DB/배포는 미실행이다. Node 업로드 프록시의 요청 크기·시간 제한은 배포 환경에 맞춰 검증해야 한다.
- 기존 legacy 메타데이터에서 실제 파일이 확인되지 않으면 해시/다운로드를 만들어내지 않는다. 새 업로드와 구분해 표시한다.
- STEP 3–7과 GPT Work 연동에는 변경이 없다.

공식 참고: [SeaweedFS 릴리스](https://github.com/seaweedfs/seaweedfs/releases/tag/4.48), [S3 조건부 PUT / 버전 관리](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html), [file-type 시그니처 판별](https://github.com/sindresorhus/file-type).

# Phase 1 implementation log

승인된 PRD v1.2와 STEP 1–4/STEP 5 원칙은 변경하지 않는다. 담당: Codex. 변경은 아래 순서의 작은 PR로 검토한다.

| 작업 | 범위와 수용 기준 | 상태 | 브랜치 | 의존성 / 근거 |
| --- | --- | --- | --- | --- |
| foundation-01 | Next.js App Router/TS/Tailwind, 인증 셸, PostgreSQL/Drizzle 초기 마이그레이션, CI. 로그인 없는 접근 차단, 타입/린트/단위/빌드 통과 | 구현/로컬 검사 완료, PR 검토 대기 | feat/foundation-01 | PostgreSQL 18.4 마이그레이션/시드, typecheck/lint/build, 단위 2건 통과 |
| projects-01 | 프로젝트 목록/생성/수정/상세, 브랜드/USP/URL, 제품 관리. 새로고침 후 유지, 권한/프로젝트 격리 검증 | 구현/로컬 검사 완료, PR 검토 대기 | feat/projects-01 | typecheck/lint/build, 단위 3건, PostgreSQL 통합 1건 통과. 브라우저 검증은 캠페인 통합 후 수행 |
| campaigns-01 | 캠페인 목록/생성/수정/상세, 다중 국가/플랫폼, 필터 검증, 프로젝트/제품 연결, 불변 브리프. DB 통합/브라우저 스모크 통과 | 구현/로컬·CI 검사 완료, PR 검토 대기 | feat/campaigns-01 | typecheck/lint/build, 단위 4건, PostgreSQL 통합 4건, Playwright 2건, 실제 브라우저/모바일 확인 |
| projects-02 | 비공개 S3 호환 스토리지, 업로드 검증/버전/다운로드 권한. 실제 파일 업로드/재조회 확인 | 구현/로컬·CI 검사 완료, Draft PR #4 검토 대기 | feat/projects-02 | PR #3 위에 쌓음. 단위 5건/DB·S3 통합 11건/브라우저 4건/타입·린트·빌드 통과. [범위/근거](PROJECTS-02.md) |
| discovery-00 | 실제 Work의 SNS 방문/내부 검색 및 MCP 쓰기 실증 | 미검증 | 해당 없음 | PHASE-0-SNS-SPIKE; 실제 Work에서 별도 실행 |

## 구현 결정

- PostgreSQL + Drizzle: TypeScript 스키마와 검토 가능한 SQL 마이그레이션. 개발용 embedded-postgres도 실제 PostgreSQL 프로세스이며 인메모리 대체 DB가 아니다. 운영에서는 별도 관리형 PostgreSQL을 사용한다.
- Organization namespace와 membership 역할(admin/manager/reviewer). 서버마다 세션 및 조직 범위를 검증하고 reviewer 쓰기를 차단한다. 프로젝트와 제품 관계는 복합 FK로 보호한다.
- 초기 인증은 CLI로 만든 계정과 scrypt 비밀번호, DB 기반 해시 세션(8시간), HttpOnly/SameSite 쿠키. 자체 가입/초대/비밀번호 재설정/SSO는 후속 작업이다.
- 제품 삭제는 보관 처리로 과거 캠페인 참조를 유지한다. 파일은 projects-02에서 실제 비공개 S3에 저장하며 불변 파일 버전과 캠페인 참조를 보존한다. 기존 미검증 파일 메타데이터는 별도로 표시한다.
- 신규 캠페인 생성 시 프로젝트와 선택 제품, 관련 자료의 내용을 JSONB 스냅샷과 브리프 v1으로 보존한다. 타겟팅만 편집하면 브리프는 유지한다. 제품 연결 변경 시 새 버전을 append하며 기존 버전/초기 스냅샷은 DB 트리거로 UPDATE를 차단한다. 현재 버전 FK는 DEFERRABLE 수동 SQL이다.
- 향후 Work 커넥터는 실제 지원 경로 실증 후 인터페이스 뒤에 추가한다. 현재 외부 Work 실행/발굴/평가/메일 발송은 없다.

## 개발 위치

로컬 Git 작업 트리: `C:/Users/user/Projects/ERUTY-Creator-Seeding-OS`. 원본 인계 폴더는 main의 기획 문서를 보존한다. Git PR을 통해 변경을 관리하며 node_modules/DB/비밀값을 Google Drive에 복사하지 않는다.

## PR과 검토 순서

1. [#1 실행 기반/인증/DB](https://github.com/kimue7057/ERUTY-Creator-Seeding-OS/pull/1): main 기준.
2. [#2 프로젝트/제품 관리](https://github.com/kimue7057/ERUTY-Creator-Seeding-OS/pull/2): feat/foundation-01 기준.
3. [#3 캠페인/브리프 버전](https://github.com/kimue7057/ERUTY-Creator-Seeding-OS/pull/3): feat/projects-01 기준.
4. [#4 비공개 자료/파일 버전](https://github.com/kimue7057/ERUTY-Creator-Seeding-OS/pull/4): feat/campaigns-01 기준.

모두 Draft이며 병합/배포하지 않았다. 위 순서로 검토·병합하고, 선행 브랜치가 병합되면 후속 PR의 base를 main으로 변경한다. [projects-02 기능 CI](https://github.com/kimue7057/ERUTY-Creator-Seeding-OS/actions/runs/39545628423)가 실제 저장소와 브라우저를 포함한 전체 검사를 통과했다.

## 파일 수용 기준과 남은 범위

projects-02의 실제 업로드·다운로드 및 이전 브리프 보존 수용 기준은 통과했다. [구체적인 검증과 제한](PROJECTS-02.md)을 참고한다. 운영 스토리지/관리형 DB 배포 및 cleanup 주기 실행 설정은 남아 있다. STEP 3–7과 GPT Work 직접 SNS 탐색/쓰기/실행 연동은 구현·실증하지 않았다.

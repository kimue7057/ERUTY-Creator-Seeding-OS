# 운영 준비 — 확인 결과와 후속 작업

확인: 2026-10-21 05:31 UTC. 상태: 로컬 MVP 검증 완료, **운영 환경 미배포/미검증**. 아래 항목은 개발 문서의 작업표이며 실제 계정 설정·배포·정기 작업을 생성하지 않았다. 담당 배정 전까지 역할은 제안이다.

## 현재 확인한 설정

| 대상 | 관찰 결과 | 의미/한계 |
| --- | --- | --- |
| 저장소 visibility | GitHub REST `visibility=public`, `private=false` | 소스·기획·PR·기존 공개 artifact는 공개 범위로 취급 |
| main 보호 | branch protection `404 Branch not protected`, rulesets `[]` | required CI/검토·직접 push 제한이 설정되지 않음 |
| Secret scanning / push protection | 둘 다 enabled, 조회된 alerts `[]` | 인식 가능한 패턴에 대한 결과이며 모든 비밀값 부재의 보증 아님 |
| Dependabot | security updates disabled, alerts API는 disabled 403 | 의존성 취약점 경보가 없다고 판정할 수 없음. CLI가 추가 scope도 안내했으나 권한 확대하지 않음 |
| Actions 권한 | default read, PR review 승인 권한 false | 현행 CI에는 운영 배포 job 없음. workflow 자체 `permissions` 명시는 후속 검토 |
| GitHub environments / repo Actions secrets | 각각 0개 | 이 저장소 수준의 조회 결과. 조직 secrets나 외부 서비스 설정 전체를 확인한 것은 아님 |
| GitHub deployments / Pages | deployments 0, Pages GET 404 | GitHub에 등록된 배포 없음/Pages 확인 불가. 다른 클라우드에 배포가 절대 없다는 증거는 아님 |
| 앱/스토리지 | loopback 개발 helper, 실제 로컬 PostgreSQL·SeaweedFS 검증 기록 | 운영 DB TLS/IAM/백업, 실제 AWS/S3 정책, 도메인/TLS는 확인할 운영 연결이 없음 |
| 비밀값 파일 | `.env*`(example 제외)/`.local` ignore, tracked 경로 및 조회한 ref 이력에 `.env/.env.local/.local/*` 없음 | `.env.example`만 placeholder. 원문 자격증명을 문서/CI에 출력하지 않음 |

API 관찰은 `GET /repos/{owner}/{repo}`, `/branches/main/protection`, `/rulesets`, `/environments`, `/actions/permissions/workflow`, `/actions/secrets`, `/deployments`, `/pages`, `/secret-scanning/alerts`, `/dependabot/alerts`를 사용했다. 비밀값·토큰·SNS 실제 계정 목록은 이 문서에 저장하지 않는다.

## 후속 작업표

| ID / 우선순위 | 작업·담당 제안 | 완료 근거 | 상태/의존성 |
| --- | --- | --- | --- |
| OPS-01 / 운영 전 필수 | 저장소 Private 전환 검토, owner | 사용자 승인 후 visibility/외부 접근/팀·앱·Actions 사용 가능 여부 재확인 | 결정 대기, 설정 미변경 |
| OPS-02 / 병합 전 권장·운영 전 필수 | main 보호/required CI·검토·직접 push 제한, owner | 정책과 실제 거절/성공 경로, 최종 head의 required check | 미설정. 단독 운영자의 자기 승인 제약도 정책에 반영 |
| OPS-03 / 운영 전 필수 | 50MiB 요청 환경 결정/스테이징 실증, infra+Codex | 아래 업로드 행렬 통과 | 환경 미선정 |
| OPS-04 / 운영 전 필수 | 운영 S3 정책/버전/IAM 호환, infra+Codex | 실제 공급자에서 private/정책/암호화·서명·이전 버전 테스트 | 현행 엄격 정책 제약 검토 필요 |
| OPS-05 / 운영 전 필수 | cleanup worker 및 관찰/알림, infra | 실패/장애/동시 실행과 게시 객체 보존 테스트, 실행 기록 | CLI만 구현, scheduler 없음 |
| OPS-06 / 운영 전 필수 | 계정·세션·보안 헤더·의존성·비밀값 이력 점검, security owner | 보완 PR/위협 모델·부정 접근 회귀/secret scan·취약점 triage | 로컬 기반만 검증 |
| OPS-07 / 운영 전 필수 | 관리형 DB TLS/권한·백업·복원, infra | 제한된 앱 계정/별도 migration 계정, 실제 복원+파일 참조 확인 | 미실행 |
| OPS-08 / 실제 Work MCP 전 필수 | 스테이징 인증 endpoint/워크스페이스 연결 승인, owner+Codex | MCP-01 실제 Work 쓰기/DB read-back·scope 차단 | 설계만 있음 |
| OPS-09 / 실제 후보 수집 전 필수 | 증거 저장 접근/보존·삭제 정책, owner | 원본 URL/공개 지표·trace·캡처의 비공개 저장과 최소 수집 | 실제 후보를 Public Git에 넣지 않음 |

## OPS-03: 50MB 업로드 배포 호환성

현행 제한은 정확히 **MP4 50MiB = 52,428,800 bytes**, PDF 20MiB, 이미지 10MiB다. browser XHR → Next Node route → 격리 임시 디스크 → 검증 → S3 PUT → GET 해시 검증 → DB 게시 경로이며 5분 서버 timeout/route maxDuration 300초가 있다. 애플리케이션의 설정이 앞단 프록시/호스팅 제한을 늘려주지는 않는다.

운영 초기 후보는 이 경로를 지원하는 장기 실행 Node/container다. 요청 본문 한도 최소 52,428,800 bytes, 네트워크/프록시 timeout, 실행 시간, writable temp 디스크, 동시 3개 업로드/사용자 기준 최대 파일 수신·파싱 메모리, 연결 pool/connection abort 전달을 스테이징에서 측정한다. 바이러스 검사 및 파일 격리·리소스 제한은 별도 보완 작업이다.

Vercel Functions의 공개 문서는 요청 body 4.5MB 한도를 안내한다. 따라서 현재 50MiB 프록시 경로를 그대로 호환된다고 표시할 수 없다. [공식 제한](https://vercel.com/docs/errors/function_payload_too_large). 그 환경을 선택한다면 별도 ingestion worker 또는 private quarantine 직접 업로드→서버 검증→게시 구조가 필요하다. 최종 Object를 검증 전 노출하거나 S3 서명 upload 성공만으로 DB 완료 처리하지 않는다. 이번 문서는 구조 변경을 구현하지 않는다.

스테이징 수용: 실제 유효 MP4 50MiB 이내/경계 초과 1byte, PDF·이미지별 한도, 느린 업로드/클라이언트 중단/프로세스 재시작, 동시 업로드, temp 용량 부족, S3/DB 응답 유실, 해시 일치, 새로고침·이전 브리프 다운로드. 실제 외부 ingress를 통과한 결과를 남긴다. 작은 파일 CI만으로 최대 크기 운영 호환을 주장하지 않는다.

## OPS-04: 비공개 S3 정책 호환성

현재 `privateBucket()`은 그룹/public ACL, versioning 비활성, **존재하는 모든 bucket policy**를 거절한다. 안전한 Deny insecure transport·제한된 IAM principal 정책도 거절하므로 "버킷 정책 있음 = 공개"라는 일반 판정으로 사용하면 안 된다. 현행 앱의 제한된 전용 버킷 계약이다. 이를 운영 정책과 맞추기 위해 공개 허용이나 검사 생략을 해서는 안 된다.

1. 공급자와 bucket ownership/versioning/Public Access Block, identity 정책/리소스 정책, HTTPS, encryption/KMS, 보존·복구 요구를 확정한다. AWS는 기본 Bucket owner enforced에서 ACL을 비활성화하지만 ACL 조회는 지원한다. [AWS 공식 문서](https://docs.aws.amazon.com/AmazonS3/latest/userguide/about-object-ownership.html)
2. 후속 adapter PR에서 운영자가 승인한 정책 형태/해시 및 공급자별 public 판정 API·공개 차단 설정을 검증하는 경로를 설계한다. IAM/조건/조직·VPC 정책을 단순 문자열 검사로 공개 여부 판정하지 않는다. 미지원 API·권한 부족은 fail closed하고 명시적으로 보고한다.
3. 앱과 cleanup 역할을 분리한다. 객체 Put/GetVersion 및 상태 조회와, cleanup의 ListVersions/DeleteVersion 범위를 필요한 prefix로 한정한다. bootstrap의 버킷 생성/설정 권한은 앱 runtime에 주지 않는다. 현재 어댑터는 명시적인 서버 key 설정이므로 workload identity/역할 기반 공급은 후속 구현/검증이 필요하다.
4. 운영 전용 테스트 버킷에서 익명 bucket/object 거절, 조건부 PUT·정확한 VersionId 다운로드, 60초 URL/만료, checksum, 정책 변경/거부, KMS 거부, cleanup이 참조 객체를 보존하는지 확인한다. 같은 객체의 과거 버전을 지우는 광범위 lifecycle 규칙은 금지한다.

## OPS-05: 정기 cleanup 실행안

초기 제안은 **5분 간격의 사설 worker/scheduled container job**이다. 실제 scheduler는 미설정이다. 앱과 같은 release·DB·버킷 설정을 사용해 기존 `pnpm assets:cleanup`을 실행한다. public HTTP cleanup endpoint는 만들지 않는다. secrets는 런타임 secret manager로 주입한다.

현행 기준은 intent 15분 만료, 알려진 취소/실패 미게시 객체 회수, 미확인/완료 intent 주변 객체 24시간 유예, temp 1시간이다. 게시된 DB 버전과 일치하는 객체 version은 남긴다. dry-run/분산 실행 잠금은 아직 없으므로 후속 PR에서 추가한다. 단일 scheduler concurrency=1을 적용하고, 여러 host가 실행될 수 있으면 DB advisory lock/lease 및 시간 초과·retry·부분 실패 보고를 검증한다.

중요: 중앙 worker는 다른 앱 인스턴스의 로컬 temp 디스크를 볼 수 없다. 객체/intent 정리는 중앙에서, temp 정리는 각 upload host의 동일 quarantine 경로에서 수행하거나 공유 경로/volume 구조를 명시한다. autoscaling/ephemeral instance 종료 시 temp 수명도 별도로 관리한다.

receipt는 started/ended UTC, release, expired intents/removed object versions/temp files, failures, last-success age만 남기고 키·서명 URL·자격증명을 로깅하지 않는다. 15분 이상 성공 부재/실패 또는 orphan 급증 알림을 제안한다. DB 불가 시 객체를 추정 삭제하지 않는다. 통제된 synthetic orphan으로 재실행·중복 worker·장애 복구와 게시/과거 브리프 객체 보존을 검증한다.

## OPS-01/02/06/07/09: 운영 전 보안 gate

- Private 전환을 권장한다. 실제 크리에이터/비공개 브리프·연결 설정 수집 전에 공개 범위를 결정한다. Private로 바꿔도 이미 복제/다운로드된 소스·artifact는 회수되지 않는다. 기존 공개 이력·artifact를 점검하고 노출 확인 시에만 해당 비밀값을 폐기/교체한다. 전환 후 scan/branch protection/Actions 기능은 요금제·권한별로 다시 확인한다.
- main required CI, PR 검토, force-push/삭제 제한, 배포 environment 승인과 least-privilege token을 설계한다. GitHub 배포 승인 설정이 없다는 점과 실제 외부 cloud 설정 미검증을 구분한다.
- 전체 Git 이력의 전용 secret scan, dependency advisory scan/triage와 Dependabot, CI action 고정/업데이트·artifact 보존/비식별, 운영 secrets rotation을 수행한다. 현재 alerts 0을 전수 보안 검사로 과장하지 않는다.
- 기존 로그인은 scrypt·8시간 HttpOnly/SameSite 세션·계정 단위 limiter·현재 membership 재조회다. 운영용 MFA/SSO 또는 승인된 계정 발급/회수, 조직 전환 정책, 분산 rate limit/남용 방어, TLS/Secure cookie/CSRF·Origin, CSP/미리보기 S3 origin 허용, audit 접근·보존을 점검한다. STEP 4 reviewer 권한 확대를 운영 인증 작업에 몰래 포함하지 않는다.
- 관리형 Postgres의 TLS 검증/사설 네트워크/앱·migration 역할 분리, 연결 제한·복원 연습과 S3 버전 보존을 함께 확인한다. DB 복원 뒤 파일 version ID까지 실제 다운로드해야 복구 검증이다.
- MCP는 별도 OAuth/scope/revocation 및 프로젝트 allowlist, 입력·URL·idempotency·prompt injection 경계를 검증한다. Work에 DB 비밀번호/SNS 쿠키를 전달하지 않는다. 실제 증거의 비공개 저장·최소 수집·보존·삭제 요청 처리를 정한다.

실제 운영 연결이 없으므로 위 미검증 항목을 통과로 표시하지 않는다. 로컬 MVP의 확인 결과는 [PROJECTS-02](PROJECTS-02.md), 다음 개발 순서는 [STEP-3-PR-PLAN](STEP-3-PR-PLAN.md)을 따른다.

# PR #1–4 병합 준비 검토

확인: 2026-10-21 05:31 UTC / 14:31 KST. 상태: **검토 기록 / 사용자 승인 대기**. 실제 merge, ready-for-review 전환, base 변경, 배포, 저장소 설정 변경은 하지 않았다. STEP 1–2는 로컬 MVP 검증 완료로 유지한다. 운영 출시 승인을 뜻하지 않는다.

## 현재 변경 및 CI 근거

| 순서 | PR / 현재 base → head | head SHA | 검토 범위 | 해당 head CI |
| --- | --- | --- | --- | --- |
| 1 | [#1](https://github.com/kimue7057/ERUTY-Creator-Seeding-OS/pull/1), main → feat/foundation-01 | 0774714 | 독립 Next/TS/Tailwind 셸, scrypt/DB 세션·조직 역할, PostgreSQL/Drizzle 0000, 초기 CI | [39539165109](https://github.com/kimue7057/ERUTY-Creator-Seeding-OS/actions/runs/39539165109) success |
| 2 | [#2](https://github.com/kimue7057/ERUTY-Creator-Seeding-OS/pull/2), feat/foundation-01 → feat/projects-01 | bcf890a | 프로젝트/제품 CRUD·보관·조직/프로젝트 범위, DB 통합 검사 | [39539451837](https://github.com/kimue7057/ERUTY-Creator-Seeding-OS/actions/runs/39539451837) success |
| 3 | [#3](https://github.com/kimue7057/ERUTY-Creator-Seeding-OS/pull/3), feat/projects-01 → feat/campaigns-01 | a0cd931 | 캠페인 독립 타겟팅/다중 선택, 0001 불변 브리프·FK, 폼/모바일 회귀 | [39540942631](https://github.com/kimue7057/ERUTY-Creator-Seeding-OS/actions/runs/39540942631) success |
| 4 | [#4](https://github.com/kimue7057/ERUTY-Creator-Seeding-OS/pull/4), feat/campaigns-01 → feat/projects-02 | cc158a4 | 비공개 S3, 0002 파일 버전/legacy 이관, 권한/검증/cleanup, 실제 업로드 브라우저 회귀 | [39545989683](https://github.com/kimue7057/ERUTY-Creator-Seeding-OS/actions/runs/39545989683) success |

GitHub API에서 네 PR 모두 OPEN/Draft/CLEAN, run의 headSha 일치를 확인했다. 각 CI는 당시 base에 대한 근거이며 미래 main 상태를 증명하지 않는다. #4의 현재 전체 검사: 단위 5건, 실제 PostgreSQL/S3 통합 11건, Chromium 4건, 타입/린트/빌드 통과. [상세 수용 결과](PROJECTS-02.md)

## 변경 검토 결과

- `git fetch origin --prune` 후 `main → #1 → #2 → #3 → #4`의 네 ancestor 검사가 모두 exit 0이다. `git merge-tree --write-tree`로 네 인접 쌍의 병합 트리를 계산했으며 충돌이 없다. 이 명령은 branch/ref를 병합하지 않는다. main은 `b3e5ea2`다.
- PRD v1.2, AGENTS, 기존 Phase 0 명세, Phase 1 명세는 main 대비 변경되지 않았다. 기존 Campaign OS 코드나 GPT Work 자동 시작·SNS 발굴·메일 전송 구현을 추가하지 않았다.
- 0000→0001→0002 순서와 journal이 이어진다. 0001/0002의 수동 FK/불변 트리거는 Drizzle 생성만으로 대체하면 안 된다. 0002 legacy backfill은 실물 파일·해시를 만들어내지 않고 기존 JSON을 보존한다.
- 서버 권한 검증·복합 FK·세션의 현재 membership 확인, 실제 파일 검증·불변 버전/서명 URL·실패 정리를 검토했다. 이는 운영 환경 penetration test나 실제 AWS 정책 호환성 검증을 대신하지 않는다.
- `.env`, `.env.local`, `.local/*`가 tracked 파일/조회한 전체 ref의 경로 이력에 없음을 확인했다. CI의 고정 비밀번호는 synthetic 테스트 서비스 전용이다. 시그니처 기반 전체 Git 이력 비밀값 검사를 완료했다고 주장하지 않는다.
- 로컬 수용 기준에 새로 확인한 차단 결함은 없다. 운영 준비에는 공개 저장소/보호 규칙, 50MiB 배포 환경, S3 정책 제약, cleanup 스케줄이 남아 있다. [운영 작업표](OPERATIONS-READINESS.md)

## 승인 후 실행할 순서 — 이번에는 미실행

권장 병합 방식은 **merge commit**이다. 현재 저장소에서 허용되며 기존 commit SHA/조상을 유지해 stacked PR의 중복 diff/replay를 줄인다. squash/rebase merge를 선택하면 후속 PR의 base만 바꾸는 것으로 충분하다고 가정하지 말고, 이미 병합된 변경을 제외한 커밋만 새 base 위로 재구성하고 전체 CI를 다시 확인한다. 원격 branch를 임의 force-push하지 않는다.

1. 승인 범위와 각 PR의 최신 head/base, 미해결 review, CI를 다시 확인한다. main 보호·required check·검토 정책을 먼저 정하는 것을 권장한다. 설정 변경도 별도 승인 대상으로 둔다.
2. #1을 main에 merge commit으로 병합하고 **새 main SHA의 CI**를 기다린다. 이 시점 pipeline에는 초기 DB migration/seed·타입·린트·단위·빌드만 있으며 파일 업로드 검사는 아직 없다.
3. #2 base를 main으로 변경한다. diff가 프로젝트/제품 범위인지 확인하고 main 변경을 head에 반영해 최신 통합 CI를 새로 실행한다. 성공 후 #2 병합→새 main CI 확인.
4. #3에도 같은 순서를 적용한다. 0001 마이그레이션, 조직/FK, 불변 브리프, 캠페인 독립 타겟팅, 브라우저 2건을 재검증한다. 성공 후 병합→main CI 확인.
5. #4 base를 main으로 변경하고 최신 main과 통합한 head에서 **전체 검사**를 확인한다. 신규 DB 0000–0002 + legacy DB 0002 이관, 실제 S3 왕복/익명 차단/만료/중단/고아 정리, 새 버전과 과거 브리프, 브라우저/모바일을 포함한다. 성공 후 병합→최종 main 전체 CI 확인.
6. 이 준비 문서 PR도 #4 병합 후 main으로 retarget하고 문서 diff/CI를 확인한다. 선행 branch는 모든 후속 PR base와 참조를 바꾼 뒤 정리한다. 자동 삭제는 현재 꺼져 있다.
7. 새 main CI가 초록이어도 배포는 하지 않는다. 운영 gate와 배포 대상에 대한 사용자 승인이 별도로 필요하다.

### base 변경 시 CI를 확실히 갱신하는 방법

현재 workflow의 `pull_request`는 기본 activity(`opened/synchronize/reopened`)만 구독한다. base 변경이나 Draft 해제만으로 새 검사가 실행된다고 가정하지 않는다. 이전 run의 단순 rerun도 이전 event SHA를 다시 검사할 수 있으므로 최신 base 검증 근거로 쓰지 않는다. [GitHub 이벤트 문서](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

승인 후 후속 branch에 최신 `origin/main`을 일반 merge하여 push하는 방법을 우선 사용한다. 이 작업은 원격 main이나 운영 DB를 바꾸지 않지만 새 head/PR 통합 CI를 만든다. 당시 merge 결과에 선행 기능이 중복되지 않는지 diff/ancestor를 확인한다. merge가 already-up-to-date라 새 이벤트가 없으면 PR reopen 등 현재 workflow가 지원하는 새 이벤트로 최신 PR merge ref를 검사하고, run/event/head/base/검사한 merge commit을 기록한다. 보호 규칙의 required check는 그 최신 결과여야 한다.

#4의 `workflow_dispatch`만 믿고 #2/#3를 수동 실행하려 하지 않는다. 해당 기능은 이전 PR workflow에 없으며 default branch에도 dispatch 지원 workflow가 있어야 한다. [수동 실행 조건](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow?tool=cli)

## 병합 전 기록 양식

PR number / 승인자·시각·승인 범위 / base SHA / head SHA / 검사한 PR merge SHA / CI run URL·event·결과 / migration 단계 / review 해소 / 실제 merge SHA / main CI URL / 배포 미실행 여부. head가 변경되면 이전 승인·검증 범위가 여전히 적용되는지 재검토한다.

사용자 승인 전 상태는 네 PR 모두 Draft로 유지한다. 이 문서의 절차는 실행된 병합 기록이 아니다.

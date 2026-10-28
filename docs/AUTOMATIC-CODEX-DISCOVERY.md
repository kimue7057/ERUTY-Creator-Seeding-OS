# 요청 버튼부터 SNS 탐색·자동 평가까지

`CODEX_AUTOMATIC_DISCOVERY_ENABLED=true`이면 대시보드의 **탐색 시작**으로 저장된 요청을 신뢰할 수 있는 로컬 실행기가 약 5초 간격으로 수신한다. 실행기는 브라우저 도구를 실제 호출해 연결을 확인한 후 요청을 claim하고, `codex exec`로 설치된 스킬과 브라우저 도구를 사용하는 작업을 시작한다. 사람이 안내문을 채팅에 복사하는 단계는 없다. 요청별 캠페인 조건과 4시간 권한, 후보별 원본 검증·즉시 저장·읽기 확인·사람 검토 조건은 유지한다.

대시보드/DB는 Vercel/Neon에서 실행된다. **SNS 브라우저를 제어하는 실행 PC와 Codex 앱은 켜져 있어야 한다.** 다른 장소의 PC에서는 대시보드로 요청하고 결과를 볼 수 있다. 실행 PC가 꺼지면 새 요청은 대기하며, 진행 중 작업은 연결 끊김으로 표시한다. 브라우저 도구가 없는 순수 CLI만으로는 동작하지 않는다. 앱에 실제 제공된 인앱 브라우저 또는 로그인된 Chrome을 사용하며, 지원 여부를 준비 상태 검사에서 확인한다.

캠페인에서 후보 자동 평가·선별과 사용자 최종 승인까지 이어지는 기본 흐름은 [캠페인 추천 명단](CAMPAIGN-SHORTLIST.md)을 따른다. 새 흐름은 `0015`와 `EVALUATION_ENABLED=true`가 추가로 필요하다.

## 운영 설정

캠페인에 이미 저장된 계정 목록은 실행 컨텍스트에 포함되며 새 요청에서는 제외한다. 서버도 이전 발굴 작업에 저장된 동일 계정을 거절한다. CLI가 수집 중 종료되면 실행기는 실제 저장된 수와 최신 lock version을 조회해 부분 결과를 제출한다. 0명·취소·제출 완료 상태는 변경하지 않는다. 워크스페이스 지출 한도 오류는 별도로 표시하며, 조정 후에는 기존 인원을 제외한 남은 수로 새 요청을 만든다. 이전 실행 실패 기록은 유지한다.

1. 기존 DB와 역할을 백업하고 추가 마이그레이션 `0014`를 적용한다. 기존 마이그레이션·Work·OAuth·Probe 기록은 변경하지 않는다. 클라우드 앱 역할에 `staging/discovery/cloud-app-grants.sql`의 새 테이블 권한을 적용한다.
2. 서버에서 `CODEX_DISCOVERY_ENABLED=true`, `CODEX_AUTOMATIC_DISCOVERY_ENABLED=true`를 설정한다. 실행기에는 DB 자격 증명을 주지 않는다.
3. 실행 PC에 로그인된 Codex CLI와 공식 브라우저 MCP 도구를 준비한다. `codex exec`가 실제 `cua_repl` 도구를 호출하는지 확인한다. Codex 인증 파일을 다른 PC나 공개 CI로 복사하지 않는다.
   Windows에서는 코드와 Git 메타데이터가 모두 같은 로컬 NTFS 드라이브에 있는 독립 clone을 사용한다. C드라이브 폴더여도 `.git`이 Google Drive의 worktree를 가리키면 sandbox 초기화가 실패할 수 있다. 설치기는 다른 드라이브의 Git 메타데이터를 거절한다. CLI 프로세스에만 [공식 Windows MXC 실행 방식](https://learn.chatgpt.com/docs/windows/windows-sandbox)을 우선 사용하도록 설정한다. 준비 검사는 실제 작업과 같은 workspace-write 권한에서 브라우저 도구, 비공개 파일 쓰기·읽기, 대시보드 HTTPS 응답을 모두 확인한다. 전역 Codex 권한 설정은 변경하지 않는다.
4. [원격 연결 가이드](REMOTE-CODEX-DISCOVERY.md)의 대시보드 계정을 비공개 파일로 저장한다. 아래 설정을 `.local/discovery/codex-browser/worker.config.private.json`에 만든다. `worker_id`는 PC마다 새로운 UUID, `codex_path`는 해당 PC에서 확인한 실제 CLI 경로다.

```json
{
  "origin": "https://eruty-creator-seeding-os.vercel.app",
  "worker_id": "REPLACE_WITH_NEW_UUID",
  "name": "발굴 실행 PC",
  "browser_surface": "chrome",
  "platforms": ["instagram", "tiktok", "youtube"],
  "credentials_file": ".local/discovery/codex-browser/credentials.private.json",
  "codex_path": "ABSOLUTE_PATH_TO_CODEX"
}
```

Windows 현재 사용자 로그인 시 자동 시작하고 지금 실행:

```powershell
pwsh -NoProfile -File scripts/install-codex-discovery-worker.ps1
```

수동 실행 또는 다른 OS:

```powershell
node --import tsx scripts/codex-discovery-worker.ts
```

실행 로그는 `.local/discovery/codex-browser/worker.private.log`, 요청별 원본과 CLI 이벤트는 `requests/<id>/`의 비공개 파일에 남긴다. 서버에는 안전한 단계·오류 코드·수집 수만 표시한다. 연결 토큰은 8시간이며 실행기가 갱신한다. 같은 PC의 중복 실행은 서버 임대에서 차단하고, 서로 다른 PC는 DB 잠금으로 같은 요청을 중복 수신하지 않는다. 새 인스턴스는 이전 인스턴스의 45초 임대가 끝난 후 연결할 수 있다.

취소는 다음 상태 확인 시 실행 프로세스를 종료하고 이후 후보 저장을 거절한다. 기존 근거는 보존한다. 종료·로그인 제한·시간 만료를 성공으로 표시하지 않는다. 요청한 인원 미달은 일부 수집, SNS 로그인/CAPTCHA는 접근 제한이다. 자동 재시작은 이전 요청 권한을 부활시키지 않는다. 중단된 요청은 기존 근거를 확인하고 취소한 후 새 요청을 만든다. 후보 수집 완료와 사람 검토 완료는 별개다.

운영 중지: 예약 작업 `ERUTY Codex Discovery Worker`를 중지/비활성화하고 서버의 자동 실행 플래그를 끈다. 실행 중 권한과 세션은 만료되며 기록을 삭제하지 않는다. 외부 연락과 최종 적합성 승인은 이 실행기에 포함하지 않는다.

# 발신 계정 연결과 선정 크리에이터 연락

2026-11-03. 사용자 요청으로 STEP 5와 회사 계정 연결을 구현한다. PRD의 고정 디자인 + AI 작성 내용 분리 원칙을 유지한다.

## 사용 흐름

1. 관리자 **발신 계정 → 서비스 연결 설정**에서 Google·Meta·TikTok 회사 앱의 인증 정보를 저장한다. Google 웹 앱 JSON 가져오기도 지원한다. 이 최초 설정 이후 재배포 없이 로그인 연결을 사용할 수 있다. 실제 개발자 앱 발급·서비스 심사는 각 서비스에서 완료해야 한다.
2. **발신 계정**에서 서비스·구분 이름·이메일 또는 SNS 아이디를 등록한다. 이 시점은 `로그인 연결 필요`이며 인증 완료가 아니다.
2. **로그인 연결**을 누르고 해당 서비스에 로그인한다. 등록한 주소 또는 승인된 Gmail 별칭과 실제 인증 계정이 일치해야 한다.
3. **캠페인 → 선정 명단 → 연락하기**에서 크리에이터 분석 → 문장 작성 → 디자인 미리보기 → 발신·수신 주소 및 발송으로 진행한다.
4. 회사 계정 A/B/C를 고르면 그 계정에서 확인된 발신 주소만 선택할 수 있다. 계정을 바꾸면 기존 별칭과 발송 확인이 초기화된다.
5. 수신 연락처와 이를 직접 확인한 출처를 입력한다. 이전에 저장한 주소를 선택할 수도 있다. 추정 이메일을 만들어 넣지 않는다.
6. 이메일은 최종 확인과 **이메일 보내기**를 통해 Gmail API가 실제 발송한다. 브라우저를 외부 메일 작성 화면으로 보내는 방식이 아니다.

초안은 서버에 저장되므로 다른 컴퓨터에서도 이어서 작성할 수 있다. 여러 화면의 수정 충돌은 revision으로 차단한다. 최종 선정 취소·원본 변경·캠페인 보관은 저장 및 발송을 차단한다.

## 최초 연결 설정 — 새 개발자 앱 기준

Workspace는 Google의 회사 메일 서비스 이름이다. 별도 Workspace ID나 메일 비밀번호는 필요하지 않다. 개발자 앱 인증 정보는 관리자 전용 `/settings/connections`에 입력하거나 서버 환경변수로 공급한다. 관리자 입력은 서버의 환경변수 키로 암호화해 조직별로 저장하며 응답·감사 로그·일반 계정 조회에 비밀키를 포함하지 않는다. 채팅·Git에 비밀키를 넣지 않는다.

### Google 메일

1. 회사 Google 계정으로 [Google Cloud 프로젝트 만들기](https://console.cloud.google.com/projectcreate)에 들어간다. 프로젝트 이름은 `ERUTY Creator Seeding`처럼 구분한다. 회사 조직에 프로젝트를 만든다.
2. API 라이브러리에서 **Gmail API**를 찾아 사용 설정한다.
3. **Google Auth Platform → Branding**에 앱 이름·지원 이메일·개발자 연락처를 입력한다. **Audience**는 회사 조직만 사용하면 Internal, 다른 조직 계정도 연결하면 External이다. External 테스트 모드에서는 사용할 계정을 테스트 사용자로 등록한다. 외부 운영 전 서비스의 심사 요건을 확인한다.
4. **Clients → Create client → Web application**으로 로그인 앱을 만든다. 승인된 리디렉션 URI를 정확히 등록한다:

   `https://eruty-creator-seeding-os.vercel.app/api/outreach/oauth/google/callback`

5. ERUTY **서비스 연결 설정 → Google 이메일**에서 JSON 인증 파일을 가져오거나 Client ID·secret을 입력한 뒤 저장한다. 파일은 웹 앱용이며 해당 환경의 로그인 완료 주소를 포함해야 한다. 서버 환경변수 `OUTREACH_GOOGLE_CLIENT_ID`, `OUTREACH_GOOGLE_CLIENT_SECRET` 공급도 계속 지원하지만 조직별 저장 설정이 우선한다. 서버의 `OUTREACH_ENCRYPTION_KEY`는 32바이트 난수의 64자리 hex 값이며, 암호화된 정보가 저장된 이후 임의로 교체하지 않는다.
6. ERUTY **발신 계정 → 로그인 연결**에서 회사 메일 계정으로 로그인한다. 기본 권한은 계정 이메일 확인과 `gmail.send`다. 메일함 읽기·삭제 권한은 요청하지 않는다.
7. 연결된 Google 계정에서 **테스트 메일 보내기**를 열어 발신·수신 주소와 고정된 제목·본문을 확인하고 발송한다. 승인된 발신 주소만 사용할 수 있다. 메일 서비스가 반환한 발송 완료와 실제 수신 확인을 구분한다. 수신함·스팸함 도착 여부는 수신자가 확인한다.

연결 테스트는 크리에이터 초안·연락 이력과 별도로 기록한다. 계정당 10분에 최대 5회이며, 같은 요청은 재전송하지 않는다. 응답이 끊기면 **발송 결과 다시 조회**만 실행한다. 결과가 불확실한 요청이 있으면 새 테스트를 차단한다. 운영자는 발신 메일함과 공급자 기록을 확인하기 전 상태를 임의로 변경하지 않는다.
7. 별칭으로 보내려면 **추가 발신 주소도 연결**을 체크한다. 이때 `gmail.settings.basic` 권한이 추가되며, Gmail의 `sendAs.list`에서 기본 주소 또는 `verificationStatus=accepted`인 주소만 표시한다. 해당 권한의 Google 심사 요건은 기본 발송 권한보다 클 수 있다.

회사 이메일이 로그인 가능한 메일함이 아니라 별칭이면 원래 메일함 계정으로 로그인하고 추가 발신 주소 권한을 승인해야 한다. 단순 그룹 주소는 자동으로 발신 주소가 되지 않는다.

공식 문서: [프로젝트](https://developers.google.com/workspace/guides/create-project), [동의 화면·권한](https://developers.google.com/workspace/guides/configure-oauth-consent), [웹 앱 인증 정보](https://developers.google.com/workspace/guides/create-credentials), [발신 별칭](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.sendAs/list), [메일 발송](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send).

### Instagram

1. [Meta for Developers](https://developers.facebook.com/)에서 회사 앱의 Instagram 이용 사례를 연다. **API setup with Unified login**이면 **1. 앱 구성 → 새로운 구성 만들기**로 Instagram 자산을 포함하는 비즈니스 로그인 구성을 만들고 선택한다. 기존 앱의 **API setup with Instagram login**은 별도 방식으로 유지한다.
2. Instagram 계정을 Professional(비즈니스 또는 크리에이터)로 준비한다. 앱 역할에서 해당 Instagram 계정을 테스터로 추가하고 Instagram에서 초대를 수락한다. 앱의 계정 추가 화면과 로그인 동의에서 사용할 회사 계정을 선택한다. ‘게시되지 않음’은 공개 전 상태이며 기다리는 것만으로 게시되지 않는다. 테스트 역할과 공개 운영의 권한·검수·게시 요건을 구분한다.
3. 로그인 완료 주소를 등록한다:

   `https://eruty-creator-seeding-os.vercel.app/api/outreach/oauth/instagram/callback`

4. ERUTY **서비스 연결 설정 → Instagram**에서 실제 Meta 화면과 같은 로그인 방식을 선택한다. Unified Login은 생성된 로그인 URL을 가져오면 **Meta 앱 ID와 구성 ID(config_id)**가 입력된다. Meta 앱 설정의 기본 정보에 있는 앱 시크릿과 앱이 지원하는 Graph API 버전을 입력하고 저장한다. URL의 임의 state·scope·인증 결과는 가져오지 않으며, 계정 연결 요청 때 서버가 state를 새로 생성한다. 기존 Instagram Login은 Instagram 전용 앱 ID·secret을 사용한다. 수동으로 생성한 액세스 토큰을 붙여 넣는 기능은 없다.
5. **발신 계정 → 로그인 연결**에서 Meta의 동의를 마친다. Unified Login은 Meta 앱·SYSTEM_USER 토큰의 유효성, 실제 승인된 `instagram_basic` 권한과 공유된 계정 목록을 확인한 후 **등록한 아이디와 일치하는 계정만** 저장한다. 여러 계정 중 첫 계정을 임의로 연결하지 않는다. 명시적으로 확인된 무기한 토큰만 만료일을 비워 두며, 누락된 만료 정보는 무기한으로 추정하지 않는다. 자산 접근 철회·만료·다른 앱/구성으로 교체하면 재연결한다.

서버 환경변수 사용 시 `OUTREACH_INSTAGRAM_CLIENT_ID`, `OUTREACH_INSTAGRAM_CLIENT_SECRET`, `OUTREACH_INSTAGRAM_API_VERSION`에 더해 Unified Login은 `OUTREACH_INSTAGRAM_LOGIN_MODE=unified`, `OUTREACH_INSTAGRAM_CONFIGURATION_ID`가 필요하다. 기존 저장 설정의 기본값은 Instagram Login으로 유지한다. 구성 ID·방식은 암호화된 조직 설정에 저장하므로 추가 DB 마이그레이션은 없다. 기존 Google 연결의 설정 fingerprint는 유지한다.

관리자는 저장한 Unified Login 설정에서 **저장된 앱 설정 점검**으로 앱 ID·시크릿을 확인할 수 있다. 서버가 해당 조직의 저장된 설정과 revision을 확인한 뒤 Meta에 `client_credentials` 요청을 보내고, 발급된 앱 토큰으로 해당 앱의 `id,business{id,name}`을 읽어 소유 포트폴리오를 확인한다. 반환된 앱 ID가 일치할 때만 소유 정보를 표시한다. 소유 정보 누락이나 조회 권한 부족은 소유자 없음으로 단정하지 않으며 유효한 인증 정보도 무효화하지 않는다. 앱 토큰은 반환·저장하지 않고 계정 상태도 바꾸지 않는다. 점검 성공은 로그인 구성·리디렉션·Instagram 권한이나 계정 연결 성공을 증명하지 않는다.

인증 실패는 `app_credentials`(저장된 앱 점검), `code_exchange`(인증 정보 발급), `token_inspection`(토큰 검증), `account_lookup`(공유 계정 조회)로 구분한다. Meta의 모든 HTTP 400/401/403 응답을 인증 만료로 표시하지 않는다. 앱 불일치·잘못된 토큰 유형도 설정 오류로 구분한다. 숫자 오류 코드 1만으로 시크릿 오류라고 단정하지 않으며, Meta 응답이 명시한 시크릿 오류·앱 ID 오류·리디렉션 불일치·이미 사용된 코드는 고정된 사유로 변환한다. 서버의 `outreach.oauth_failed` 또는 `outreach.instagram_app_check_failed` 로그에는 단계·정해진 사유·숫자 HTTP/Meta 오류 코드만 기록하며, 요청 URL·인증 코드·토큰·시크릿·원본 오류 본문은 남기지 않는다. 이미 사용한 로그인 인증 코드는 재사용할 수 없으므로 오류 수정 뒤에는 새 연결 요청이 필요하다.

검증: URL 가져오기·콜백 주소 일치·새 state·구성 바인딩·토큰 유효성/수명/권한·페이지를 나눈 계정 목록·대상 계정 선택·암호화 저장·조직/세션 분리·실패 단계 분류와 비밀 정보 제거를 합성 응답으로 검증한다. Meta 실제 계정 동의와 Graph 응답 검증은 사용자가 계정을 연결한 뒤 별도로 진행한다. 참고할 Meta 문서: [Unified Login 시작](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started), [인증](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication). 문서 페이지가 접근 제한 응답을 주어 전체 본문 대조는 완료하지 못했으며, 운영 적용 후 실제 인증 결과를 확인해야 한다.

**현재 구현은 계정 인증과 발신 계정 선택까지다. Instagram 메시지 전송 어댑터·대화 조회·수신자 연결·웹훅은 아직 구현되지 않았다.** 일반 Send API에서는 수신자가 먼저 해당 프로페셔널 계정으로 연락한 대화 등 서비스 조건을 확인해야 한다. 계정 인증만으로 모든 발굴 후보에게 먼저 DM을 보낼 수 있다고 표시하지 않는다. [Meta 공식 메시지 API 안내](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).

### TikTok

1. [TikTok for Developers](https://developers.tiktok.com/)에서 앱을 만들고 웹용 Login Kit을 설정한다.
2. `user.info.basic`, `user.info.profile`을 신청하고 다음 로그인 완료 주소를 등록한다:

   `https://eruty-creator-seeding-os.vercel.app/api/outreach/oauth/tiktok/callback`

3. ERUTY **서비스 연결 설정 → TikTok**에서 Client key·secret을 저장한다. 서버 환경변수 `OUTREACH_TIKTOK_CLIENT_ID`, `OUTREACH_TIKTOK_CLIENT_SECRET`도 지원한다. 앱 검토와 계정 권한 승인을 마친다.
4. ERUTY에서 TikTok에 로그인해 실제 계정 아이디를 확인한다.

**Login Kit은 계정 확인 기능이다. DM을 보내는 기능이 아니다.** [Business Messaging API](https://business-api.tiktok.com/portal/docs/business-messaging-api-get-started/v1.3)의 별도 앱 접근 승인·비즈니스 계정 승인·메시지 권한과 대상 대화 가능 여부를 확인한 뒤 메시지 어댑터·웹훅을 구현해야 한다. 현재 TikTok 실제 발송 버튼은 활성화하지 않는다. [웹 로그인](https://developers.tiktok.com/docs/en/login-kit-web), [토큰 관리](https://developers.tiktok.com/docs/en/oauth-user-access-token-management), [계정 정보·권한](https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info).

## 운영자 설치·제약

- 소유자 전용 DB 연결로 `0018_outreach_connection_tests`까지 적용하고 `scripts/outreach-grants.sql`로 기존 제한된 앱 역할에 권한을 준다. 기존 발굴·평가·선정 기록은 변경하지 않는다.
- OAuth state는 10분·1회용이며 조직·사용자·현재 로그인 세션·계정에 묶인다. Google은 PKCE를 적용한다. 계정 등록 값만으로 connected를 만들지 않는다.
- 인증 토큰은 서버에서 AES-256-GCM으로 암호화하고 조직·계정에 묶는다. 공개 계정 조회에 토큰·scope 원문·비밀키가 포함되지 않는다. 앱과 미리보기 환경의 인증 정보는 분리한다.
- 연결 해제는 ERUTY의 저장 토큰과 진행 중 인증 요청을 폐기한다. 서비스 자체의 동의 철회는 해당 서비스의 앱 권한 설정에서 별도로 한다.
- 발송 직전 실제 Gmail 계정과 승인된 발신 주소를 조회한다. 발송 시도는 먼저 DB에 기록한다. 네트워크 타임아웃·불명확한 5xx·프로세스 중단은 `unknown` 또는 `sending`으로 남고 자동 재전송하지 않는다. Gmail 보낸편지함의 실제 상태를 사람이 대조해야 한다. 일반 Gmail API에는 exactly-once 전송 보장이 없다.
- Gmail에서 발송을 접수했다는 기록은 수신·열람·회신을 의미하지 않는다. 회신 수집과 CRM은 이번 범위 밖이다.
- AI 문장 작성은 별도 opt-in `OUTREACH_AI_ENABLED=true`, `OPENAI_API_KEY`, `OUTREACH_MODEL`이 필요하다. 기존 Codex 발굴/평가 작업자는 새 문장 작성용 서버 API 설정을 대신하지 않는다. 설정이 없으면 기능을 명확하게 비활성화하며 저장된 평가를 AI가 새로 작성한 초안으로 위장하지 않는다.
- 실제 회사 계정 OAuth, Google 별칭, 실제 메일 수신, Instagram/TikTok 앱 승인 검증은 개발자 앱 등록 후에 진행한다. 합성 테스트는 실제 서비스 연결 증거가 아니다.

## 검증 범위

단위 테스트: 암호화·계정 범위 바인딩·입력 검증·별칭 필터·메일 본문 이스케이프·MIME 주소.
실제 PostgreSQL 통합 테스트: 조직/역할 격리·OAuth 재사용·다른 세션·다른 계정·만료·연결 해제·revision 충돌·선정 취소·한 번의 발송 요청·불명확한 발송 재시도 차단·SNS 미구현 발송 차단. 외부 서비스는 합성 어댑터다.
브라우저: 계정 등록·상태·조회 전용 권한·선정 명단 진입·4단계·초안 재조회·발신 계정 변경 시 별칭 초기화·발송 확인 초기화·모바일 가로 넘침. 실제 외부 발송은 하지 않는다.

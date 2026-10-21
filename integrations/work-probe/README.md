# Hosted Work 연결 검토용 예시 — 미설치/미배포

이 폴더는 인증된 remote MCP의 연결 설정 예시다. endpoint는 예약된 `.invalid` 도메인이며 실제 서버가 아니다. `plugin.example.json`/`mcp.example.json`은 자동 인식 파일명이 아니다. 패키지를 설치·게시하거나 Codex/Work 설정을 변경하지 않았다.

승인 후 전용 비공개 패키지 디렉터리에 복사하고 실제로 검토한 URL/등록 client ID로 바꾼 뒤 `plugin.json`, `mcp.json`을 사용한다. `tokenEndpointAuthMethod=none`은 PKCE public client 예시이며 실제 IdP/연결 경로에 맞춰 정한다. client secret·access token은 파일에 넣지 않고 승인된 연결 화면/secret 관리에서 공급한다. DCR/CIMD 지원을 가정하지 않는다.

공식 문서는 portable plugin의 root manifest/MCP 설정과 OAuth client 설정을 설명한다. 이 예시의 설치 가능성이나 현재 워크스페이스 허용 여부까지 증명하지 않는다. [Package your plugin](https://developers.openai.com/plugins/build/plugins)

Hosted Work에서는 Plugins의 **Add custom MCP server → 승인된 endpoint·인증 설정 → Create as a plugin → 설치 → 새 Work 채팅에서 @선택** 경로를 먼저 검토한다. 관리자 정책과 로그인/write 승인 동작을 확인해야 한다. 로컬 `~/.codex/config.toml` 등록만으로 hosted Work 연결을 완료 처리하지 않는다. [실제 연결/시험 절차](https://developers.openai.com/plugins/deploy/connect-chatgpt), [Work MCP 경계](https://learn.chatgpt.com/docs/extend/mcp)

현재 Node 프로세스는 OAuth **resource server**만 제공한다. IdP의 authorization code/PKCE 로그인·client 등록·callback·동의·토큰 발급은 외부 시스템의 책임이며 이번 코드에 구현하지 않았다. JWT RS256/ES256, 정확한 issuer/resource audience, 15분 이하 수명, scope와 등록된 subject가 필요하다. 토큰을 발급받는 대화형 OAuth 흐름과 Work 측 callback 등록은 승인 후 검증해야 한다.

이번 SDK의 protocol은 `2025-11-25` 및 하위 협상 범위다. stateless Streamable HTTP JSON 응답이며 SSE GET 구독/legacy SSE/2026 protocol을 지원한다고 주장하지 않는다. 실제 hosted Work 클라이언트가 이 범위를 협상하는지는 승인 후 실증한다.

준비/승인 경계와 수용 기록은 [DISCOVERY-PROBE-01](../../docs/DISCOVERY-PROBE-01.md)에 있다. 공개 디렉터리 제출이나 운영 공개 범위 변경은 별도 범위다.

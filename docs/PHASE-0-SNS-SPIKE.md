# PHASE 0 — Work SNS-direct discovery feasibility test

This is **not** a Codex-only code task. Run real browser experiments in ChatGPT Work. Codex can build a simple results logger/import endpoint in parallel only if needed.

## Questions to verify
1. For Instagram, TikTok and YouTube individually, can Work directly open the SNS domain?
2. Can Work use the platform's native search, hashtag/video, and user profile UI (not merely Google search)?
3. Can Work view 5 unique account profiles/platform, review latest content and record original links?
4. What login, browser session, CAPTCHA, permission or platform limitations occur?
5. If ERUTY exposes a custom MCP, can the Work task actually use authenticated **write** tools in this plan/workspace? Do not presume it can.
6. Can external dashboard code start or resume the exact same ordinary GPT Work browser task? If no supported method is confirmed, mark `not_supported_or_unverified`.

## Acceptance matrix
Record per platform: target 5 candidates, attempted count, directly opened profiles, native-search success (yes/no), verifiable follower data, content evidence, time spent, blocks, observed restrictions, resulting status. The small numbers are for a pilot, not a production guarantee.

Each individual candidate row:
- platform, account URL, handle
- target country and reason for match
- last content URL, short evidence note
- profile_opened_directly (true/false)
- verification_state: direct_sns_verified / web_candidate_unverified / blocked / duplicate
- follower_count + observed_at, or null
- extraction_timestamp, original source URL
- notes on uncertainty and site limitations

Go/no-go: If direct SNS navigation works for at least one target platform, build an operational connector for that platform first and keep the others flagged as restricted until separately verified. If none works, do not quietly change requirements to Google-only searches; report the limitation and agree on the integration path.

## ChatGPT Work test prompt (edit bracketed fields)

> 프로젝트 [프로젝트명]의 브랜드·제품 정보와 캠페인 [캠페인 이름]의 타겟팅 조건을 기준으로, [대상 플랫폼] 웹사이트에 **직접 접속**해서 크리에이터 후보 5명을 발굴해 주세요. Google 검색은 SNS 내부 검색이 부족할 때만 보조로 이용하세요. 반드시 SNS 검색창/해시태그/관련 계정을 먼저 탐색하고, 원본 프로필을 실제로 열어 최근 게시물과 공개 팔로워 수를 확인하세요. 각 계정별 플랫폼, 프로필 URL, 확인한 게시물 URL, 국가·카테고리 부합 근거, 공개 수치, 검증 여부, 확인 시각을 표로 정리하세요. 접근할 수 없는 정보는 '미확인'으로 표시하고 추측하지 마세요. 플랫폼 접근이 차단되면 우회하지 말고 제약을 보고해 주세요. 이 작업은 검색·정리만 수행하며 외부 연락은 하지 마세요.

## Post-test deliverable
One short `docs/PHASE-0-RESULTS.md` with platform verdicts, evidence, Work/MCP write capability, dashboard launch feasibility, implications for Step 3. Replace no unknown with assertion.

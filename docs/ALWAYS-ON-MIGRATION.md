# ERUTY 상시 서버 전환 계획

작성 기준: 2026-10-26 KST. 제안과 현재 실행 결과를 구분한다. 서버 구매, 공개 배포, 도메인 변경 및 PR 병합은 아직 승인·실행하지 않았다.

최신 결정(2026-10-26): 사용자는 AWS 연결 절차를 중단하고 우선 PC를 계속 켜두는 방식으로 운영하기로 했다. 이후 새 임시 OAuth 주소 복구를 명시적으로 승인했다. 서버의 issuer/JWKS와 기존 Tunnel 런타임을 맞추었으며, 새 비공개 연결의 사용자 로그인·동의와 연결 계정 표시를 확인했다. 실제 업무 권한은 별도로 관리한다. [현재 로컬 운영 안내](LOCAL-PC-OPERATIONS.md)를 따른다. 상시 서버 전환은 보류하며, 아래 구성과 예산은 추후 검토용이다. AWS 리소스 생성·결제는 수행하지 않았다.

선택한 준비 기준은 **서울 리전 RAM 4 GB, 서버 기본료 월 USD 24, 백업·도메인 포함 초기 예산 USD 28–35(세금 별도)**이다. 사용자는 AWS 계정이 있고 로그인할 수 있다고 확인했다. 이는 실제 생성·결제 승인을 대신하지 않으며, 로그인 후 계정의 활성 bundle/blueprint와 기존 리소스를 조회한 뒤 최종 생성 구성을 확인한다.

추가 조건: 같은 AWS 계정에서 다른 프로젝트가 사용 중인 리소스는 변경하지 않는다. ERUTY 전용 신규 인스턴스·고정 IP·접속 키·저장소를 준비하고 기존 ERUTY 데이터는 새 대상으로 복사한다. 기존 리소스와 이름이 충돌하면 중단하며 재사용·교체·이름 변경하지 않는다. 기존 프로젝트의 IAM 정책/SSH 키/방화벽/DNS 영역도 수정하지 않는다. 전환 시 사용할 새 도메인은 아직 확정하지 않았다.

## 현재 구조와 재발 원인

- DB, Keycloak, MCP는 Windows PC의 Docker Desktop에서 실행한다. PC 종료·절전·인터넷 단절은 서비스 연결에 영향을 준다.
- Docker 루트 런처의 설치 레지스트리 조회 실패는 엔진 장애와 별개다. 현재 사용자 바탕화면/시작 메뉴/기존 자동 시작은 로컬 전용 배치 런처로 변경했다. 배치 런처는 설치된 Docker CLI의 `desktop start --detach --timeout 45`와 frontend를 사용한다. 완전 재부팅에 대한 검증은 아직 하지 않았다. Docker 업데이트가 바로가기를 다시 만들면 재확인이 필요하다.
- 공개 OAuth는 Quick Tunnel 임시 주소다. 프로세스가 종료되면 기존 URL이 사라지고 재생성 시 주소가 바뀐다. 서버 재기동만으로 OAuth issuer/JWKS 및 ChatGPT에 저장된 주소가 함께 복구되지는 않는다. [Cloudflare 공식 제한](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
- 로컬 대시보드/감독 작업에는 로그인 트리거가 없었다. 현재 사용자 로그인 트리거, 실패 시 1분 간격 최대 3회 재시작, 실행 시간 제한 없음으로 보완했다. OAuth 임시 주소는 자동 교체하지 않는다.
- OAuth 세션과 DB grant는 별개다. 만료된 grant와 사용이 끝난 초기 실증 허가는 재활성화하지 않는다. 상시 서버도 정상 권한 만료를 없애지 않는다.

## 권장 구성

초기에는 서울 리전의 Linux VM 1대에 기존 서비스를 Docker Compose로 운영한다. Docker Desktop, Windows 레지스트리, 사용자 로그인, 개발용 임시 주소에 대한 의존을 없앤다. 단일 VM은 PC와 독립적으로 상시 동작하지만 고가용성 이중화 구성은 아니다.

```text
ChatGPT Work -> 기존 Secure MCP Tunnel의 Linux runtime -> Discovery MCP -> Discovery PostgreSQL
ChatGPT OAuth -> 고정 HTTPS 인증 도메인 -> Keycloak -> OAuth PostgreSQL
사용자 -> 고정 HTTPS 대시보드 도메인 -> Next.js production -> 기존 조직/역할/캠페인 권한 검사
```

- 기존 Secure MCP Tunnel의 ID/리소스 URL과 서버 계약을 우선 유지한다. 별도로 확인하지 않은 Work 자동 시작 기능은 추가하지 않는다.
- 보유 도메인을 사용할 수 없다면 도메인 1개를 구매하고 인증/대시보드 서브도메인을 분리한다. 실제 이름은 승인 후 확정한다.
- 인증 서버에는 고정 DNS + HTTPS를 사용한다. VM 고정 IP와 리버스 프록시를 기본안으로 하고, Quick Tunnel을 운영 issuer로 사용하지 않는다.
- DB/원본 파일은 비공개 네트워크·스토리지에 보관한다. DB 포트를 인터넷에 열지 않는다. Next.js는 개발 서버 대신 production build/start를 사용한다.
- systemd와 Docker의 재시작 정책으로 부팅/프로세스 장애를 복구한다. liveness와 OAuth/DB readiness를 구분하고 일시 오류만 제한적으로 재시도한다.
- 관찰·제출 쓰기의 기존 멱등키와 트랜잭션·권한 검사를 유지한다. 자동 grant 갱신, JWT/scope 검사 제거, 무한 재연결은 하지 않는다.
- Probe DB/설정은 보존하되 Discovery와 계정·네트워크·실행 경로를 분리한다. 진단 컨테이너는 상시 운영 필요성을 따로 판단한다.

## 비용 산정

AWS Lightsail의 public IPv4 Linux 요금 기준이다. 서울 리전 제공 여부는 공식 문서에서 확인했다. 실제 구매 시 해당 리전의 요금·재고·세금·계정 조건을 다시 확인한다. 무료 체험과 프로모션을 예산에서 제외한다.

| 안 | 서버 | 서버 월 비용 | 백업·도메인 월 환산 포함 초기 예산 |
| --- | --- | ---: | ---: |
| 최소 시작 | 2 vCPU / RAM 4 GB / SSD 80 GB | USD 24 | 약 USD 28–35 |
| 권장 여유 | 2 vCPU / RAM 8 GB / SSD 160 GB | USD 44 | 약 USD 48–55 |

- [AWS 공식 가격](https://aws.amazon.com/lightsail/pricing/): 서버 패키지에 고정 IP/DNS/모니터링이 포함된다. 스냅샷은 저장 GB당 월 USD 0.05이며 보관량과 변경량에 따라 늘어난다. 백업 예산은 정액 상한이 아니다.
- [서울 리전 제공](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-regions-and-availability-zones-in-amazon-lightsail.html).
- 도메인은 일반 `.com` 기준 연 USD 12–20 정도를 초기 예산으로 잡되, 선택한 이름의 등록/갱신가와 세금은 결제 직전 확인한다. [등록기관 가격표](https://porkbun.com/products/domains).
- 환율을 **예산 계산용 USD 1 = KRW 1,500**으로 가정하면 월 약 4.2–5.3만 원 / 7.2–8.3만 원이다. 실시간 환율이나 확정 청구액이 아니며 부가세·카드 환전 비용은 별도다.
- ChatGPT 구독, 별도 OpenAI API 사용료, 작업 인건비는 위 금액에 포함하지 않는다. 이 이전 자체가 별도 모델 API 호출을 요구하지는 않는다.
- 현재 Docker idle 메모리는 낮지만 production peak와 빌드 부하는 측정하지 않았다. 4 GB는 최소 시작안이고, Keycloak·DB·대시보드를 함께 운영하는 초기 여유 구성으로 8 GB를 권장한다. 빌드는 가능하면 CI에서 수행한다.

## 이관 순서와 보존 조건

1. **승인**: 서버/리전/월 예산/도메인 이름/공개 범위/전환 시간을 확정한다. 계정 로그인·결제·최종 플러그인 OAuth 승인은 사용자가 수행한다.
2. **목록 및 백업**: Discovery/Probe/OAuth DB, DB 권한, Keycloak realm·클라이언트·서명 키·사용자·세션, 구성, 파일 원본과 객체 스토리지 위치를 목록화한다. `pg_dump`만으로 DB 밖의 파일은 백업되지 않는다. 비밀 값은 채팅·Git에 넣지 않는다.
3. **병렬 준비**: Linux 호스트와 방화벽·HTTPS·백업을 구성하고 기존 DB를 별도 대상에 복원한다. 기존 로컬 volume/데이터는 지우지 않는다. Windows DPAPI로 묶인 runtime key는 Linux에 그대로 복사해 사용할 수 없으므로 승인된 비공개 Secret 전달 경로를 사용한다. 같은 Tunnel ID의 runtime을 두 곳에서 동시에 활성화하지 않는다.
4. **호환성 확인**: 실제 전환 전 고정 origin의 TLS, issuer/JWKS/resource/audience, 정확한 callback, PKCE/refresh 정책과 권한 경계를 검토한다. 기존 원본의 크리에이터/증거/run ID와 DB·파일 해시를 읽기 방식으로 비교한다. 새로운 SNS 탐색·관찰 저장 실증은 반복하지 않는다.
5. **승인된 전환**: 잠깐 쓰기를 멈추고 최종 DB/파일 차이를 반영한 뒤 고정 인증 주소와 플러그인 설정을 함께 맞춘다. issuer 변경으로 기존 OAuth 토큰을 그대로 재사용할 수 있다고 보장하지 않는다. 필요한 로그인·동의는 사용자가 수행한다. DB grant의 유효기간/환경 hash/캠페인 범위는 별도로 검토하며 과거 grant를 살리지 않는다.
6. **마무리**: 필요한 연결 상태 확인만 수행하고, 기존 데이터로 대시보드 조회를 확인한다. 추가 크리에이터 저장 테스트는 하지 않는다. 기존 로컬본은 합의한 보관 기간 동안 롤백용으로 보존한다.

## 운영 기준

- 암호화된 DB logical backup과 서버 외부 백업을 매일 수행하고 보관량에 따른 비용 알림을 둔다. 복구 가능 여부는 별도 격리 대상에 복원해 확인한다.
- 초기 설계 목표는 RPO 24시간/RTO 수 시간이다. 실제 복원 시간 검증 전에는 보장값으로 제시하지 않는다.
- 실패 로그에는 request ID와 안전한 오류 코드만 노출하고 JWT/비밀번호/사용자 데이터는 마스킹한다.
- 서버·DB·Keycloak·Tunnel의 상태를 각각 확인한다. 사용자가 승인한 알림 수단 없이 외부 메시지나 Codex 예약 자동화를 새로 만들지 않는다.
- 단일 VM 장애/유지보수 동안 중단은 가능하다. 무중단이 필요해지는 시점에 DB 분리·다중 노드 비용을 별도로 검토한다.

## 현재 재개 상태

상태/백업/작업 스케줄러 원본 및 적용하지 않은 OAuth 후보는 해당 PC의 Git 제외 `.local/discovery/executions/20261026-service-resume/`에 보관한다. Discovery/OAuth/Probe의 DB 덤프 3개와 각 클러스터의 role/권한을 위한 globals 덤프 3개를 내보냈다. globals에는 비공개 비밀번호 해시가 포함될 수 있으므로 Secret과 동일하게 취급한다. 복원과 DB 밖의 파일 이관은 아직 수행하지 않았다.

기존 버전인 Tunnel client 0.0.16의 공식 Linux amd64 배포 파일을 내려받아 공식 SHA256 목록과 일치함을 확인했다. 서버에 설치하거나 새 runtime을 실행하지는 않았다. Windows DPAPI 키를 일반 파일로 풀어 내보내지 않았다.

서버 전환 준비 초기에는 이 PC에서 AWS CLI와 AWS 구성/자격 증명 파일이 발견되지 않았다. 이는 당시 점검 기록이며 현재 설치 상태나 AWS 계정 유무를 보장하지 않는다. 추후 전환을 재개하면 계정의 서울 리전 실제 bundle/blueprint ID를 확인하고 비용·고정 주소·서버 생성 계획을 확정한다. AWS 로그인은 사용자가 수행하며 장기 Access Key를 채팅으로 받지 않는다. CloudShell은 로컬 CLI 설치 없이 사용할 수 있는 경로다. [AWS 공식 안내](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-how-to-set-up-and-configure-aws-cli.html)

현재 Discovery DB의 읽기 전용 파일 목록 집계는 업로드 파일 0개/파일 버전 0개/브리프 버전 1개다. 별도 로컬 개발 DB나 저장소 전체에 파일이 없다고 일반화하지 않는다. 업로드를 위한 운영 스토리지는 HTTPS·비공개 ACL·버전 보존 조건을 만족하도록 별도로 구성해야 한다.

이 폴더와 실제 크리에이터 ID/증거/Work 링크/Secret은 공개 Git에 올리지 않는다. 저장에 성공한 제출 run은 보존하며, 추가 hosted Work 발굴 실증은 중단한 상태다.

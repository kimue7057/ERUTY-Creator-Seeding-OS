import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { accountService, connectionAvailability } from "@/lib/outreach/accounts";
import { OutreachError, outreachErrorMessage } from "@/lib/outreach/contracts";
import { AccountManager } from "@/components/outreach/account-manager";
import { PageHeading } from "@/components/ui";
export default async function AccountsPage({searchParams}:{searchParams:Promise<{connection?:string}>}) {
  const actor=await requireActor(),accounts=await accountService().list(actor),availability=connectionAvailability(),{connection}=await searchParams;
  const origin=process.env.APP_ORIGIN;
  return <><PageHeading eyebrow="WORKSPACE · CONNECTIONS" title="발신 계정" description="회사 이메일과 SNS를 연결하고, 연락에 사용할 계정·주소를 관리하세요."/>
    {connection&&<p role="status" className={connection==="success"?"outreach-success":"form-error"}>{connection==="success"?"로그인한 계정을 확인하고 연결했습니다.":outreachErrorMessage(new OutreachError(connection))}</p>}
    <AccountManager accounts={accounts} availability={availability} writable={canWrite(actor)}/>
    <details className="surface outreach-setup" open={Object.values(availability).every(v=>!v)}><summary>최초 연결 설정 · 관리자 안내</summary><p>Google Workspace는 회사 메일 서비스 이름입니다. Workspace ID나 메일 비밀번호를 제출할 필요가 없습니다. 최초 1회 회사 개발자 앱을 ERUTY에 등록하면 팀원은 로그인 버튼으로 계정을 연결할 수 있습니다.</p>
      <ol><li><strong>Google:</strong> Google Cloud에서 Gmail API를 사용 설정하고 웹용 OAuth 앱을 만듭니다. 사내 전용으로 운영한다면 회사 조직 내부 앱을 선택할 수 있습니다. 메일 발송 권한과 선택적으로 발신 주소 조회 권한을 설정합니다.</li><li><strong>Instagram:</strong> Meta 개발자 앱에 Instagram Login을 설정합니다. 비즈니스·크리에이터 계정과 해당 앱의 접근 권한이 필요합니다.</li><li><strong>TikTok:</strong> TikTok 개발자 앱의 Login Kit에 계정 기본 정보·프로필 권한을 설정합니다. DM용 Business Messaging은 별도의 승인·연결이 필요합니다.</li></ol>
      <p className="description">각 개발자 앱의 로그인 완료 주소:</p><ul>{(["google","instagram","tiktok"] as const).map(provider=><li key={provider}><strong>{provider}</strong><code>{origin}/api/outreach/oauth/{provider}/callback</code></li>)}</ul>
      <p>앱의 인증 정보는 배포 서버의 보안 설정에 저장합니다. 채팅이나 이 화면에 비밀키를 붙여 넣지 마세요. 현재 준비 상태: Google {availability.google?"준비됨":"설정 필요"} · Instagram {availability.instagram?"준비됨":"설정 필요"} · TikTok {availability.tiktok?"준비됨":"설정 필요"}.</p>
      <div className="sender-actions"><a className="btn" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener noreferrer">Google 개발자 앱 만들기 ↗</a><a className="btn" href="https://developers.facebook.com/" target="_blank" rel="noopener noreferrer">Meta 개발자 설정 ↗</a><a className="btn" href="https://developers.tiktok.com/" target="_blank" rel="noopener noreferrer">TikTok 개발자 설정 ↗</a></div>
      <details className="mt-5"><summary>Google 새 앱 등록 순서 자세히 보기</summary><ol><li>회사 Google 계정으로 새 Cloud 프로젝트를 만듭니다. 프로젝트 이름은 ‘ERUTY Creator Seeding’처럼 입력하세요.</li><li>API 라이브러리에서 Gmail API를 찾아 ‘사용’을 누릅니다.</li><li>Google Auth Platform의 Branding에 앱 이름·지원 이메일을 입력합니다. Audience는 회사 조직만 쓰면 Internal, 다른 조직도 연결하면 External로 설정합니다. 테스트 중이라면 사용할 계정을 테스트 사용자에 추가하세요.</li><li>Clients에서 Web application을 만들고 위의 Google 로그인 완료 주소를 리디렉션 URI에 등록합니다.</li><li>발급된 Client ID와 Client secret을 배포 서버 보안 설정에 등록합니다. 설정이 적용되면 이 화면의 ‘로그인 연결’이 활성화됩니다.</li><li>회사 메일로 로그인하고 권한을 승인합니다. 별칭 주소를 쓰려면 ‘추가 발신 주소도 연결’을 선택하세요. 별칭은 원래 메일함 계정으로 로그인해야 합니다.</li></ol><p className="description">외부 사용자용 앱이나 추가 메일 설정 권한은 Google의 별도 심사가 필요할 수 있습니다. <a className="source-link" href="https://developers.google.com/workspace/guides/configure-oauth-consent" target="_blank" rel="noopener noreferrer">공식 설정 안내 ↗</a></p></details>
      <p className="description">추가 발신 주소는 Google에서 승인된 주소만 표시됩니다. SNS 계정을 직접 입력하는 것으로 연결 완료나 DM 가능 상태가 되지는 않습니다.</p>
    </details><p className="mt-5"><Link className="source-link" href="/campaigns">캠페인으로 돌아가기 →</Link></p></>;
}

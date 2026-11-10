import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { accountService } from "@/lib/outreach/accounts";
import { providerAppService } from "@/lib/outreach/provider-apps";
import { OutreachError, outreachErrorMessage, type SenderProvider } from "@/lib/outreach/contracts";
import { AccountManager } from "@/components/outreach/account-manager";
import { PageHeading } from "@/components/ui";
export const maxDuration=60;
export default async function AccountsPage({searchParams}:{searchParams:Promise<{connection?:string}>}) {
  const actor=await requireActor(), [{connection},accounts,statuses]=await Promise.all([searchParams,accountService().list(actor),providerAppService().status(actor)]);
  const availability=Object.fromEntries(statuses.map(s=>[s.provider,s.configured])) as Record<SenderProvider,boolean>;
  const instagram=statuses.find(s=>s.provider==="instagram");
  return <><PageHeading eyebrow="WORKSPACE · CONNECTIONS" title="발신 계정" description="회사 이메일과 SNS를 연결하고, 연락에 사용할 계정·주소를 관리하세요."/>
    {connection&&<p role="status" className={connection==="success"?"outreach-success":"form-error"}>{connection==="success"?"로그인한 계정을 확인하고 연결했습니다.":outreachErrorMessage(new OutreachError(connection))}</p>}
    {statuses.some(s=>!s.configured)&&<section className="outreach-note setup-callout"><div><strong>처음 연결하는 서비스는 회사 앱 등록이 필요합니다</strong><p>관리자가 연결 정보를 한 번 저장하면, 아래 계정에서 로그인해 연결할 수 있습니다.</p></div><Link className="btn btn-primary" href="/settings/connections">서비스 연결 설정 →</Link></section>}
    <AccountManager accounts={accounts} availability={availability} writable={canWrite(actor)} instagramSystemUserRevision={actor.role==="admin"&&instagram?.configured&&instagram.instagramLoginMode==="unified"?instagram.revision:undefined}/>
    <div className="sender-actions"><Link className="btn" href="/settings/connections">서비스 연결 설정</Link><Link className="btn" href="/settings/templates">메일 템플릿·회사 서명</Link><Link className="btn" href="/outreach">초안·발송 기록</Link></div>
  </>;
}

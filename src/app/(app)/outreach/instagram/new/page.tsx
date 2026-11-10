import Link from "next/link";
import {requireActor} from "@/lib/auth/session";
import {canWrite} from "@/lib/auth/permissions";
import {accountService} from "@/lib/outreach/accounts";
import {PageHeading} from "@/components/ui";
import {BrowserContactComposer} from "@/components/outreach/browser-contact-composer";
export default async function FirstInstagramContact({searchParams}:{searchParams:Promise<{account?:string}>}){
  const actor=await requireActor(),query=await searchParams,accounts=(await accountService().list(actor)).filter(a=>a.provider==="instagram");
  return <><PageHeading eyebrow="OUTREACH · FIRST CONTACT" title="Instagram 첫 연락" description="발굴한 크리에이터에게 회사 계정으로 먼저 협업 제안을 보내세요."/><div className="sender-actions"><Link className="btn" href="/campaigns">선정 명단·분석에서 연락 시작</Link><Link className="btn" href="/settings/accounts">발신 계정 관리</Link><Link className="btn" href="/settings/browser-executor">회사 Chrome 실행기 연결</Link><Link className="btn" href="/outreach/instagram">기존 대화·API 회신</Link></div><BrowserContactComposer accounts={accounts} initialAccount={query.account} writable={canWrite(actor)}/></>;
}

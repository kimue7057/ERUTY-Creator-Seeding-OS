import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { accountService } from "@/lib/outreach/accounts";
import { InstagramInbox } from "@/components/outreach/instagram-inbox";
import { PageHeading } from "@/components/ui";
export const maxDuration=60;
export default async function InstagramInboxPage({searchParams}:{searchParams:Promise<{account?:string}>}){
  const actor=await requireActor(),query=await searchParams,accounts=(await accountService().list(actor)).filter(a=>a.provider==="instagram");
  return <><PageHeading eyebrow="OUTREACH · INSTAGRAM" title="Instagram DM" description="회사 계정을 선택하고 실제 대화를 확인한 뒤 ERUTY에서 답장을 보내세요."/><div className="sender-actions"><Link className="btn btn-primary" href="/outreach/instagram/new">크리에이터에게 먼저 DM 보내기 →</Link><Link className="btn" href="/settings/accounts">발신 계정 관리</Link><Link className="btn" href="/outreach">캠페인 초안·발송 기록</Link></div><InstagramInbox accounts={accounts} initialAccount={query.account} writable={canWrite(actor)}/></>;
}

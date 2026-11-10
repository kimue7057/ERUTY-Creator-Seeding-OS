import Link from "next/link";
import {requireActor} from "@/lib/auth/session";
import {accountService} from "@/lib/outreach/accounts";
import {PageHeading} from "@/components/ui";
import {BrowserExecutorSetup} from "@/components/outreach/browser-executor-setup";
export default async function BrowserExecutorPage(){const actor=await requireActor(),accounts=(await accountService().list(actor)).filter(a=>a.provider==="instagram"&&a.status!=="disconnected");return <><PageHeading eyebrow="WORKSPACE · BROWSER" title="회사 Chrome 연락 실행기" description="이 Chrome 프로필을 회사 Instagram 발신 계정에 연결하세요. ERUTY에서 확정한 DM을 실행하고 결과를 돌려줍니다."/><div className="sender-actions"><Link className="btn" href="/settings/accounts">발신 계정 관리</Link><Link className="btn" href="/outreach/instagram/new">Instagram 첫 연락</Link></div><BrowserExecutorSetup accounts={accounts} admin={actor.role==="admin"}/></>;}

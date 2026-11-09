import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { providerAppService } from "@/lib/outreach/provider-apps";
import { ProviderSetup } from "@/components/outreach/provider-setup";
import { PageHeading } from "@/components/ui";
import { providerSchema } from "@/lib/outreach/contracts";
export default async function ConnectionsPage({searchParams}:{searchParams:Promise<{provider?:string}>}) {
  const actor = await requireActor(), statuses = await providerAppService().status(actor), selected = providerSchema.safeParse((await searchParams).provider);
  return <><PageHeading eyebrow="WORKSPACE · CONNECTION SETUP" title="서비스 연결 설정" description="관리자가 회사 앱을 한 번 등록하면, 팀원은 발신 계정에서 로그인해 메일·SNS를 연결할 수 있습니다." />
    <div className="outreach-intro"><Link className="btn" href="/settings/accounts">← 발신 계정으로</Link><span className="description">회사 앱 등록 → 계정 로그인 → 발신 주소 선택</span></div>
    <ProviderSetup initial={statuses} initialProvider={selected.success?selected.data:"google"} admin={actor.role === "admin"}/>
  </>;
}

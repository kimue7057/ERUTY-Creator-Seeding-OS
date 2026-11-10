import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { templateService } from "@/lib/outreach/templates";
import { TemplateManager } from "@/components/outreach/template-manager";
import { PageHeading } from "@/components/ui";
export default async function TemplatesPage() {
  const actor=await requireActor(),[templates,settings]=await Promise.all([templateService().list(actor),templateService().branding(actor)]);
  return <><PageHeading eyebrow="WORKSPACE · MESSAGE STUDIO" title="템플릿·회사 서명" description="재사용할 제안 문장과 회사 서명을 설정하세요. 크리에이터에게 연락할 때 내용을 적용하고, 다음 단계에서 디자인을 고릅니다."/><TemplateManager initial={templates} initialSettings={settings} writable={canWrite(actor)}/></>;
}

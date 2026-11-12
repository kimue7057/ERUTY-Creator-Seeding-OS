export const maxDuration=300;
import {requireActor} from '@/lib/auth/session';
import {contactService} from '@/lib/outreach/contacts';
import {ContactsList} from '@/components/outreach/contacts-list';
import {PageHeading} from '@/components/ui';
import {ContactWorkspaceNav} from '@/components/outreach/workspace-nav';
export default async function ContactsPage({searchParams}:{searchParams:Promise<{campaign?:string;creator?:string;tests?:string}>}){
 const actor=await requireActor();await searchParams;const rows=await contactService().list(actor);
 return <><PageHeading eyebrow="CREATOR RELATIONSHIPS" title="연락·협업" description="선정 명단에서 제안을 보내고, 크리에이터별로 답장과 협의 진행을 관리하세요."/><ContactWorkspaceNav active="contacts"/><ContactsList initialRows={rows} writable={actor.role!=='reviewer'} userId={actor.userId}/></>;
}

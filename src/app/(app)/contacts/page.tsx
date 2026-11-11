export const maxDuration=300;
import {requireActor} from '@/lib/auth/session';
import {contactService} from '@/lib/outreach/contacts';
import {ContactsList} from '@/components/outreach/contacts-list';
import {PageHeading} from '@/components/ui';
export default async function ContactsPage({searchParams}:{searchParams:Promise<{campaign?:string;creator?:string;tests?:string}>}){
 const actor=await requireActor(),query=await searchParams,rows=await contactService().list(actor);
 return <><PageHeading eyebrow="CREATOR RELATIONSHIPS" title="연락한 크리에이터" description="선정 명단에서 보낸 제안부터 받은 답장, 회신과 협의 진행까지 이어서 관리하세요."/><ContactsList initialRows={rows} campaign={query.campaign} creator={query.creator} tests={query.tests==='1'} writable={actor.role!=='reviewer'} userId={actor.userId}/></>;
}

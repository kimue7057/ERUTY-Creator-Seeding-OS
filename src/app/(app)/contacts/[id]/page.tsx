export const maxDuration=300;
import Link from 'next/link';
import {z} from 'zod';
import {notFound} from 'next/navigation';
import {requireActor} from '@/lib/auth/session';
import {contactService} from '@/lib/outreach/contacts';
import {ContactThread} from '@/components/outreach/contact-thread';
import {accountService} from '@/lib/outreach/accounts';
import {OutreachError} from '@/lib/outreach/contracts';
export default async function ContactPage({params}:{params:Promise<{id:string}>}){
 const actor=await requireActor(),{id}=await params;if(!z.uuid().safeParse(id).success)notFound();
 const detail=await contactService().detail(actor,id).catch(error=>{if(error instanceof OutreachError&&error.code==='not_found')notFound();throw error;});
 const account=(await accountService().list(actor)).find(a=>a.id===detail.conversation.accountId);
 return <><Link className="source-link" href="/contacts">← 연락한 크리에이터</Link><ContactThread initial={detail} writable={actor.role!=='reviewer'} account={account}/></>;
}

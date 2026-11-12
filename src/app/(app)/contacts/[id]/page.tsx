export const maxDuration=300;
import Link from 'next/link';
import {z} from 'zod';
import {notFound} from 'next/navigation';
import {requireActor} from '@/lib/auth/session';
import {contactService} from '@/lib/outreach/contacts';
import {ContactThread} from '@/components/outreach/contact-thread';
import {accountService} from '@/lib/outreach/accounts';
import {OutreachError} from '@/lib/outreach/contracts';
import {safeContactReturn} from '@/lib/outreach/contact-workspace';
export default async function ContactPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{returnTo?:string}>}){
 const actor=await requireActor(),{id}=await params;if(!z.uuid().safeParse(id).success)notFound();
 const detail=await contactService().detail(actor,id).catch(error=>{if(error instanceof OutreachError&&error.code==='not_found')notFound();throw error;});
 const account=(await accountService().list(actor)).find(a=>a.id===detail.conversation.accountId);
 const returnTo=safeContactReturn((await searchParams).returnTo);
 return <><Link className="source-link" href={returnTo}>← 연락 목록으로</Link><ContactThread key={id} initial={detail} writable={actor.role!=='reviewer'} account={account} returnTo={returnTo}/></>;
}

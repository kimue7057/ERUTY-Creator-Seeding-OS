import {createHash} from 'node:crypto';
import {and,asc,desc,eq,inArray,isNull,sql} from 'drizzle-orm';
import {z} from 'zod';
import type {AnyPgColumn} from 'drizzle-orm/pg-core';
import {db} from '../db';
import {contactCases as cases,contactConversations as conversations,contactMessages as messages,contactReplies as replies} from '../db/contact-schema';
import {senderAccounts,instagramDmSends,browserOutreachSends} from '../db/outreach-schema';
import {auditEvents,campaigns,memberships,users} from '../db/schema';
import type {ActorScope} from '../auth/permissions';
import {accountService,outreachMember} from './accounts';
import type {OutreachTx} from './access';
import {normalizeIdentity,OutreachError} from './contracts';
import {GOOGLE_READ_SCOPE,fetchIdentity} from './providers';
import {gmailConversations,MailSendError} from './gmail-conversations';
import {instagramDmService} from './instagram-dm';
import {assertDmWindow,type DmSelection} from './instagram-dm-contracts';
import {hasPlaceholders} from './template-contracts';

type Conversation=typeof conversations.$inferSelect;
type Source={key:string;accountId:string;channel:'email'|'instagram';recipient:string;from:string;body:string;subject:string;sentAt:Date;providerMessageId:string|null;providerThreadId:string|null;selection:DmSelection|null;campaignId:string|null;creatorAccountId:string|null;name:string;origin:'selection'|'legacy'|'connection_test';createdBy:string};
const replySchema=z.object({id:z.uuid(),caseId:z.uuid(),version:z.number().int().nonnegative(),body:z.string().trim().min(1).max(12000),confirmed:z.literal(true)}).strict();
export const contactProgress={proposal:'제안 발송',negotiating:'협의 중',agreed:'진행 확정',declined:'진행 안 함',hold:'보류',closed:'종료'} as const;
export function contactService(database:Pick<typeof db,'transaction'>=db,fetcher:typeof fetch=fetch){
 const scoped=(table:{organizationId:AnyPgColumn},actor:ActorScope)=>eq(table.organizationId,actor.organizationId);
 const caseScope=(actor:ActorScope,id:string)=>and(scoped(cases,actor),eq(cases.id,z.uuid().parse(id)));
 const convoScope=(actor:ActorScope,id:string)=>and(scoped(conversations,actor),eq(conversations.id,id));
 async function load(tx:OutreachTx,actor:ActorScope,id:string,write=false){
  await outreachMember(tx,actor,write);const [item]=await tx.select().from(cases).where(caseScope(actor,id));if(!item)throw new OutreachError('not_found');
  const [conversation]=await tx.select().from(conversations).where(convoScope(actor,item.conversationId));if(!conversation)throw new OutreachError('not_found');
  if(write&&item.campaignId){const [campaign]=await tx.select().from(campaigns).where(and(eq(campaigns.organizationId,actor.organizationId),eq(campaigns.id,item.campaignId)));if(!campaign||campaign.status==='archived')throw new OutreachError('contact_closed');}
  return{item,conversation};
 }
 async function append(tx:OutreachTx,actor:ActorScope,c:Conversation,input:{sourceKey:string;providerMessageId:string|null;direction:'in'|'out';body:string;sentAt:Date;caseId?:string;headers?:Record<string,string>}){
  // A browser send initially has no provider ID. Attach that ID only to one exact,
  // uniquely matching immutable outbound, never to a guessed recipient or text.
  if(input.providerMessageId){
   const [known]=await tx.select({id:messages.id}).from(messages).where(and(scoped(messages,actor),eq(messages.conversationId,c.id),eq(messages.providerMessageId,input.providerMessageId)));if(known)return false;
   if(input.direction==='out'){
    const matches=await tx.select().from(messages).where(and(scoped(messages,actor),eq(messages.conversationId,c.id),eq(messages.direction,'out'),isNull(messages.providerMessageId),eq(messages.body,input.body)));
    const exact=matches.filter(m=>Math.abs(m.sentAt.getTime()-input.sentAt.getTime())<10*60*1000);
    if(exact.length===1){await tx.update(messages).set({providerMessageId:input.providerMessageId}).where(and(scoped(messages,actor),eq(messages.id,exact[0].id)));return false;}
   }
  }
  const inserted=await tx.insert(messages).values({organizationId:actor.organizationId,conversationId:c.id,...input,headers:input.headers??{}}).onConflictDoNothing().returning({id:messages.id});
  return inserted.length>0;
 }
 const service={
  // Project only confirmed original sends. This does not approve/rewrite a creator,
  // evaluation, original message or historical browser/API evidence.
  reconcile:(actor:ActorScope)=>database.transaction(async tx=>{
   await outreachMember(tx,actor,true);
   const result=await tx.execute<Source>(sql`
    SELECT 'draft:'||d.id as key,d.sender_account_id as "accountId",d.channel,d.to_address as recipient,d.from_address as "from",d.body,d.subject,d.sent_at as "sentAt",d.provider_message_id as "providerMessageId",d.provider_thread_id as "providerThreadId",d.instagram_conversation as selection,d.campaign_id as "campaignId",d.creator_account_id as "creatorAccountId",coalesce(c.display_name,c.current_handle,d.to_address) as name,'selection' as origin,d.created_by as "createdBy"
    FROM outreach_drafts d JOIN creator_accounts c ON c.organization_id=d.organization_id AND c.id=d.creator_account_id
    WHERE d.organization_id=${actor.organizationId} AND d.status='sent' AND d.channel IN ('email','instagram') AND d.sender_account_id IS NOT NULL AND d.sent_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM outreach_browser_sends b WHERE b.organization_id=d.organization_id AND b.draft_id=d.id AND b.state='sent')
    UNION ALL
    SELECT 'browser:'||b.id,b.account_id,'instagram',b.recipient_username,b.sender_username,b.body,'',b.sent_at,NULL,NULL,NULL,coalesce(d.campaign_id,r.campaign_id),coalesce(d.creator_account_id,r.creator_account_id),coalesce(c.display_name,c.current_handle,b.recipient_username),CASE WHEN d.id IS NOT NULL THEN 'selection' ELSE 'legacy' END,b.created_by
    FROM outreach_browser_sends b LEFT JOIN outreach_drafts d ON d.organization_id=b.organization_id AND d.id=b.draft_id LEFT JOIN outreach_review_drafts r ON r.organization_id=b.organization_id AND r.id=b.review_draft_id LEFT JOIN creator_accounts c ON c.organization_id=b.organization_id AND c.id=coalesce(d.creator_account_id,r.creator_account_id)
    WHERE b.organization_id=${actor.organizationId} AND b.state='sent' AND b.sent_at IS NOT NULL
    UNION ALL
    SELECT 'instagram:'||s.id,s.account_id,'instagram',s.recipient_username,s.from_username,s.body,'',s.sent_at,s.provider_message_id,s.conversation_id,jsonb_build_object('conversationId',s.conversation_id,'recipientId',s.recipient_id,'username',s.recipient_username),NULL,NULL,s.recipient_username,'legacy',s.created_by FROM instagram_dm_sends s WHERE s.organization_id=${actor.organizationId} AND s.status='sent' AND s.sent_at IS NOT NULL AND s.draft_id IS NULL AND NOT EXISTS(SELECT 1 FROM contact_reply_attempts a WHERE a.organization_id=s.organization_id AND a.id=s.id)
    UNION ALL
    SELECT 'test:'||t.id,t.account_id,'email',t.to_address,t.from_address,t.body,t.subject,t.sent_at,t.provider_message_id,NULL,NULL,NULL,NULL,t.to_address,'connection_test',t.created_by FROM outreach_connection_tests t WHERE t.organization_id=${actor.organizationId} AND t.status='sent' AND t.sent_at IS NOT NULL
    ORDER BY "sentAt" ASC`);
   const known=result.rows.length?await tx.select({key:messages.sourceKey}).from(messages).where(and(scoped(messages,actor),inArray(messages.sourceKey,result.rows.map(s=>s.key)))):[];const projected=new Set(known.map(x=>x.key));
   for(const s of result.rows){if(projected.has(s.key))continue;
    const recipient=normalizeIdentity(s.recipient),routeKey=s.channel==='instagram'?recipient:(s.providerThreadId??s.key);
    await tx.insert(conversations).values({organizationId:actor.organizationId,accountId:s.accountId,channel:s.channel,recipient,routeKey,fromAddress:s.from,providerThreadId:s.providerThreadId,instagramSelection:s.selection,subject:s.subject}).onConflictDoNothing();
    const [c]=await tx.select().from(conversations).where(and(scoped(conversations,actor),eq(conversations.accountId,s.accountId),eq(conversations.channel,s.channel),eq(conversations.routeKey,routeKey))).for('update');
    await tx.insert(cases).values({organizationId:actor.organizationId,conversationId:c.id,campaignId:s.campaignId,creatorAccountId:s.creatorAccountId,displayName:s.name||recipient,origin:s.origin,ownerId:s.createdBy,firstSentAt:new Date(s.sentAt),createdBy:s.createdBy,updatedBy:s.createdBy}).onConflictDoNothing();
    const [item]=await tx.select().from(cases).where(and(scoped(cases,actor),eq(cases.conversationId,c.id),s.campaignId?eq(cases.campaignId,s.campaignId):isNull(cases.campaignId),s.creatorAccountId?eq(cases.creatorAccountId,s.creatorAccountId):undefined));
    if(await append(tx,actor,c,{sourceKey:s.key,providerMessageId:s.providerMessageId,direction:'out',body:s.body,sentAt:new Date(s.sentAt),caseId:item.id}))await tx.update(conversations).set({version:sql`${conversations.version}+1`,updatedAt:new Date()}).where(convoScope(actor,c.id));
   }return{sources:result.rows.length};
  }),
  list:async(actor:ActorScope)=>{
   const member=await database.transaction(tx=>outreachMember(tx,actor));if(member.role!=='reviewer')await service.reconcile(actor);
   return database.transaction(async tx=>{await outreachMember(tx,actor);return(await tx.execute<ContactListRow>(sql`
    SELECT c.id,c.campaign_id as "campaignId",c.creator_account_id as "creatorAccountId",c.display_name as "displayName",c.origin,c.progress,c.owner_id as "ownerId",u.name as "ownerName",c.next_action_on as "nextActionOn",c.first_sent_at as "firstSentAt",v.channel,v.recipient,v.from_address as "fromAddress",v.account_id as "accountId",v.last_synced_at as "lastSyncedAt",v.sync_error as "syncError",a.status as "accountStatus",a.label as "accountLabel",a.scopes @> ARRAY[${GOOGLE_READ_SCOPE}]::text[] as "mailReadEnabled",p.title as "campaignTitle",j.name as "projectName",m.direction as "lastDirection",left(m.body,180) as preview,m.sent_at as "lastMessageAt",EXISTS(SELECT 1 FROM contact_reply_attempts r WHERE r.organization_id=c.organization_id AND r.conversation_id=v.id AND r.status IN ('sending','unknown')) as blocked
    FROM contact_cases c JOIN contact_conversations v ON v.organization_id=c.organization_id AND v.id=c.conversation_id JOIN outreach_sender_accounts a ON a.organization_id=c.organization_id AND a.id=v.account_id JOIN users u ON u.id=c.owner_id
    LEFT JOIN campaigns p ON p.organization_id=c.organization_id AND p.id=c.campaign_id LEFT JOIN projects j ON j.organization_id=p.organization_id AND j.id=p.project_id
    LEFT JOIN LATERAL(SELECT direction,body,sent_at FROM contact_messages x WHERE x.organization_id=c.organization_id AND x.conversation_id=v.id ORDER BY sent_at DESC,created_at DESC LIMIT 1)m ON true
    WHERE c.organization_id=${actor.organizationId} ORDER BY m.sent_at DESC NULLS LAST,c.id LIMIT 500`)).rows;});
  },
  detail:(actor:ActorScope,id:string)=>database.transaction(async tx=>{
   const context=await load(tx,actor,id);const rows=await tx.select().from(messages).where(and(scoped(messages,actor),eq(messages.conversationId,context.conversation.id))).orderBy(desc(messages.sentAt),desc(messages.createdAt)).limit(200);
   const attempts=await tx.select().from(replies).where(and(scoped(replies,actor),eq(replies.conversationId,context.conversation.id))).orderBy(desc(replies.createdAt)).limit(30);
   const related=await tx.select({id:cases.id,name:cases.displayName,campaignId:cases.campaignId,progress:cases.progress}).from(cases).where(and(scoped(cases,actor),eq(cases.conversationId,context.conversation.id)));
   const owners=await tx.select({id:users.id,name:users.name}).from(memberships).innerJoin(users,eq(users.id,memberships.userId)).where(and(eq(memberships.organizationId,actor.organizationId),inArray(memberships.role,['admin','manager'])));
   return{...context,messages:rows.reverse(),attempts,related,owners};
  }),
  update:(actor:ActorScope,id:string,input:unknown)=>database.transaction(async tx=>{
   const data=z.object({revision:z.number().int().positive(),progress:z.enum(['proposal','negotiating','agreed','declined','hold','closed']),ownerId:z.uuid(),nextActionOn:z.iso.date().nullable(),notes:z.string().max(4000)}).strict().parse(input);await load(tx,actor,id,true);
   const [owner]=await tx.select().from(memberships).where(and(eq(memberships.organizationId,actor.organizationId),eq(memberships.userId,data.ownerId),inArray(memberships.role,['admin','manager'])));if(!owner)throw new OutreachError('forbidden');
   const {revision,...values}=data;const [saved]=await tx.update(cases).set({...values,revision:revision+1,updatedBy:actor.userId,updatedAt:new Date()}).where(and(caseScope(actor,id),eq(cases.revision,revision))).returning();if(!saved)throw new OutreachError('contact_changed');
   await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:id,action:'contact.case_updated'});return saved;
  }),
  sync:async(actor:ActorScope,id:string)=>{
   const {conversation:c}=await database.transaction(tx=>load(tx,actor,id,true));
   try{
    let threadId=c.providerThreadId,selection=c.instagramSelection;
    let incoming:{sourceKey:string;providerMessageId:string;direction:'in'|'out';body:string;sentAt:Date;headers?:Record<string,string>}[];
    if(c.channel==='email'){
     const {row,token}=await database.transaction(async tx=>{const ctx=await accountService(database,fetcher).credentials(tx,actor,c.accountId);if(ctx.row.provider!=='google'||!ctx.token.scopes.includes(GOOGLE_READ_SCOPE))throw new OutreachError('mail_read_required');const verified=await fetchIdentity('google',ctx.token,fetcher);if(verified.id!==ctx.row.providerId||!verified.addresses.some(a=>a.address===c.fromAddress))throw new OutreachError('reconnect');return ctx;});
     const seed=await database.transaction(async tx=>{await outreachMember(tx,actor,true);return(await tx.select().from(messages).where(and(scoped(messages,actor),eq(messages.conversationId,c.id),eq(messages.direction,'out'))).orderBy(asc(messages.sentAt)).limit(1))[0];});if(!seed?.providerMessageId)throw new OutreachError('mail_thread_mismatch');
     const thread=await gmailConversations(token.accessToken,fetcher).thread(threadId,seed.providerMessageId,c.recipient,row.addresses.map(a=>a.address));threadId=thread.threadId;
     incoming=thread.messages.map(m=>({sourceKey:'gmail:'+m.id,providerMessageId:m.id,direction:m.incoming?'in':'out',body:m.body,sentAt:m.sentAt,headers:m.headers}));
    }else{
     const provider=instagramDmService(database,fetcher);if(!selection){let after:string|undefined;const found:DmSelection[]=[];for(let page=0;page<4;page++){const result=await provider.list(actor,c.accountId,after);for(const x of result.items)if(x.username&&x.recipientId&&normalizeIdentity(x.username)===c.recipient)found.push({conversationId:x.id,recipientId:x.recipientId,username:x.username});if(found.length||!result.nextCursor)break;after=result.nextCursor;}if(found.length!==1)throw new OutreachError('instagram_dm_conversation_missing');selection=found[0];}
     const thread=await provider.thread(actor,c.accountId,selection);selection=thread.selection;threadId=selection.conversationId;incoming=thread.messages.map(m=>({sourceKey:'instagram:'+m.id,providerMessageId:m.id,direction:m.incoming?'in':'out',body:m.text,sentAt:new Date(m.createdAt)}));
    }
    await database.transaction(async tx=>{await outreachMember(tx,actor,true);const [current]=await tx.select().from(conversations).where(convoScope(actor,c.id)).for('update');if(current.accountId!==c.accountId||current.recipient!==c.recipient)throw new OutreachError('contact_changed');let added=0;for(const m of incoming)if(await append(tx,actor,current,m))added++;
     await tx.update(conversations).set({providerThreadId:threadId,instagramSelection:selection,version:sql`${conversations.version}+${added}`,lastSyncedAt:new Date(),syncError:null,updatedAt:new Date()}).where(convoScope(actor,c.id));
    });return service.detail(actor,id);
   }catch(error){await database.transaction(async tx=>{await outreachMember(tx,actor,true);await tx.update(conversations).set({syncError:error instanceof OutreachError?error.code:'provider_unavailable',updatedAt:new Date()}).where(convoScope(actor,c.id));});throw error;}
  },
  reply:async(actor:ActorScope,input:unknown)=>{
   const data=replySchema.parse(input);if(hasPlaceholders(data.body))throw new OutreachError('placeholders_remaining');
   const hash=createHash('sha256').update(JSON.stringify(data)).digest('hex');
   const previous=await database.transaction(async tx=>{await load(tx,actor,data.caseId,true);return(await tx.select().from(replies).where(and(scoped(replies,actor),eq(replies.id,data.id))))[0];});if(previous){if(previous.inputSha256!==hash)throw new OutreachError('contact_changed');if(previous.status==='sent')return service.detail(actor,data.caseId);throw new OutreachError(previous.status==='failed'?'send_failed':'send_unknown');}
   const fresh=await service.sync(actor,data.caseId),c=fresh.conversation;
   if(c.version!==data.version)throw new OutreachError('contact_changed');
   if(['closed','declined','hold'].includes(fresh.item.progress))throw new OutreachError('contact_closed');
   const latest=fresh.messages.at(-1),lastIncoming=fresh.messages.filter(m=>m.direction==='in').at(-1);if(!latest?.providerMessageId||!lastIncoming)throw new OutreachError('contact_inbound_required');
   if(c.channel==='instagram'){z.string().max(1000).parse(data.body);assertDmWindow(lastIncoming.sentAt.toISOString());}
   const claim=await database.transaction(async tx=>{
    await load(tx,actor,data.caseId,true);const [account]=await tx.select().from(senderAccounts).where(and(eq(senderAccounts.organizationId,actor.organizationId),eq(senderAccounts.id,c.accountId))).for('update');if(account?.status!=='connected')throw new OutreachError('reconnect');
    const [current]=await tx.select().from(conversations).where(convoScope(actor,c.id)).for('update');if(current.version!==data.version)throw new OutreachError('contact_changed');
    const [caseNow]=await tx.select().from(cases).where(caseScope(actor,data.caseId)).for('update');if(['hold','closed','declined'].includes(caseNow.progress))throw new OutreachError('contact_closed');
    const [blocked]=await tx.select({id:replies.id}).from(replies).where(and(scoped(replies,actor),eq(replies.conversationId,c.id),inArray(replies.status,['sending','unknown'])));if(blocked)throw new OutreachError('send_unknown');
    const [b]=await tx.select({id:browserOutreachSends.id}).from(browserOutreachSends).where(and(eq(browserOutreachSends.organizationId,actor.organizationId),eq(browserOutreachSends.accountId,c.accountId),eq(browserOutreachSends.recipientUsername,c.recipient),inArray(browserOutreachSends.state,['queued','preparing','armed','unknown'])));if(b)throw new OutreachError('browser_outreach_pending');
    const [r]=await tx.insert(replies).values({id:data.id,organizationId:actor.organizationId,caseId:data.caseId,conversationId:c.id,accountId:c.accountId,expectedVersion:data.version,body:data.body,inputSha256:hash,status:'sending',createdBy:actor.userId}).returning();await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:r.id,action:'contact.reply_confirmed'});return r;
   });
   let submitted=false,providerMessageId:string;
   try{
    if(c.channel==='instagram'){
     if(!c.instagramSelection)throw new OutreachError('instagram_dm_conversation_missing');
     const result=await instagramDmService(database,fetcher).send(actor,{id:claim.id,accountId:c.accountId,selection:c.instagramSelection,body:data.body,confirmed:true,expectedLastMessageId:latest.providerMessageId});providerMessageId=result.providerMessageId!;submitted=true;
    }else{
     const ctx=await database.transaction(async tx=>{const ctx=await accountService(database,fetcher).credentials(tx,actor,c.accountId);if(ctx.row.provider!=='google'||!ctx.token.scopes.includes(GOOGLE_READ_SCOPE))throw new OutreachError('mail_read_required');const verified=await fetchIdentity('google',ctx.token,fetcher);if(verified.id!==ctx.row.providerId||!verified.addresses.some(a=>a.address===c.fromAddress))throw new OutreachError('reconnect');return ctx;});
     const seed=fresh.messages.find(m=>m.direction==='out'&&m.providerMessageId);if(!seed?.providerMessageId||!c.providerThreadId)throw new OutreachError('mail_thread_mismatch');
     const provider=gmailConversations(ctx.token.accessToken,fetcher),thread=await provider.thread(c.providerThreadId,seed.providerMessageId,c.recipient,ctx.row.addresses.map(a=>a.address));if(thread.messages.at(-1)?.id!==latest.providerMessageId)throw new OutreachError('contact_changed');
     const actual=thread.messages.filter(m=>m.incoming).at(-1);if(!actual?.headers['message-id'])throw new OutreachError('mail_thread_mismatch');const inReplyTo=actual.headers['message-id'],references=[...(actual.headers.references??'').matchAll(/<[^<>\s]+@[^<>\s]+>/g)].map(m=>m[0]);if(!references.includes(inReplyTo))references.push(inReplyTo);
     submitted=true;const sent=await provider.send({id:claim.id,threadId:c.providerThreadId,from:c.fromAddress,to:c.recipient,subject:(actual.headers.subject||c.subject).slice(0,200),body:data.body,inReplyTo,references:references.join(' ')});providerMessageId=sent.id;
    }
    await database.transaction(async tx=>{await outreachMember(tx,actor,true);const [current]=await tx.select().from(conversations).where(convoScope(actor,c.id)).for('update');await append(tx,actor,current,{sourceKey:'reply:'+claim.id,providerMessageId,direction:'out',body:c.channel==='email'?data.body+'\n\n'+c.fromAddress:data.body,sentAt:new Date(),caseId:data.caseId});await tx.update(replies).set({status:'sent',providerMessageId,updatedAt:new Date()}).where(and(scoped(replies,actor),eq(replies.id,claim.id),eq(replies.status,'sending')));await tx.update(conversations).set({version:sql`${conversations.version}+1`,updatedAt:new Date()}).where(convoScope(actor,c.id));await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:claim.id,action:'contact.reply_sent'});});
    return service.detail(actor,data.caseId);
   }catch(error){
    if(error instanceof MailSendError)submitted=error.ambiguous;
    if(c.channel==='instagram'){const native=await database.transaction(async tx=>{await outreachMember(tx,actor,true);return(await tx.select().from(instagramDmSends).where(and(eq(instagramDmSends.organizationId,actor.organizationId),eq(instagramDmSends.id,claim.id))))[0];});submitted=!!native&&native.status!=='failed';}
    await database.transaction(async tx=>{await outreachMember(tx,actor,true);await tx.update(replies).set({status:submitted?'unknown':'failed',errorCode:submitted?'send_unknown':error instanceof OutreachError?error.code:'provider_unavailable',updatedAt:new Date()}).where(and(scoped(replies,actor),eq(replies.id,claim.id),eq(replies.status,'sending')));}).catch(()=>{});if(submitted)throw new OutreachError('send_unknown');throw error;
   }
  },
 };
 return service;
}
export type ContactListRow={id:string;campaignId:string|null;creatorAccountId:string|null;displayName:string;origin:'selection'|'legacy'|'connection_test';progress:keyof typeof contactProgress;ownerId:string;ownerName:string;nextActionOn:string|null;firstSentAt:Date;channel:'email'|'instagram';recipient:string;fromAddress:string;accountId:string;lastSyncedAt:Date|null;syncError:string|null;accountStatus:string;accountLabel:string;mailReadEnabled:boolean;campaignTitle:string|null;projectName:string|null;lastDirection:'in'|'out';preview:string;lastMessageAt:Date;blocked:boolean};
export type ContactDetail=Awaited<ReturnType<ReturnType<typeof contactService>['detail']>>;

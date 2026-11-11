import {randomUUID} from 'node:crypto';
import {and,desc,eq,inArray,sql} from 'drizzle-orm';
import {z} from 'zod';
import {db} from '../db';
import {projects,campaigns,auditEvents} from '../db/schema';
import {chatPreviews,outreachReviewDrafts as drafts,outreachReviewBatches as batches,browserOutreachSends as sends,senderAccounts} from '../db/outreach-schema';
import type {ActorScope} from '../auth/permissions';
import {outreachMember,type OutreachTx} from './access';
import {OutreachError,normalizeIdentity} from './contracts';
import {reviewContext,reviewHash} from './review-policy';
import {reviewSaveInput,reviewSendInput} from './review-contracts';
import {browserSendService} from './browser-sends';
import {accountService} from './accounts';
import {outreachExecutorService} from './executors';
const fields={id:drafts.id,projectId:drafts.projectId,campaignId:drafts.campaignId,creatorAccountId:drafts.creatorAccountId,sourcePreviewId:drafts.sourcePreviewId,contextSha256:drafts.contextSha256,body:drafts.body,basis:drafts.basis,evidenceIds:drafts.evidenceIds,revision:drafts.revision,status:drafts.status,senderAccountId:drafts.senderAccountId,sentAt:drafts.sentAt,updatedAt:drafts.updatedAt};
function sendId(org:string,batch:string,draft:string){const value=Buffer.from(reviewHash(`${org}:${batch}:${draft}`).slice(0,32),'hex');value[6]=value[6]&15|64;value[8]=value[8]&63|128;const hex=value.toString('hex');return`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
const present=(context:Awaited<ReturnType<typeof reviewContext>>)=>({sourcePreviewId:context.sourcePreviewId,projectId:context.projectId,projectName:context.projectName,campaignId:context.campaignId,campaignName:context.campaignName,creatorId:context.creatorId,handle:normalizeIdentity(context.handle??''),name:context.name??context.handle??'',profileUrl:context.profileUrl,contextSha256:context.contextSha256,brandSummary:context.brief.project.summary,products:context.brief.products.map(p=>({name:p.name,features:p.features})),evidence:context.evidence});
export function reviewOutreachService(database:Pick<typeof db,'transaction'>=db){
 const scope=(actor:ActorScope,id:string)=>and(eq(drafts.organizationId,actor.organizationId),eq(drafts.id,z.uuid().parse(id)));
 async function sources(tx:OutreachTx,actor:ActorScope,projectId:string){
  const rows=await tx.select({id:chatPreviews.id,targets:chatPreviews.targets,results:chatPreviews.results}).from(chatPreviews).innerJoin(campaigns,and(eq(campaigns.organizationId,chatPreviews.organizationId),eq(campaigns.id,chatPreviews.campaignId))).where(and(eq(chatPreviews.organizationId,actor.organizationId),eq(campaigns.projectId,projectId),inArray(chatPreviews.state,['completed','partial']))).orderBy(desc(chatPreviews.createdAt)).limit(100);
  const picked=new Map<string,{sourceId:string;candidateId:string}>();for(const row of rows)for(const result of row.results)if(result.state==='drafted'){const key=result.candidate_id;if(!picked.has(key))picked.set(key,{sourceId:row.id,candidateId:key});}return [...picked.values()];
 }
 const service={
  projects:(actor:ActorScope)=>database.transaction(async tx=>{await outreachMember(tx,actor);const result=await tx.execute<{id:string;name:string;drafts:number;pending:number;sent:number;unknown:number}>(sql`select p.id,p.name,count(*) filter(where r.status='draft')::int drafts,count(*) filter(where r.status='sending')::int pending,count(*) filter(where r.status='sent')::int sent,count(*) filter(where r.status='unknown')::int unknown from ${projects} p join (select distinct on(project_id,creator_account_id) project_id,creator_account_id,status,updated_at from ${drafts} where organization_id=${actor.organizationId}::uuid order by project_id,creator_account_id,updated_at desc,id desc) r on r.project_id=p.id where p.organization_id=${actor.organizationId}::uuid group by p.id,p.name order by max(r.updated_at) desc limit 20`);return result.rows;}),
  context:(actor:ActorScope,sourceId:string,candidateId:string)=>database.transaction(async tx=>{await outreachMember(tx,actor);return reviewContext(tx,actor,z.uuid().parse(sourceId),z.uuid().parse(candidateId));}),
  workspace:(actor:ActorScope,projectId:string)=>database.transaction(async tx=>{
   await outreachMember(tx,actor);z.uuid().parse(projectId);const [project]=await tx.select({id:projects.id,name:projects.name}).from(projects).where(and(eq(projects.organizationId,actor.organizationId),eq(projects.id,projectId)));if(!project)throw new OutreachError('not_found');
   const rows=await tx.select(fields).from(drafts).where(and(eq(drafts.organizationId,actor.organizationId),eq(drafts.projectId,projectId))).orderBy(desc(drafts.updatedAt),desc(drafts.id)).limit(100),latest=new Map<string,typeof rows[number]>();for(const row of rows)if(!latest.has(row.creatorAccountId))latest.set(row.creatorAccountId,row);
   const ids=[...latest.values()].map(r=>r.id),jobs=ids.length?await tx.select({id:sends.id,reviewDraftId:sends.reviewDraftId,state:sends.state,reason:sends.reason,sender:sends.senderUsername,recipient:sends.recipientUsername,body:sends.body,sentAt:sends.sentAt,createdAt:sends.createdAt}).from(sends).where(and(eq(sends.organizationId,actor.organizationId),inArray(sends.reviewDraftId,ids))):[];
   const result=[];for(const draft of latest.values()){let context=null;try{context=present(await reviewContext(tx,actor,draft.sourcePreviewId,draft.creatorAccountId));}catch(error){if(!(error instanceof OutreachError))throw error;}result.push({draft,context,stale:!context||context.contextSha256!==draft.contextSha256,job:jobs.find(j=>j.reviewDraftId===draft.id)??null});}
   result.sort((a,b)=>(a.context?.handle??a.draft.id).localeCompare(b.context?.handle??b.draft.id));return{project,rows:result};
  }),
  save:(actor:ActorScope,input:unknown)=>database.transaction(async tx=>{
   const data=reviewSaveInput.parse(input);await outreachMember(tx,actor,true);const context=await reviewContext(tx,actor,data.sourcePreviewId,data.candidateId);if(context.contextSha256!==data.contextSha256||data.evidenceIds.some(id=>!context.evidence.some(e=>e.id===id)))throw new OutreachError('stale');
   const [old]=await tx.select().from(drafts).where(scope(actor,data.id)).for('update');
   const same=old&&old.body===data.body&&old.basis===data.basis&&old.contextSha256===data.contextSha256&&JSON.stringify(old.evidenceIds)===JSON.stringify(data.evidenceIds);
   if(old){if(old.sourcePreviewId!==data.sourcePreviewId||old.creatorAccountId!==data.candidateId)throw new OutreachError('draft_changed');if(old.revision!==data.revision){if(old.revision===data.revision+1&&same)return old;throw new OutreachError('draft_changed');}if(old.status!=='draft')throw new OutreachError('draft_locked');if(same)return old;
    const [saved]=await tx.update(drafts).set({body:data.body,basis:data.basis,evidenceIds:data.evidenceIds,contextSha256:data.contextSha256,revision:old.revision+1,updatedBy:actor.userId,updatedAt:new Date()}).where(scope(actor,data.id)).returning();await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:data.id,action:'outreach.review_draft_saved'});return saved;
   }
   if(data.revision!==0)throw new OutreachError('not_found');const [active]=await tx.select({id:drafts.id}).from(drafts).where(and(eq(drafts.organizationId,actor.organizationId),eq(drafts.campaignId,context.campaignId),eq(drafts.creatorAccountId,data.candidateId),eq(drafts.status,'draft')));if(active)throw new OutreachError('draft_changed');
   const [saved]=await tx.insert(drafts).values({id:data.id,organizationId:actor.organizationId,projectId:context.projectId,campaignId:context.campaignId,creatorAccountId:data.candidateId,sourcePreviewId:data.sourcePreviewId,contextSha256:data.contextSha256,body:data.body,basis:data.basis,evidenceIds:data.evidenceIds,createdBy:actor.userId,updatedBy:actor.userId}).returning();await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:data.id,action:'outreach.review_draft_created'});return saved;
  }),
  importPrepared:async(actor:ActorScope,projectId:string)=>{
   const choices=await database.transaction(async tx=>{await outreachMember(tx,actor,true);return sources(tx,actor,z.uuid().parse(projectId));});let imported=0;
   for(const choice of choices.slice(0,5)){const context=await service.context(actor,choice.sourceId,choice.candidateId);if(!context.preparedBody)continue;const [active]=await database.transaction(tx=>tx.select({id:drafts.id}).from(drafts).where(and(eq(drafts.organizationId,actor.organizationId),eq(drafts.campaignId,context.campaignId),eq(drafts.creatorAccountId,choice.candidateId),eq(drafts.status,'draft'))));if(active)continue;await service.save(actor,{id:randomUUID(),sourcePreviewId:choice.sourceId,candidateId:choice.candidateId,revision:0,contextSha256:context.contextSha256,body:context.preparedBody,basis:context.evidence.find(e=>e.kind==='content_observation')?.note??'',evidenceIds:context.evidence.slice(0,4).map(e=>e.id)});imported++;}return{imported};
  },
  copy:async(actor:ActorScope,id:string)=>{
   const old=await database.transaction(async tx=>{await outreachMember(tx,actor,true);const [row]=await tx.select().from(drafts).where(scope(actor,id));if(!row)throw new OutreachError('not_found');return row;});const context=await service.context(actor,old.sourcePreviewId,old.creatorAccountId);return service.save(actor,{id:randomUUID(),sourcePreviewId:old.sourcePreviewId,candidateId:old.creatorAccountId,revision:0,contextSha256:context.contextSha256,body:old.body,basis:old.basis,evidenceIds:old.evidenceIds.filter(id=>context.evidence.some(e=>e.id===id))});
  },
  send:(actor:ActorScope,input:unknown)=>database.transaction(async tx=>{
   const data=reviewSendInput.parse(input);await outreachMember(tx,actor,true);if(process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED!=='true')throw new OutreachError('browser_outreach_offline');const fingerprint=reviewHash(JSON.stringify(data));
   // Serialize an idempotency key without racing creation of the approval row.
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor.organizationId}),hashtext(${data.id}))`);
   const [old]=await tx.select().from(batches).where(and(eq(batches.organizationId,actor.organizationId),eq(batches.id,data.id)));
   if(old){if(old.inputSha256!==fingerprint)throw new OutreachError('instagram_dm_request_changed');const jobs=await tx.select({id:sends.id,state:sends.state}).from(sends).where(and(eq(sends.organizationId,actor.organizationId),eq(sends.reviewBatchId,data.id)));if(jobs.length!==data.items.length)throw new OutreachError('browser_outreach_pending');return{batchId:data.id,jobs};}
   const [sender]=await tx.select({id:senderAccounts.id}).from(senderAccounts).where(and(eq(senderAccounts.organizationId,actor.organizationId),eq(senderAccounts.id,data.accountId),eq(senderAccounts.provider,'instagram'))).for('update');if(!sender)throw new OutreachError('not_found');
   const rows=await tx.select().from(drafts).where(and(eq(drafts.organizationId,actor.organizationId),eq(drafts.projectId,data.projectId),inArray(drafts.id,data.items.map(i=>i.draftId)))).orderBy(drafts.id).for('update');if(rows.length!==data.items.length)throw new OutreachError('not_found');
   const [uncertain]=await tx.select({id:drafts.id}).from(drafts).where(and(eq(drafts.organizationId,actor.organizationId),inArray(drafts.creatorAccountId,rows.map(r=>r.creatorAccountId)),eq(drafts.status,'unknown'))).limit(1);if(uncertain)throw new OutreachError('browser_outreach_pending');
   if(new Set(rows.map(r=>r.creatorAccountId)).size!==rows.length)throw new OutreachError('instagram_dm_request_changed');
   for(const row of rows){if(row.status!=='draft'||row.revision!==data.items.find(i=>i.draftId===row.id)!.revision)throw new OutreachError('draft_changed');const context=await reviewContext(tx,actor,row.sourcePreviewId,row.creatorAccountId);if(context.contextSha256!==row.contextSha256)throw new OutreachError('stale');}
   await tx.insert(batches).values({id:data.id,organizationId:actor.organizationId,projectId:data.projectId,accountId:data.accountId,items:data.items,inputSha256:fingerprint,createdBy:actor.userId});
   const jobs=[];for(const row of rows){const context=await reviewContext(tx,actor,row.sourcePreviewId,row.creatorAccountId);jobs.push(await browserSendService(tx).create(actor,{id:sendId(actor.organizationId,data.id,row.id),accountId:data.accountId,recipient:normalizeIdentity(context.handle??''),body:row.body,confirmed:true,reviewDraftId:row.id,reviewDraftRevision:row.revision,reviewBatchId:data.id}));}
   await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:data.id,action:'outreach.review_batch_send_confirmed'});return{batchId:data.id,jobs:jobs.map(j=>({id:j.id,state:j.state}))};
  }),
 };return service;
}
export type ReviewWorkspace=Awaited<ReturnType<ReturnType<typeof reviewOutreachService>['workspace']>>;
export async function reviewPageData(actor:ActorScope,projectId:string){
 const [workspace,accounts,connections]=await Promise.all([reviewOutreachService().workspace(actor,projectId),accountService().list(actor),outreachExecutorService().list(actor)]);
 return{workspace,accounts:accounts.filter(a=>a.provider==='instagram'&&a.status!=='disconnected').map(a=>{const active=connections.filter(c=>c.accountId===a.id&&c.status==='connected'&&c.expiresAt&&new Date(c.expiresAt).getTime()>Date.now()),fresh=active.filter(c=>c.lastSeenAt&&new Date(c.lastSeenAt).getTime()>Date.now()-45000&&c.lastReason==='ready'&&c.observedUsername===normalizeIdentity(a.expectedIdentity));return{id:a.id,label:a.label,expectedIdentity:a.expectedIdentity,ready:fresh.some(c=>c.protocolVersion>=2),needsUpdate:active.length>0&&!active.some(c=>c.protocolVersion>=2)};})};
}
export type ReviewPageData=Awaited<ReturnType<typeof reviewPageData>>;

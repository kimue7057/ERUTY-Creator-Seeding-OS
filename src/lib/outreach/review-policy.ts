import {createHash} from 'node:crypto';
import {and,asc,eq,sql} from 'drizzle-orm';
import {projects,campaigns} from '../db/schema';
import {campaignCreators,creatorAccounts,discoveryEvidence} from '../db/discovery-schema';
import {chatPreviews,outreachReviewDrafts,outreachReviewBatches} from '../db/outreach-schema';
import {outreachMember,type OutreachTx} from './access';
import type {ActorScope} from '../auth/permissions';
import {normalizeIdentity,OutreachError} from './contracts';
export const reviewHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function reviewContext(tx:OutreachTx,actor:ActorScope,sourceId:string,candidateId:string){
 const [source]=await tx.select().from(chatPreviews).where(and(eq(chatPreviews.organizationId,actor.organizationId),eq(chatPreviews.id,sourceId)));
 const target=source?.targets.find(t=>t.candidate_id===candidateId);
 if(!source||!target||!['completed','partial'].includes(source.state)||!source.results.some(r=>r.candidate_id===candidateId&&r.recipient===target.recipient&&(r.state==='opened'||r.state==='drafted')))throw new OutreachError('not_found');
 const [row]=await tx.select({projectId:projects.id,projectName:projects.name,projectUpdatedAt:projects.updatedAt,campaignId:campaigns.id,campaignName:campaigns.title,briefVersion:campaigns.briefVersion,brief:campaigns.briefSnapshot,creatorId:creatorAccounts.id,handle:creatorAccounts.currentHandle,name:creatorAccounts.displayName,profileUrl:creatorAccounts.canonicalProfileUrl,identityState:creatorAccounts.identityState,discoveryState:campaignCreators.discoveryState}).from(campaignCreators)
 .innerJoin(campaigns,and(eq(campaigns.organizationId,campaignCreators.organizationId),eq(campaigns.id,campaignCreators.campaignId)))
 .innerJoin(projects,and(eq(projects.organizationId,campaigns.organizationId),eq(projects.id,campaigns.projectId)))
 .innerJoin(creatorAccounts,and(eq(creatorAccounts.organizationId,campaignCreators.organizationId),eq(creatorAccounts.id,campaignCreators.creatorAccountId)))
 .where(and(eq(campaignCreators.organizationId,actor.organizationId),eq(campaignCreators.campaignId,source.campaignId),eq(campaignCreators.creatorAccountId,candidateId),eq(creatorAccounts.platform,'instagram'),sql`${creatorAccounts.archivedAt} is null`,sql`${creatorAccounts.identityState} not in ('conflict','merged')`,sql`${campaignCreators.discoveryState} not in ('blocked','duplicate')`,sql`${campaigns.status}<>'archived'`));
 if(!row||normalizeIdentity(row.handle??'')!==target.recipient||row.profileUrl.replace(/\/$/,'')!==target.profile_url.replace(/\/$/,''))throw new OutreachError('instagram_dm_recipient_changed');
 const evidence=await tx.select({id:discoveryEvidence.id,url:discoveryEvidence.sourceUrl,observedAt:discoveryEvidence.observedAt,kind:discoveryEvidence.kind,facts:discoveryEvidence.facts,limitations:discoveryEvidence.limitations,sha256:discoveryEvidence.payloadSha256}).from(discoveryEvidence).where(and(eq(discoveryEvidence.organizationId,actor.organizationId),eq(discoveryEvidence.projectId,row.projectId),eq(discoveryEvidence.campaignId,row.campaignId),eq(discoveryEvidence.creatorAccountId,candidateId),eq(discoveryEvidence.platform,'instagram'))).orderBy(asc(discoveryEvidence.id)).limit(100);
 const contextSha256=reviewHash(JSON.stringify({source:source.id,project:[row.projectId,row.projectName,row.projectUpdatedAt],campaign:[row.campaignId,row.briefVersion,row.brief],creator:[row.creatorId,row.handle,row.profileUrl,row.identityState,row.discoveryState],evidence:evidence.map(e=>[e.id,e.sha256])}));
 return{...row,sourcePreviewId:source.id,contextSha256,evidence:evidence.map(e=>({id:e.id,url:e.url,observedAt:e.observedAt,kind:e.kind,note:e.facts.note,limitations:e.limitations})),preparedBody:source.messages.find(m=>m.candidate_id===candidateId)?.body??''};
}
export async function reviewSendApproval(tx:OutreachTx,actor:ActorScope,row:{reviewDraftId:string|null;reviewDraftRevision:number|null;reviewBatchId:string|null;createdBy:string;accountId:string;recipientUsername:string;body:string},sending:boolean){
 if(!row.reviewDraftId)return;
 await outreachMember(tx,{...actor,userId:row.createdBy},true);
 const [draft]=await tx.select().from(outreachReviewDrafts).where(and(eq(outreachReviewDrafts.organizationId,actor.organizationId),eq(outreachReviewDrafts.id,row.reviewDraftId))).for('update');
 if(!draft||draft.revision!==row.reviewDraftRevision||draft.body!==row.body||draft.status!==(sending?'sending':'draft')||sending&&draft.senderAccountId!==row.accountId)throw new OutreachError('draft_changed');
 const [batch]=await tx.select().from(outreachReviewBatches).where(and(eq(outreachReviewBatches.organizationId,actor.organizationId),eq(outreachReviewBatches.id,row.reviewBatchId??'')));
 if(!batch||batch.accountId!==row.accountId||batch.projectId!==draft.projectId||batch.createdBy!==row.createdBy||!batch.items.some(i=>i.draftId===draft.id&&i.revision===draft.revision))throw new OutreachError('draft_changed');
 const context=await reviewContext(tx,actor,draft.sourcePreviewId,draft.creatorAccountId);
 if(context.contextSha256!==draft.contextSha256||normalizeIdentity(context.handle??'')!==row.recipientUsername)throw new OutreachError('stale');
}

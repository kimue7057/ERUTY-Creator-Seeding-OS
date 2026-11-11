import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withDiscoveryDatabase,sqlFailure} from '../discovery-fixture';
import {seedShortlistCandidate} from '../shortlist-samples';
import {accountService} from '../../src/lib/outreach/accounts';
import {outreachExecutorService} from '../../src/lib/outreach/executors';
import {outreachExtensionId} from '../../src/lib/outreach/executor-contracts';
import {chatPreviewService} from '../../src/lib/outreach/chat-previews';
import {reviewOutreachService} from '../../src/lib/outreach/review-service';
import {browserSendService} from '../../src/lib/outreach/browser-sends';
import {OutreachError} from '../../src/lib/outreach/contracts';
process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED='true';
type Fixture=Parameters<Parameters<typeof withDiscoveryDatabase>[0]>[0];
const code=(value:string)=>(error:unknown)=>error instanceof OutreachError&&error.code===value;
async function setup(f:Fixture){
 const first=await seedShortlistCandidate(f),second=await seedShortlistCandidate(f,'instagram',first.campaign),connections=outreachExecutorService(f.database);
 const sender=await accountService(f.database).register(f.actor,{provider:'instagram',label:'SYNTHETIC review sender',identity:'synthetic_company'});
 const pair=await connections.startPair(f.actor,{accountId:sender.id,name:'SYNTHETIC review Chrome',confirmed:true}),credentials=await connections.pair({code:pair.code,extension_id:outreachExtensionId}),identity=await connections.authenticate(credentials.token);
 const beat=(version:1|2)=>connections.heartbeat(identity,{observed_username:'synthetic_company',reason:'ready',protocol_version:version});await beat(2);
 const previews=chatPreviewService(f.database),sourceId=randomUUID();await previews.create(f.actor,{id:sourceId,accountId:sender.id,campaignId:first.campaign.id,candidateIds:[first.accountId,second.accountId],goal:2});
 const grant=(await previews.next(identity)).assignment!;await previews.finish(identity,{job_id:grant.job_id,claim_token:grant.claim_token,results:grant.targets.map(t=>({candidate_id:t.candidate_id,recipient:t.recipient,state:'opened',reason:'chat_opened',source_url:t.profile_url,observed_at:new Date().toISOString()}))});
 const service=reviewOutreachService(f.database),saved=[];
 for(const seed of [first,second]){const context=await service.context(f.actor,sourceId,seed.accountId);saved.push(await service.save(f.actor,{id:randomUUID(),sourcePreviewId:sourceId,candidateId:seed.accountId,revision:0,contextSha256:context.contextSha256,body:'SYNTHETIC personal opening\n\nShort collaboration idea.\n\nA short question?',basis:'SYNTHETIC observed creator content',evidenceIds:context.evidence.map(e=>e.id)}));}
 const input={id:randomUUID(),projectId:first.campaign.projectId,accountId:sender.id,items:saved.map(d=>({draftId:d.id,revision:d.revision})),confirmed:true};
 return{first,second,connections,sender,identity,beat,service,saved,input,sends:browserSendService(f.database)};
}
test('project review preserves paragraphs, scoped evidence and exact revisions; confirmed batch queues atomically and returns separate results',async()=>withDiscoveryDatabase(async f=>{
 const h=await setup(f),before=(await f.client.query('select id,discovery_state from campaign_creators order by id')).rows;
 await assert.rejects(h.service.workspace(f.other,h.input.projectId),code('not_found'));await assert.rejects(h.service.send(f.reader,h.input),code('forbidden'));
 await assert.rejects(h.service.send(f.actor,{...h.input,confirmed:false}));await assert.rejects(h.service.send(f.actor,{...h.input,items:[h.input.items[0],{...h.input.items[1],revision:99}]}),code('draft_changed'));
 assert.equal((await f.client.query('select count(*)::int n from outreach_review_batches')).rows[0].n,0);
 await h.beat(1);await assert.rejects(h.service.send(f.actor,h.input),code('browser_outreach_offline'));assert.equal((await f.client.query('select count(*)::int n from outreach_browser_sends')).rows[0].n,0);await h.beat(2);
 const sent=await h.service.send(f.actor,h.input),again=await h.service.send(f.actor,h.input);assert.deepEqual(new Set(sent.jobs.map(j=>j.id)),new Set(again.jobs.map(j=>j.id)));assert.equal(sent.jobs.length,2);
 await assert.rejects(h.service.send(f.actor,{...h.input,items:[...h.input.items].reverse()}),code('instagram_dm_request_changed'));
 assert.equal((await h.sends.next(h.identity.actor,h.identity.lease)).assignment,null,'Old executable cannot claim reviewed paragraph jobs');
 for(let i=0;i<2;i++){
  await h.beat(2);const grant=(await h.sends.next(h.identity.actor,h.identity.lease,2)).assignment!;assert.ok(grant);const context=await h.sends.context(h.identity.actor,grant);assert.ok(context.body.includes('\n\n'));
  const observation={sender:context.sender,recipient:context.recipient,body:context.body,source_url:context.recipient_url,observed_at:new Date().toISOString(),visible_text:context.body};
  await h.sends.arm(h.identity.actor,{...grant,observation});await assert.rejects(h.sends.arm(h.identity.actor,{...grant,observation}),code('browser_outreach_pending'));
  await h.sends.finish(h.identity.actor,{...grant,outcome:i?'blocked':'sent',reason:i?'unconfirmed_result':'confirmed_on_screen',observation:i?null:{...observation,observed_at:new Date().toISOString()}});
 }
 const result=await h.service.workspace(f.actor,h.input.projectId);assert.deepEqual(result.rows.map(r=>r.draft.status).sort(),['sent','unknown']);assert.deepEqual(result.rows.map(r=>r.job!.state).sort(),['sent','unknown']);
 assert.deepEqual((await f.client.query('select id,discovery_state from campaign_creators order by id')).rows,before,'Explicit first contact does not alter evaluation/final selection');
 await assert.rejects(f.client.query("update outreach_review_drafts set body='changed' where id=$1",[h.saved[0].id]),sqlFailure('23514'));
 await assert.rejects(f.client.query("update outreach_browser_sends set review_batch_id=null where id=$1",[sent.jobs[0].id]),sqlFailure('23514'));
 await assert.rejects(f.client.query("delete from outreach_review_batches where id=$1",[h.input.id]),sqlFailure('23514'));
 const unknown=result.rows.find(r=>r.draft.status==='unknown')!;const copy=await h.service.copy(f.actor,unknown.draft.id);await assert.rejects(h.service.send(f.actor,{...h.input,id:randomUUID(),items:[{draftId:copy.id,revision:copy.revision}]}),code('browser_outreach_pending'));
}));
test('source changes invalidate review before sending and before one-time arm; saved edits use optimistic revisions',async()=>withDiscoveryDatabase(async f=>{
 const h=await setup(f),d=h.saved[0],context=await h.service.context(f.actor,d.sourcePreviewId,d.creatorAccountId),edit={id:d.id,sourcePreviewId:d.sourcePreviewId,candidateId:d.creatorAccountId,revision:d.revision,contextSha256:context.contextSha256,body:d.body+'\n\nSYNTHETIC revision',basis:d.basis,evidenceIds:d.evidenceIds};
 await assert.rejects(h.service.save(f.reader,edit),code('forbidden'));await assert.rejects(h.service.save(f.actor,{...edit,evidenceIds:[randomUUID()]}),code('stale'));
 const updated=await h.service.save(f.actor,edit);assert.equal(updated.revision,2);assert.equal((await h.service.save(f.actor,edit)).revision,2);await assert.rejects(h.service.save(f.actor,{...edit,body:'SYNTHETIC conflicting stale edit'}),code('draft_changed'));
 const input={...h.input,items:[{draftId:updated.id,revision:updated.revision}]};await h.service.send(f.actor,input);const grant=(await h.sends.next(h.identity.actor,h.identity.lease,2)).assignment!,body=await h.sends.context(h.identity.actor,grant);
 await f.client.query("update projects set summary='SYNTHETIC changed project',updated_at=now() where id=$1",[h.input.projectId]);
 await assert.rejects(h.sends.arm(h.identity.actor,{...grant,observation:{sender:body.sender,recipient:body.recipient,body:body.body,source_url:body.recipient_url,observed_at:new Date().toISOString(),visible_text:body.body}}),code('stale'));
 await h.sends.finish(h.identity.actor,{...grant,outcome:'blocked',reason:'unconfirmed_result',observation:null});await assert.rejects(h.service.send(f.actor,{...h.input,id:randomUUID(),items:[h.input.items[1]]}),code('stale'));
 assert.equal((await h.service.workspace(f.actor,h.input.projectId)).rows.every(r=>r.stale),true);
}));
test('a current company manager can request a reviewed DM from another operators paired company Chrome',async()=>withDiscoveryDatabase(async f=>{
 const h=await setup(f);await f.client.query("update organization_memberships set role='manager' where organization_id=$1 and user_id=$2",[f.actor.organizationId,f.reader.userId]);
 await h.service.send({...f.reader,role:'manager'},{...h.input,items:[h.input.items[0]]});const grant=(await h.sends.next(h.identity.actor,h.identity.lease,2)).assignment!,context=await h.sends.context(h.identity.actor,grant);
 const observation={sender:context.sender,recipient:context.recipient,body:context.body,source_url:context.recipient_url,observed_at:new Date().toISOString(),visible_text:context.body};assert.equal((await h.sends.arm(h.identity.actor,{...grant,observation})).send_permitted,true);await h.sends.finish(h.identity.actor,{...grant,outcome:'blocked',reason:'unconfirmed_result',observation:null});
}));

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {withDiscoveryDatabase,sqlFailure} from '../discovery-fixture';
import {seedShortlistCandidate} from '../shortlist-samples';
import {chatPreviewService} from '../../src/lib/outreach/chat-previews';
import {outreachExecutorService} from '../../src/lib/outreach/executors';
import {accountService} from '../../src/lib/outreach/accounts';
import {browserSendService} from '../../src/lib/outreach/browser-sends';
import {outreachExtensionId} from '../../src/lib/outreach/executor-contracts';
import {OutreachError} from '../../src/lib/outreach/contracts';
const code=(value:string)=>(error:unknown)=>error instanceof OutreachError&&error.code===value;
test('chat preview uses saved scoped candidates, cannot carry message text or obtain a send permit, and preserves outcomes',async()=>withDiscoveryDatabase(async f=>{
 const candidate=await seedShortlistCandidate(f),accounts=accountService(f.database),connections=outreachExecutorService(f.database),service=chatPreviewService(f.database);
 const sender=await accounts.register(f.actor,{provider:'instagram',label:'SYNTHETIC preview',identity:'synthetic_company'}),pair=await connections.startPair(f.actor,{accountId:sender.id,name:'SYNTHETIC preview Chrome',confirmed:true}),credentials=await connections.pair({code:pair.code,extension_id:outreachExtensionId}),identity=await connections.authenticate(credentials.token);await connections.heartbeat(identity,{observed_username:'synthetic_company',reason:'ready'});
 const input={id:randomUUID(),accountId:sender.id,campaignId:candidate.campaign.id,candidateIds:[candidate.accountId],goal:1};
 await assert.rejects(service.create(f.reader,input),code('forbidden'));await assert.rejects(service.create(f.other,input),code('not_found'));await assert.rejects(service.create(f.actor,{...input,body:'SYNTHETIC text must never be accepted'}));await assert.rejects(service.create(f.actor,{...input,candidateIds:[randomUUID()]}),code('not_found'));
 await service.create(f.actor,input);await service.create(f.actor,input);assert.equal((await service.history(f.actor)).length,1);assert.equal((await service.history(f.other)).length,0);
 const assignment=(await service.next(identity)).assignment!;assert.ok(assignment);assert.ok(!('body' in assignment));assert.equal((await service.next(identity)).assignment,null);
 await assert.rejects(browserSendService(f.database).arm(f.actor,{...identity.lease,job_id:assignment.job_id,claim_token:assignment.claim_token,observation:{sender:'synthetic_company',recipient:'synthetic_recipient',body:'SYNTHETIC',source_url:'https://www.instagram.com/synthetic_recipient/',observed_at:new Date().toISOString(),visible_text:'SYNTHETIC'}}),code('not_found'));
 const target=assignment.targets[0],grant={job_id:assignment.job_id,claim_token:assignment.claim_token};await assert.rejects(service.finish(identity,{...grant,results:[{candidate_id:target.candidate_id,recipient:'synthetic_wrong',state:'opened',reason:'chat_opened',source_url:target.profile_url,observed_at:new Date().toISOString()}]}),code('browser_outreach_observation_invalid'));
 assert.equal((await service.finish(identity,{...grant,results:[{candidate_id:target.candidate_id,recipient:target.recipient,state:'opened',reason:'chat_opened',source_url:target.profile_url,observed_at:new Date().toISOString()}]})).state,'completed');
 const counts=(await f.client.query('select (select count(*)::int from outreach_browser_sends) sends,(select count(*)::int from instagram_dm_sends) api_sends')).rows[0];assert.deepEqual(counts,{sends:0,api_sends:0});
 await assert.rejects(f.client.query("update outreach_chat_previews set targets='[]' where id=$1",[input.id]),sqlFailure('23514'));
}));

test('composer preview requires an opened scoped recipient, freezes text and verifies rendered hash without send authority',async()=>withDiscoveryDatabase(async f=>{
 const candidate=await seedShortlistCandidate(f),accounts=accountService(f.database),connections=outreachExecutorService(f.database),service=chatPreviewService(f.database);
 const sender=await accounts.register(f.actor,{provider:'instagram',label:'SYNTHETIC composer',identity:'synthetic_company'}),pair=await connections.startPair(f.actor,{accountId:sender.id,name:'SYNTHETIC composer Chrome',confirmed:true}),credentials=await connections.pair({code:pair.code,extension_id:outreachExtensionId}),identity=await connections.authenticate(credentials.token);await connections.heartbeat(identity,{observed_username:'synthetic_company',reason:'ready'});
 const sourceId=randomUUID();await service.create(f.actor,{id:sourceId,accountId:sender.id,campaignId:candidate.campaign.id,candidateIds:[candidate.accountId],goal:1});
 const body='SYNTHETIC proposal in one paragraph',input={id:randomUUID(),sourcePreviewId:sourceId,messages:[{candidateId:candidate.accountId,body}]};
 await assert.rejects(service.compose(f.actor,input),code('not_found'));
 const open=(await service.next(identity)).assignment!,target=open.targets[0];await service.finish(identity,{job_id:open.job_id,claim_token:open.claim_token,results:[{candidate_id:target.candidate_id,recipient:target.recipient,state:'opened',reason:'chat_opened',source_url:target.profile_url,observed_at:new Date().toISOString()}]});
 await assert.rejects(service.compose(f.reader,input),code('forbidden'));await assert.rejects(service.compose(f.other,input),code('not_found'));await assert.rejects(service.compose(f.actor,{...input,messages:[{candidateId:randomUUID(),body}]}),code('not_found'));
 await assert.rejects(service.compose(f.actor,{...input,messages:[{candidateId:candidate.accountId,body:'SYNTHETIC\nmultiline'}]}));await service.compose(f.actor,input);await service.compose(f.actor,input);await assert.rejects(service.compose(f.actor,{...input,messages:[{candidateId:candidate.accountId,body:body+' changed'}]}),code('instagram_dm_request_changed'));
 assert.equal((await service.next(identity,2)).assignment,null,'Old open-only worker cannot claim composer input');assert.equal((await service.next(identity,3)).assignment,null,'Older input verifier cannot claim new input requests');
 const assignment=(await service.next(identity,4)).assignment!,grant={job_id:assignment.job_id,claim_token:assignment.claim_token};assert.equal(assignment.mode,'compose');assert.equal(assignment.messages?.[0].body,body);assert.equal('send_permitted'in assignment,false);
 await assert.rejects(service.check(identity,grant),code('not_found'));assert.deepEqual(await service.check(identity,grant,'compose'),{input_permitted:true});
 await assert.rejects(browserSendService(f.database).arm(f.actor,{...identity.lease,...grant,observation:{sender:'synthetic_company',recipient:target.recipient,body,source_url:target.profile_url,observed_at:new Date().toISOString(),visible_text:body}}),code('not_found'));
 const result={candidate_id:target.candidate_id,recipient:target.recipient,state:'drafted',reason:'draft_ready',source_url:target.profile_url,observed_at:new Date().toISOString(),body_sha256:createHash('sha256').update(body).digest('hex'),rendered_body_sha256:createHash('sha256').update(body).digest('hex')};
 await assert.rejects(service.finish(identity,{...grant,results:[result]}));await assert.rejects(service.finish(identity,{...grant,results:[{...result,body_sha256:'0'.repeat(64)}]},'compose'),code('browser_outreach_observation_invalid'));
 await assert.rejects(service.finish(identity,{...grant,results:[{...result,state:'unavailable',reason:'draft_text_mismatch',body_sha256:null,typed_readback:'SYNTHETIC unrelated editor content'}]},'compose'),code('browser_outreach_observation_invalid'));
 assert.equal((await service.finish(identity,{...grant,results:[result]},'compose')).state,'completed');assert.equal((await service.history(f.other)).length,0);
 await assert.rejects(f.client.query("update outreach_chat_previews set messages='[]' where id=$1",[input.id]),sqlFailure('23514'));
 const counts=(await f.client.query('select (select count(*)::int from outreach_browser_sends) sends,(select count(*)::int from instagram_dm_sends) api_sends,(select count(*)::int from outreach_drafts) business_drafts')).rows[0];assert.deepEqual(counts,{sends:0,api_sends:0,business_drafts:0});
}));

test('different composer previews queue together but only one can be claimed for the company account',async()=>withDiscoveryDatabase(async f=>{
 const first=await seedShortlistCandidate(f),second=await seedShortlistCandidate(f),connections=outreachExecutorService(f.database),service=chatPreviewService(f.database),sender=await accountService(f.database).register(f.actor,{provider:'instagram',label:'SYNTHETIC serialized drafts',identity:'synthetic_company'}),pair=await connections.startPair(f.actor,{accountId:sender.id,name:'SYNTHETIC serialized Chrome',confirmed:true}),credentials=await connections.pair({code:pair.code,extension_id:outreachExtensionId}),identity=await connections.authenticate(credentials.token);await connections.heartbeat(identity,{observed_username:'synthetic_company',reason:'ready'});
 const requests=[];for(const candidate of [first,second]){const id=randomUUID();await service.create(f.actor,{id,accountId:sender.id,campaignId:candidate.campaign.id,candidateIds:[candidate.accountId],goal:1});const assignment=(await service.next(identity)).assignment!,target=assignment.targets[0];await service.finish(identity,{job_id:assignment.job_id,claim_token:assignment.claim_token,results:[{candidate_id:target.candidate_id,recipient:target.recipient,state:'opened',reason:'chat_opened',source_url:target.profile_url,observed_at:new Date().toISOString()}]});requests.push({id:randomUUID(),sourcePreviewId:id,messages:[{candidateId:candidate.accountId,body:'SYNTHETIC unsent proposal'}]});}
 for(const request of requests)await service.compose(f.actor,request);await assert.rejects(service.compose(f.actor,{...requests[0],id:randomUUID()}),code('browser_outreach_pending'));
 const concurrent=await Promise.all([service.next(identity,4),service.next(identity,4)]);assert.equal(concurrent.filter(r=>r.assignment).length,1);const firstGrant=concurrent.find(r=>r.assignment)!.assignment!;
 await service.finish(identity,{job_id:firstGrant.job_id,claim_token:firstGrant.claim_token,results:[]},'compose');const next=(await service.next(identity,4)).assignment!;assert.ok(next);assert.notEqual(next.job_id,firstGrant.job_id);
}));

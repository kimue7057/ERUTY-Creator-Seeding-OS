import test from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {withDiscoveryDatabase,sqlFailure} from '../discovery-fixture';
import {seedShortlistCandidate} from '../shortlist-samples';
import {accountService} from '../../src/lib/outreach/accounts';
import {contactService} from '../../src/lib/outreach/contacts';
import {contactCases,contactConversations,contactMessages,contactWorkflows} from '../../src/lib/db/contact-schema';
import {OutreachError} from '../../src/lib/outreach/contracts';
import {readMigrationFiles} from 'drizzle-orm/migrator';
test('one campaign business record shares status, owner, due date and notes across channels while preserving original cases and messages',async()=>withDiscoveryDatabase(async f=>{
 const seed=await seedShortlistCandidate(f),accounts=accountService(f.database),mail=await accounts.register(f.actor,{provider:'google',label:'SYNTHETIC mail',identity:'company@example.invalid'}),dm=await accounts.register(f.actor,{provider:'instagram',label:'SYNTHETIC DM',identity:'synthetic_company'});
 const [workflow]=await f.database.insert(contactWorkflows).values({organizationId:f.actor.organizationId,campaignId:seed.campaign.id,creatorAccountId:seed.accountId,ownerId:f.actor.userId,createdBy:f.actor.userId,updatedBy:f.actor.userId}).returning();
 const ids:string[]=[];
 for(const [account,channel,recipient] of [[mail,'email','creator@example.invalid'],[dm,'instagram','synthetic_creator']] as const){
  const [conversation]=await f.database.insert(contactConversations).values({organizationId:f.actor.organizationId,accountId:account.id,channel,recipient,routeKey:recipient,fromAddress:account.expectedIdentity}).returning();
  const [item]=await f.database.insert(contactCases).values({organizationId:f.actor.organizationId,workflowId:channel==='email'?workflow.id:undefined,conversationId:conversation.id,campaignId:seed.campaign.id,creatorAccountId:seed.accountId,displayName:'SYNTHETIC creator',origin:'selection',ownerId:f.actor.userId,notes:'Original '+channel+' note',firstSentAt:new Date(),createdBy:f.actor.userId,updatedBy:f.actor.userId}).returning();ids.push(item.id);
  await f.database.insert(contactMessages).values({organizationId:f.actor.organizationId,conversationId:conversation.id,caseId:item.id,sourceKey:'synthetic:'+channel,direction:'out',body:'SYNTHETIC immutable proposal',sentAt:new Date()});
 }
 const service=contactService(f.database),first=await service.detail(f.actor,ids[0]);assert.equal(first.channels.length,2);assert.equal(first.campaignContext?.campaignTitle,seed.campaign.title);
 await service.update(f.actor,ids[0],{revision:1,progress:'negotiating',ownerId:f.actor.userId,nextActionOn:'2026-12-01',notes:'SYNTHETIC shared next step'});
 const second=await service.detail(f.actor,ids[1]);assert.equal(second.item.notes,'SYNTHETIC shared next step');assert.equal(second.item.progress,'negotiating');assert.equal(second.item.revision,2);
 await assert.rejects(service.update(f.actor,ids[1],{revision:1,progress:'closed',ownerId:f.actor.userId,nextActionOn:null,notes:''}),(e:unknown)=>e instanceof OutreachError&&e.code==='contact_changed');
 await service.update(f.actor,ids[1],{revision:2,progress:'hold',ownerId:f.actor.userId,nextActionOn:null,notes:'SYNTHETIC on hold'});
 const rows=await service.list(f.actor);assert.equal(rows.length,2);assert.ok(rows.every(r=>r.progress==='hold'&&r.nextActionOn===null&&r.workflowId===workflow.id));
 assert.equal((await f.database.select().from(contactCases).where(eq(contactCases.id,ids[0])))[0].notes,'Original email note');
 assert.equal((await service.detail(f.actor,ids[0])).messages[0].body,'SYNTHETIC immutable proposal');
 await assert.rejects(service.detail(f.other,ids[0]),(e:unknown)=>e instanceof OutreachError&&e.code==='not_found');
 await assert.rejects(service.update({...f.reader,role:'admin'},ids[0],{revision:3,progress:'closed',ownerId:f.actor.userId,nextActionOn:null,notes:''}),(e:unknown)=>e instanceof OutreachError&&e.code==='forbidden');
 await assert.rejects(f.database.update(contactCases).set({creatorAccountId:crypto.randomUUID()}).where(eq(contactCases.id,ids[0])),sqlFailure('23503'));
}));

test('migration groups existing channel cases using their latest management edit and preserves original evidence',async()=>withDiscoveryDatabase(async f=>{
 const seed=await seedShortlistCandidate(f),account=await accountService(f.database).register(f.actor,{provider:'google',label:'SYNTHETIC migration sender',identity:'migration@example.invalid'});
 const [workflow]=await f.database.insert(contactWorkflows).values({organizationId:f.actor.organizationId,campaignId:seed.campaign.id,creatorAccountId:seed.accountId,ownerId:f.actor.userId,createdBy:f.actor.userId,updatedBy:f.actor.userId}).returning();
 for(let i=0;i<2;i++){
  const [conversation]=await f.database.insert(contactConversations).values({organizationId:f.actor.organizationId,accountId:account.id,channel:'email',recipient:'creator@example.invalid',routeKey:'synthetic-migration-'+i,fromAddress:'migration@example.invalid'}).returning();
  const [item]=await f.database.insert(contactCases).values({organizationId:f.actor.organizationId,workflowId:workflow.id,conversationId:conversation.id,campaignId:seed.campaign.id,creatorAccountId:seed.accountId,displayName:'SYNTHETIC migration creator',origin:'legacy',progress:i===0?'hold':'negotiating',notes:'SYNTHETIC original '+i,ownerId:f.actor.userId,firstSentAt:new Date(),updatedAt:new Date(Date.now()+i*1000),createdBy:f.actor.userId,updatedBy:f.actor.userId}).returning();
  await f.database.insert(contactMessages).values({organizationId:f.actor.organizationId,conversationId:conversation.id,caseId:item.id,sourceKey:'synthetic-migration:'+i,direction:'out',body:'SYNTHETIC original immutable '+i,sentAt:new Date()});
 }
 // Only this disposable loopback fixture is rewound to the pre-0027 shape.
 await f.client.query('DROP TRIGGER link_contact_workflow ON contact_cases; DROP FUNCTION link_contact_workflow(); ALTER TABLE contact_cases DROP COLUMN workflow_id; DROP TABLE contact_workflows; ALTER TABLE outreach_drafts DROP COLUMN compose_step');
 const before=(await f.client.query("select jsonb_agg(to_jsonb(c) order by id) as data from contact_cases c")).rows[0].data,messages=(await f.client.query('select jsonb_agg(to_jsonb(m) order by id) as data from contact_messages m')).rows[0].data;
 for(const statement of readMigrationFiles({migrationsFolder:'drizzle'}).at(-1)!.sql)if(statement.trim())await f.client.query(statement);
 assert.deepEqual((await f.client.query("select jsonb_agg(to_jsonb(c)-'workflow_id' order by id) as data from contact_cases c")).rows[0].data,before);
 assert.deepEqual((await f.client.query('select jsonb_agg(to_jsonb(m) order by id) as data from contact_messages m')).rows[0].data,messages);
 const workflows=await f.database.select().from(contactWorkflows);assert.equal(workflows.length,1);assert.equal(workflows[0].notes,'SYNTHETIC original 1');assert.equal(workflows[0].progress,'negotiating');
 assert.equal(new Set((await contactService(f.database).list(f.actor)).map(r=>r.workflowId)).size,1);
}));

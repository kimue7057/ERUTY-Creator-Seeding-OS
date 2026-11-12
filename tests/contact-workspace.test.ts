import test from 'node:test';
import assert from 'node:assert/strict';
import {nextSyncBatch,groupContacts,campaignContactCounts,safeContactReturn} from '../src/lib/outreach/contact-workspace';
import type {ContactListRow} from '../src/lib/outreach/contacts';
const row=(id:string,patch:Partial<ContactListRow>={}):ContactListRow=>({id,workflowId:'synthetic-workflow',conversationId:'conversation-'+id,campaignId:'synthetic-campaign',creatorAccountId:'synthetic-creator',displayName:'SYNTHETIC creator',origin:'selection',progress:'proposal',ownerId:'synthetic-owner',ownerName:'SYNTHETIC owner',nextActionOn:null,firstSentAt:new Date(),channel:'email',recipient:'creator@example.invalid',fromAddress:'company@example.invalid',accountId:'synthetic-sender',lastSyncedAt:new Date(),syncError:null,accountStatus:'connected',accountLabel:'SYNTHETIC company',mailReadEnabled:true,campaignTitle:'SYNTHETIC campaign',projectName:'SYNTHETIC brand',lastDirection:'out',preview:'SYNTHETIC proposal',lastMessageAt:new Date(),blocked:false,...patch});
test('round-robin inbox polling visits every conversation, including short tails and a shrinking list',()=>{
 for(const count of [0,1,2,3,4,5,8,9,12,500]){const rows=Array.from({length:count},(_,i)=>i),seen:number[]=[];let cursor=0;for(let i=0;i<Math.ceil(count/3);i++){const batch=nextSyncBatch(rows,cursor);seen.push(...batch.items);cursor=batch.next;}assert.deepEqual(seen,rows);assert.equal(cursor,0);}
 assert.deepEqual(nextSyncBatch(['a','b'],400),{items:['a','b'],next:0});
});
test('one campaign creator keeps both channels and prioritizes the unanswered channel without merging legacy identities',()=>{
 const rows=[row('mail'),row('dm',{channel:'instagram',lastDirection:'in'}),row('other-campaign',{workflowId:'another-workflow',campaignId:'another-campaign'}),row('legacy-a',{workflowId:null,campaignId:null,creatorAccountId:null,origin:'legacy'}),row('legacy-b',{workflowId:null,campaignId:null,creatorAccountId:null,origin:'legacy'})];
 const grouped=groupContacts(rows);assert.equal(grouped.length,4);assert.equal(grouped[0].rows.length,2);assert.equal(grouped[0].primary.id,'dm');assert.equal(grouped[0].task,'회신 필요');assert.deepEqual(campaignContactCounts(rows).get('synthetic-campaign'),{contacted:1,reply:1,waiting:0,agreed:0});
 assert.equal(groupContacts([row('mail',{blocked:true}),rows[1]])[0].task,'결과 확인 필요');
});
test('return destinations retain filters and allow only internal contact/campaign lists',()=>{
 assert.equal(safeContactReturn('/contacts?channel=instagram&q=SYNTHETIC'),'/contacts?channel=instagram&q=SYNTHETIC');
 assert.equal(safeContactReturn('/campaigns/12345678-1234-1234-1234-123456789012?tab=contacts'),'/campaigns/12345678-1234-1234-1234-123456789012?tab=contacts');
 for(const invalid of ['https://outside.invalid','//outside.invalid','javascript:alert(1)','/settings','/contacts/another'])assert.equal(safeContactReturn(invalid),'/contacts');
});

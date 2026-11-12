import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {withDiscoveryDatabase,sqlFailure} from '../discovery-fixture';
import {accountService} from '../../src/lib/outreach/accounts';
import {contactService} from '../../src/lib/outreach/contacts';
import {GOOGLE_READ_SCOPE,GOOGLE_SEND_SCOPE} from '../../src/lib/outreach/providers';
import {outreachConnectionTests} from '../../src/lib/db/outreach-schema';
import {contactMessages,contactReplies} from '../../src/lib/db/contact-schema';
import {OutreachError} from '../../src/lib/outreach/contracts';
process.env.OUTREACH_ENCRYPTION_KEY='a'.repeat(64);process.env.OUTREACH_GOOGLE_CLIENT_ID='synthetic-client';process.env.OUTREACH_GOOGLE_CLIENT_SECRET='synthetic-secret';process.env.APP_ORIGIN='http://127.0.0.1:3000';
const code=(c:string)=>(error:unknown)=>error instanceof OutreachError&&error.code===c;
type Fixture=Parameters<Parameters<typeof withDiscoveryDatabase>[0]>[0];
export async function seedMailContact(f:Fixture){
 const from='company@example.invalid',to='creator@example.invalid',thread='synthetic_thread',seed='synthetic_original',now=Date.now()-10000;
 const mail=(id:string,incoming:boolean,time:number,body:string)=>({id,threadId:thread,internalDate:String(time),payload:{mimeType:'text/plain',headers:[{name:'From',value:incoming?to:from},{name:'To',value:incoming?from:to},{name:'Subject',value:'SYNTHETIC proposal'},{name:'Message-ID',value:`<${id}@example.invalid>`}],body:{data:Buffer.from(body).toString('base64url')}}});
 const messages=[mail(seed,false,now,'SYNTHETIC proposal')];let submissions=0,mode='ok',read=true;
 const mock:typeof fetch=async(url,init)=>{const u=new URL(String(url));
  if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,scope:`openid email ${GOOGLE_SEND_SCOPE} ${read?GOOGLE_READ_SCOPE:''}`});
  if(u.hostname==='openidconnect.googleapis.com')return Response.json({sub:'synthetic-company',email:from,email_verified:true});
  if(u.pathname.endsWith('/messages/send')){submissions++;if(mode==='unknown')throw Error('Synthetic network failure after submit');if(mode==='reject')return Response.json({error:{}},{status:403});const data=JSON.parse(String(init?.body));assert.equal(data.threadId,thread);const raw=Buffer.from(data.raw,'base64url').toString();assert.match(raw,/In-Reply-To: <synthetic_incoming@example.invalid>/);assert.match(raw,/References: <synthetic_incoming@example.invalid>/);messages.push(mail('synthetic_reply',false,Date.now(),'SYNTHETIC response\n\n'+from));return Response.json({id:'synthetic_reply',threadId:thread});}
  if(u.pathname.endsWith('/messages/'+seed))return Response.json({id:seed,threadId:thread});
  if(u.pathname.endsWith('/threads/'+thread))return Response.json({id:thread,messages});throw Error('Unexpected synthetic provider request: '+u.pathname);
 };
 const accounts=accountService(f.database,mock),account=await accounts.register(f.actor,{provider:'google',label:'SYNTHETIC company',identity:from});
 async function connect(wantRead=true){const state=new URL(await accounts.begin(f.actor,account.id,'synthetic-session',false,wantRead)).searchParams.get('state')!;await accounts.complete(f.actor,'google',state,'synthetic-session','synthetic-code');}
 await connect();
 await f.database.insert(outreachConnectionTests).values({id:randomUUID(),organizationId:f.actor.organizationId,accountId:account.id,fromAddress:from,toAddress:to,subject:'SYNTHETIC proposal',body:'SYNTHETIC proposal',status:'sent',providerMessageId:seed,sentAt:new Date(now),createdBy:f.actor.userId});
 const svc=contactService(f.database,mock),row=(await svc.list(f.actor))[0];
 return{svc,row,account,accounts,messages,connect,read:(v:boolean)=>{read=v;},mode:(v:string)=>{mode=v;},submissions:()=>submissions,incoming:()=>messages.push(mail('synthetic_incoming',true,Date.now()-1000,'SYNTHETIC creator response'))};
}
test('confirmed sends project once, scope original conversations, deduplicate inbound and reply with the original sender/thread',async()=>withDiscoveryDatabase(async f=>{
 const h=await seedMailContact(f);assert.equal(h.row.origin,'connection_test');assert.equal((await h.svc.list(f.actor)).length,1);assert.equal((await h.svc.list(f.other)).length,0);await assert.rejects(h.svc.detail(f.other,h.row.id),code('not_found'));await assert.rejects(h.svc.sync({...f.reader,role:'admin'},h.row.id),code('forbidden'));
 const first=await h.svc.sync(f.actor,h.row.id);assert.equal(first.messages.length,1);h.incoming();const inbox=await h.svc.sync(f.actor,h.row.id);assert.equal(inbox.messages.length,2);assert.equal(inbox.messages.at(-1)?.direction,'in');assert.equal((await h.svc.sync(f.actor,h.row.id)).conversation.version,inbox.conversation.version);
 await assert.rejects(h.svc.reply(f.actor,{id:randomUUID(),caseId:h.row.id,version:first.conversation.version,body:'stale response',confirmed:true}),code('contact_changed'));assert.equal(h.submissions(),0);
 const input={id:randomUUID(),caseId:h.row.id,version:inbox.conversation.version,body:'SYNTHETIC response',confirmed:true};
 const result=await Promise.allSettled([h.svc.reply(f.actor,input),h.svc.reply(f.actor,{...input,id:randomUUID()})]);assert.ok(result.some(r=>r.status==='fulfilled'));assert.equal(h.submissions(),1);
 const saved=await h.svc.detail(f.actor,h.row.id);assert.equal(saved.attempts.filter(a=>a.status==='sent').length,1);assert.equal(saved.messages.at(-1)?.direction,'out');assert.equal((await h.svc.sync(f.actor,h.row.id)).messages.length,3);
 await assert.rejects(f.database.update(contactMessages).set({body:'tampered'}).where(eq(contactMessages.id,saved.messages[0].id)),sqlFailure('23514'));await assert.rejects(f.database.update(contactReplies).set({body:'tampered'}).where(eq(contactReplies.id,saved.attempts.find(a=>a.status==='sent')!.id)),sqlFailure('23514'));
 await h.svc.update(f.actor,h.row.id,{revision:saved.item.revision,progress:'negotiating',ownerId:f.actor.userId,nextActionOn:'2026-12-01',notes:'Synthetic internal note'});await assert.rejects(h.svc.update(f.actor,h.row.id,{revision:saved.item.revision,progress:'closed',ownerId:f.actor.userId,nextActionOn:null,notes:''}),code('contact_changed'));
}));
test('ambiguous replies remain durable barriers; fresh IDs cannot duplicate a potentially delivered email',async()=>withDiscoveryDatabase(async f=>{
 const h=await seedMailContact(f);h.incoming();const inbox=await h.svc.sync(f.actor,h.row.id);h.mode('unknown');const input={id:randomUUID(),caseId:h.row.id,version:inbox.conversation.version,body:'SYNTHETIC uncertain',confirmed:true};await assert.rejects(h.svc.reply(f.actor,input),code('send_unknown'));await assert.rejects(h.svc.reply(f.actor,{...input,id:randomUUID()}),code('send_unknown'));assert.equal(h.submissions(),1);assert.equal((await h.svc.detail(f.actor,h.row.id)).attempts[0].status,'unknown');
}));
test('mail read consent is explicit and denied upgrades preserve the original connected sender',async()=>withDiscoveryDatabase(async f=>{
 const h=await seedMailContact(f);h.read(false);await assert.rejects(h.connect(true),code('permission_missing'));assert.equal((await h.accounts.list(f.actor))[0].mailReadEnabled,true);await h.connect(false);assert.equal((await h.accounts.list(f.actor))[0].status,'connected');assert.equal((await h.accounts.list(f.actor))[0].mailReadEnabled,false);await assert.rejects(h.svc.sync(f.actor,h.row.id),code('mail_read_required'));assert.equal(h.submissions(),0);assert.equal((await h.svc.detail(f.actor,h.row.id)).conversation.lastSyncedAt,null);
}));

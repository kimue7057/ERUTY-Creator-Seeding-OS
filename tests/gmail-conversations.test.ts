import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {parseMailMessage,gmailConversations} from '../src/lib/outreach/gmail-conversations';
import {rawEmail} from '../src/lib/outreach/message';
const sample={id:'abc',threadId:'thread',internalDate:'1794402000000',payload:{mimeType:'text/plain',headers:[{name:'From',value:'Creator <creator@example.invalid>'},{name:'To',value:'company@example.invalid'},{name:'Message-ID',value:'<abc@example.invalid>'}],body:{data:Buffer.from('Hello\n\nOriginal message').toString('base64url')}}};
test('only the exact sender and creator may participate; redirected or extra recipients do not silently change the approved route',()=>{
 const parsed=parseMailMessage(sample,'thread','creator@example.invalid',['company@example.invalid']);assert.equal(parsed.incoming,true);assert.equal(parsed.body,'Hello\n\nOriginal message');
 for(const headers of [[{name:'From',value:'stranger@example.invalid'},{name:'To',value:'company@example.invalid'}],[...sample.payload.headers,{name:'Cc',value:'stranger@example.invalid'}],[...sample.payload.headers,{name:'Reply-To',value:'other@example.invalid'}]])assert.throws(()=>parseMailMessage({...sample,payload:{...sample.payload,headers}},'thread','creator@example.invalid',['company@example.invalid']));
 assert.throws(()=>parseMailMessage(sample,'another-thread','creator@example.invalid',['company@example.invalid']));
});
test('reply MIME preserves validated threading headers and rejects header injection',()=>{
 const input={id:randomUUID(),from:'company@example.invalid',to:'creator@example.invalid',subject:'SYNTHETIC proposal',body:'Hello',template:'letter' as const,reply:{inReplyTo:'<abc@example.invalid>',references:'<first@example.invalid> <abc@example.invalid>'}};
 const raw=Buffer.from(rawEmail(input),'base64url').toString();assert.match(raw,/In-Reply-To: <abc@example.invalid>/);assert.match(raw,/References: <first@example.invalid> <abc@example.invalid>/);
 assert.throws(()=>rawEmail({...input,reply:{...input.reply,inReplyTo:'<abc@example.invalid>\r\nBcc: other@example.invalid'}}));
});
test('mailbox reads start from an existing sent message and reject a foreign thread',async()=>{
 const provider=gmailConversations('synthetic',async url=>String(url).includes('/messages/')?Response.json({id:'abc',threadId:'thread'}):Response.json({id:'thread',messages:[sample]}));
 assert.equal((await provider.thread(null,'abc','creator@example.invalid',['company@example.invalid'])).messages.length,1);await assert.rejects(provider.thread('thread','unrelated_message','creator@example.invalid',['company@example.invalid']));
});

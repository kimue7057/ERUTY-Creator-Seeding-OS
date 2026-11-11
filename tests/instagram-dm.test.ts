import test from "node:test";
import assert from "node:assert/strict";
import { instagramDmProvider,InstagramDmSendError } from "../src/lib/outreach/instagram-dm-provider";
import { assertDmWindow,DM_WINDOW_MS } from "../src/lib/outreach/instagram-dm-contracts";
const context={id:"333",username:"synthetic_company",secret:"synthetic-secret",accessToken:"synthetic-private-token",version:"v27.0"};
const selection={conversationId:"t_synthetic",recipientId:"444",username:"synthetic_recipient"};
const inbound=(at=new Date().toISOString())=>({id:"m_synthetic",created_time:at,from:{id:"444",username:"synthetic_recipient"},to:{data:[{id:"333",username:"synthetic_company"}]},message:"SYNTHETIC incoming"});
test("DM window is controlled only by an inbound message and rejects future timestamps and the exact 24h boundary",()=>{
  const now=Date.now();assertDmWindow(new Date(now-DM_WINDOW_MS+1).toISOString(),now);
  for(const at of [null,"invalid",new Date(now+60000).toISOString(),new Date(now-DM_WINDOW_MS).toISOString()])assert.throws(()=>assertDmWindow(at,now));
});
test("conversation lookup proves sender ownership, validates the selected recipient and never follows paging URLs",async()=>{
  const calls:string[]=[];
  const provider=instagramDmProvider(context,async(url,init)=>{const u=new URL(String(url));calls.push(u.href);assert.equal(u.hostname,"graph.facebook.com");assert.equal(new Headers(init?.headers).get("Authorization"),`Bearer ${context.accessToken}`);
    if(u.pathname.endsWith("/conversations")){assert.equal(u.searchParams.get("user_id"),"444");return Response.json({data:[{id:selection.conversationId,updated_time:new Date().toISOString(),messages:{data:[inbound()]}}]});}
    return Response.json({id:selection.conversationId,messages:{data:[inbound(),{...inbound(new Date(Date.now()-25*3600000).toISOString()),id:"old",from:{id:"333",username:"synthetic_company"},to:{data:[{id:"444",username:"synthetic_recipient"}]}}]}});
  });
  const thread=await provider.thread(selection);assert.equal(thread.canReply,true);assert.equal(thread.messages.length,2);assert.equal(calls.length,2);
  await assert.rejects(provider.thread({...selection,username:"wrong_target"}),/instagram_dm_recipient_changed/);
  const denied=instagramDmProvider(context,async()=>Response.json({data:[]}));await assert.rejects(denied.thread(selection),/instagram_dm_conversation_missing/);
  let count=0;const paging=instagramDmProvider(context,async url=>{assert.equal(new URL(String(url)).hostname,"graph.facebook.com");count++;return Response.json({data:[],paging:{cursors:{after:"same"},next:"https://evil.invalid/"}});});
  await assert.rejects(paging.thread(selection),/instagram_dm_response_invalid/);assert.equal(count,2);
});
test("outbound activity cannot reopen an expired inbound conversation",async()=>{
  const m=inbound(new Date(Date.now()-25*3600000).toISOString());const outgoing={...inbound(),id:"out",from:m.to.data[0],to:{data:[m.from]}};
  const provider=instagramDmProvider(context,async url=>new URL(String(url)).pathname.endsWith("/conversations")?Response.json({data:[{id:selection.conversationId,updated_time:new Date().toISOString(),messages:{data:[outgoing]}}]}):Response.json({id:selection.conversationId,messages:{data:[outgoing,m]}}));
  assert.equal((await provider.thread(selection)).canReply,false);
});
test("DM sends once to the verified scoped recipient; ambiguous responses never become a safe retry",async()=>{
  let calls=0;const provider=instagramDmProvider(context,async(url,init)=>{calls++;assert.equal(new URL(String(url)).pathname,"/v27.0/333/messages");assert.equal(init?.method,"POST");assert.deepEqual(JSON.parse(String(init?.body)),{recipient:{id:"444"},message:{text:"SYNTHETIC reply"},messaging_type:"RESPONSE"});return Response.json({recipient_id:"444",message_id:"message_receipt"});});
  assert.equal(await provider.send("444","SYNTHETIC reply"),"message_receipt");assert.equal(calls,1);
  for(const response of [Response.json({recipient_id:"555",message_id:"wrong"}),Response.json({error:{code:1}},{status:500}),new Response("bad",{status:200})]){
    await assert.rejects(instagramDmProvider(context,async()=>response).send("444","text"),(e:unknown)=>e instanceof InstagramDmSendError&&e.ambiguous&&!JSON.stringify(e).includes(context.accessToken));
  }
  await assert.rejects(instagramDmProvider(context,async()=>Response.json({error:{code:200,message:context.accessToken}},{status:403})).send("444","text"),(e:unknown)=>e instanceof InstagramDmSendError&&!e.ambiguous&&e.code==="instagram_dm_access_required"&&!JSON.stringify(e).includes(context.accessToken));
});


test('empty or missing Instagram text retains its direction and timestamp with an explicit original-app placeholder',async()=>{
 const empty={...inbound(),message:''},missing={...inbound(new Date(Date.now()-1000).toISOString()),id:'missing_text',message:undefined};const provider=instagramDmProvider(context,async url=>new URL(String(url)).pathname.endsWith('/conversations')?Response.json({data:[{id:selection.conversationId,updated_time:new Date().toISOString(),messages:{data:[empty]}}]}):Response.json({id:selection.conversationId,messages:{data:[empty,missing]}}));
 const thread=await provider.thread(selection);assert.equal(thread.messages.length,2);assert.ok(thread.messages.every(m=>m.incoming&&m.text.includes('본문이 없는 메시지')&&m.createdAt));assert.equal(thread.canReply,true);
});

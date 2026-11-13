// Loaded only by Playwright's local Next server, never by the application.
// Keep real credentials and requests out of browser tests.
const localHosts = ["127.0.0.1", "localhost"];
if (!localHosts.includes(new URL(process.env.DATABASE_URL).hostname) || !localHosts.includes(new URL(process.env.APP_ORIGIN ?? "http://127.0.0.1:3000").hostname)) {
  throw new Error("Meta browser fixtures require a local test database and app");
}
const originalFetch = globalThis.fetch;
const allowedTokens = new Set(["synthetic-browser-meta-success", "synthetic-browser-meta-other"]);
const crmFrom='crm-company@example.invalid',crmTo='crm-creator@example.invalid',crmThread='crm_mail_thread',crmTime=Date.now()-20000;
const crmMail=(id,incoming,time,body)=>({id,threadId:crmThread,internalDate:String(time),payload:{mimeType:'text/plain',headers:[{name:'From',value:incoming?crmTo:crmFrom},{name:'To',value:incoming?crmFrom:crmTo},{name:'Subject',value:'SYNTHETIC CRM proposal'},{name:'Message-ID',value:`<${id}@example.invalid>`}],body:{data:Buffer.from(body).toString('base64url')}}});
const crmMessages=[crmMail('crm_mail_original',false,crmTime,'SYNTHETIC original proposal')];let crmIncomingInitialized=false;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const crmBearer=new Headers(init?.headers).get('Authorization');
  if(url.hostname==='openrouter.ai'){
    if(crmBearer!=='Bearer synthetic-router-ui-key-12345')throw Error('Unexpected OpenRouter key in isolated fixture');
    const body=JSON.parse(init.body);if(body.model!=='openai/gpt-5.4-mini')throw Error('Unexpected OpenRouter model');
    let output={ok:true};if(body.max_tokens>256){const data=JSON.parse(body.messages[1].content);output={subject:'SYNTHETIC creator-specific proposal',body:`Hi ${data.creator.display_name}!\n\nSYNTHETIC observed content fits ${data.brand.project.name}.\n\nWould you like a short product brief?`,evidence_ids:[data.evidence[0].id],personalization_reason:'합성 원본 콘텐츠와 해당 캠페인의 브랜드를 연결했습니다.'};}
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]});
  }
  if(crmBearer==='Bearer synthetic-crm-google'){
    if(url.hostname==='openidconnect.googleapis.com')return Response.json({sub:'synthetic-crm-subject',email:crmFrom,email_verified:true});
    if(url.hostname==='gmail.googleapis.com'){
      if(url.pathname.endsWith('/messages/crm_mail_original'))return Response.json({id:'crm_mail_original',threadId:crmThread});
      if(url.pathname.endsWith('/threads/'+crmThread)){if(!crmIncomingInitialized){crmMessages.push(crmMail('crm_mail_incoming',true,Date.now(),'SYNTHETIC creator answer\n\nPlease share the brief.'));crmIncomingInitialized=true;}return Response.json({id:crmThread,messages:crmMessages});}
      if(url.pathname.endsWith('/messages/send')){const data=JSON.parse(init.body),raw=Buffer.from(data.raw,'base64url').toString();if(data.threadId!==crmThread||!raw.includes('To: '+crmTo)||!raw.includes('In-Reply-To: <crm_mail_incoming@example.invalid>'))throw Error('Unsafe CRM fixture send');crmMessages.push(crmMail('crm_mail_reply',false,Date.now(),'SYNTHETIC CRM reply\n\n'+crmFrom));return Response.json({id:'crm_mail_reply',threadId:crmThread});}
    }
    throw Error('Unexpected CRM fixture request');
  }
  if (url.hostname !== "graph.facebook.com") return originalFetch(input, init);
  if (url.pathname.endsWith("/debug_token") && allowedTokens.has(url.searchParams.get("input_token"))) {
    return Response.json({ data: { app_id: "10000", type: "SYSTEM_USER", is_valid: true, expires_at: 0, scopes: ["instagram_basic", "instagram_manage_messages"] } });
  }
  const bearer = new Headers(init?.headers).get("Authorization")?.replace(/^Bearer /, "");
  if (url.pathname.endsWith("/me/assigned_instagram_accounts") && allowedTokens.has(bearer)) {
    return Response.json({ data: [{ id: "333", username: bearer === "synthetic-browser-meta-other" ? "another_company" : "synthetic_company" }] });
  }
  if (allowedTokens.has(bearer)) {
    const inbound={id:"synthetic_inbound",created_time:new Date(Date.now()-60000).toISOString(),from:{id:"444",username:"synthetic_recipient"},to:{data:[{id:"333",username:"synthetic_company"}]},message:"SYNTHETIC incoming message"};
    if(url.pathname==="/v27.0/333/conversations")return Response.json({data:[{id:"t_synthetic_browser",updated_time:new Date().toISOString(),messages:{data:[inbound]}}]});
    if(url.pathname==="/v27.0/t_synthetic_browser")return Response.json({id:"t_synthetic_browser",messages:{data:[inbound]}});
    if(url.pathname==="/v27.0/333/messages"&&init?.method==="POST"){
      const data=JSON.parse(init.body);
      if(data.recipient?.id!=="444"||data.message?.text!=="SYNTHETIC browser approved reply")throw new Error("Unexpected recipient or body blocked by fixture");
      return Response.json({recipient_id:"444",message_id:"synthetic_browser_receipt"});
    }
  }
  throw new Error("Unexpected Meta request blocked by the browser fixture");
};

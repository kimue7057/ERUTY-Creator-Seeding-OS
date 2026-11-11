/* global chrome */
const ORIGIN="https://eruty-creator-seeding-os.vercel.app";
const ALARM="eruty-outreach";
let running=false;
const store=chrome.storage.local;
// Tokens remain in trusted extension contexts, unavailable to Instagram scripts.
const secured=store.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"});
async function api(action,input,connection){
  const response=await fetch(`${ORIGIN}/api/outreach/executor/${action}`,{method:"POST",credentials:"omit",redirect:"error",signal:AbortSignal.timeout(15000),headers:{"content-type":"application/json","x-eruty-executor":"1",...(connection?{authorization:`Bearer ${connection.token}`}:{})},body:JSON.stringify(input)});
  const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error??"server_unavailable"),{status:response.status});return result;
}
const grantInput=j=>({job_id:j.grant.job_id,claim_token:j.grant.claim_token});
async function message(tabId,command){
  let result;try{result=await chrome.tabs.sendMessage(tabId,{type:"ERUTY_INSTAGRAM",...command});}catch(error){if(/Receiving end does not exist|Could not establish connection|Extension context invalidated/i.test(error.message??""))throw new Error("content_script_missing");throw error;}
  if(!result?.ok)throw new Error(result?.reason??"browser_unavailable");return result;
}
async function waitMessage(tabId,command,timeout=12000,missingFailsFast=false){
  const end=Date.now()+timeout;let last;
  do{try{return await message(tabId,command);}catch(e){last=e;if(["captcha","platform_restricted","sender_mismatch","login_required"].includes(e.message)||missingFailsFast&&e.message==="content_script_missing")throw e;}await new Promise(r=>setTimeout(r,500));}while(Date.now()<end);
  throw last??new Error("browser_unavailable");
}
async function tabFor(connection){
  const {controlledTab}=await store.get("controlledTab");
  if(Number.isInteger(controlledTab)){try{const tab=await chrome.tabs.get(controlledTab);if(tab.url?.startsWith("https://www.instagram.com/"))return controlledTab;}catch{/* An operator closed the dedicated tab. */}}
  const tab=await chrome.tabs.create({url:`https://www.instagram.com/${connection.sender}/`,active:false});await store.set({controlledTab:tab.id});return tab.id;
}
async function activate(tabId,command){
  const tab=await chrome.tabs.update(tabId,{active:true});
  if(Number.isInteger(tab?.windowId)){
    const window=await chrome.windows.get(tab.windowId);
    if(window.state==="minimized")await chrome.windows.update(tab.windowId,{state:"normal"});
    await chrome.windows.update(tab.windowId,{focused:true});
  }
  await waitMessage(tabId,{action:"foreground",...command},8000);
}
async function navigate(tabId,url,command){
  const current=await chrome.tabs.get(tabId);
  // Re-navigating an already loaded recipient could let the previous document
  // answer before Chrome replaces it. Reuse that document, otherwise wait for
  // the requested URL to finish loading before sending any UI command.
  if(current.url!==url||current.pendingUrl)await chrome.tabs.update(tabId,{url,active:true});
  const end=Date.now()+20000;let loaded=false;
  do{const tab=await chrome.tabs.get(tabId);if(tab.url===url&&tab.status==="complete"&&!tab.pendingUrl){loaded=true;break;}await new Promise(r=>setTimeout(r,500));}while(Date.now()<end);
  if(!loaded)throw new Error("browser_unavailable");await activate(tabId,command);
}
const failure=e=>e?.message==="content_script_missing"?"browser_unavailable":["login_required","captcha","sender_mismatch","recipient_unavailable","platform_restricted","browser_unavailable"].includes(e?.message)?e.message:"unconfirmed_result";
async function finish(connection,journal,outcome,reason,observation=null,diagnostic){
  const result=await api("finish",{...grantInput(journal),outcome,reason,observation,...(diagnostic?{ui_diagnostic:diagnostic}:{})},connection);
  await store.remove("journal");await store.set({lastResult:{jobId:journal.grant.job_id,outcome:result.state,reason,stage:journal.stage,at:new Date().toISOString()}});
}
async function execute(connection,grant,tabId){
  let journal={grant,phase:"preparing",stage:"context"},command;await store.set({journal});
  const stage=async value=>{journal={...journal,stage:value};await store.set({journal});};
  try{
    const job=await api("context",grantInput(journal),connection);
    if(job.state!=="preparing"||job.sender!==connection.sender)throw new Error("sender_mismatch");
    command={job_id:job.id,sender:job.sender,recipient:job.recipient,body:job.body};
    await navigate(tabId,job.recipient_url,command);
    await stage("profile");
    await waitMessage(tabId,{action:"profile",...command});
    await stage("open");
    await activate(tabId,command);
    await waitMessage(tabId,{action:"open",...command},15000);
    await stage("prepare");
    await activate(tabId,command);
    let prepared;
    try{prepared=await waitMessage(tabId,{action:"prepare",...command},15000);}catch(error){
      if(error.message!=="recipient_unavailable")throw error;
      // Only a site navigation link selected by the approved profile's Message
      // action is eligible. Recipient ownership is rechecked after navigation.
      const selected=await message(tabId,{action:"conversation_link",...command}),url=new URL(selected.direct_url);
      if(url.origin!=="https://www.instagram.com"||!/^\/direct\/t\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)||url.search||url.hash||url.username||url.password)throw error;
      await navigate(tabId,url.href,command);prepared=await waitMessage(tabId,{action:"prepare",...command},15000);
    }
    const refreshed=await api("heartbeat",{observed_username:prepared.observation.sender,reason:"ready"},connection);if(!refreshed.ready)throw new Error("sender_mismatch");
    // Persist before arm: a lost response can never lead to a second Send.
    journal={...journal,phase:"arming",stage:"arm"};await store.set({journal});
    const permit=await api("arm",{...grantInput(journal),observation:prepared.observation},connection);
    if(!permit.send_permitted||Date.parse(permit.expires_at)<=Date.now())throw new Error("unconfirmed_result");
    journal={...journal,phase:"sending",stage:"send"};await store.set({journal});
    // A single dispatch only. No timeout/retry helper is used for this action.
    await message(tabId,{action:"send",...command,permit});
    journal={...journal,phase:"verifying",stage:"verify"};await store.set({journal});
    const verified=await waitMessage(tabId,{action:"verify",...command},20000);
    await finish(connection,journal,"sent","confirmed_on_screen",verified.observation);
  }catch(e){let diagnostic={stage:journal.stage};if(command){try{const snapshot=await message(tabId,{action:"diagnostic",...command});diagnostic={...snapshot.diagnostic,stage:journal.stage};}catch{/* No unrelated DOM or credential text is collected. */}}const reason=e.message==="recipient_unavailable"?({profile:"recipient_profile_unavailable",open:"recipient_button_unavailable",prepare:"recipient_composer_unavailable"}[journal.stage]??"recipient_unavailable"):failure(e);await finish(connection,journal,journal.phase==="preparing"?"blocked":"unknown",reason,null,diagnostic);}
}
async function review(connection,jobId,tabId){
  let command;try{
    const job=await api("review-context",{job_id:jobId},connection);if(job.state==="sent"){await store.set({lastResult:{jobId,outcome:"sent",reason:"confirmed_on_recheck",at:new Date().toISOString()}});return;}
    if(job.state!=="unknown"||job.send_permitted!==false||job.sender!==connection.sender)throw new Error("unconfirmed_result");
    command={job_id:job.id,sender:job.sender,recipient:job.recipient,body:job.body};await navigate(tabId,job.recipient_url,command);
    let observed;try{observed=await message(tabId,{action:"inspect_sent",...command});}catch(error){
      if(error.message!=="recipient_unavailable")throw error;
      await waitMessage(tabId,{action:"profile",...command});await waitMessage(tabId,{action:"open",...command},15000);await activate(tabId,command);observed=await waitMessage(tabId,{action:"inspect_sent",...command},15000);
    }
    const result=await api("review-finish",{job_id:jobId,observation:observed.observation},connection);await store.set({lastResult:{jobId,outcome:result.state,reason:"confirmed_on_recheck",at:new Date().toISOString()}});
  }catch{let diagnostic={stage:"verify"};if(command){try{const result=await message(tabId,{action:"diagnostic",...command});diagnostic={...result.diagnostic,stage:"verify"};}catch{/* Never collect unrelated inbox text. */}}try{await api("review-finish",{job_id:jobId,observation:null,ui_diagnostic:diagnostic},connection);}catch{/* The original unknown remains blocked; never send again. */}}
}
async function previewFinish(connection,journal){
  const permission=await api('preview-check',journal.grant,connection);
  if(!permission.open_permitted||journal.sender!==connection.sender){for(const result of journal.results.filter(r=>r.state==='opened'))Object.assign(result,{state:'unavailable',reason:'browser_unavailable',source_url:null,observed_at:new Date().toISOString(),draft_present:false});}
  const opened=journal.results.filter(r=>r.state==='opened');
  for(let index=0;index<opened.length;index++){
    const result=opened[index],tabId=journal.tabs[index],command={kind:'chat_preview',job_id:journal.grant.job_id,sender:journal.sender,recipient:result.recipient};
    try{await chrome.tabs.get(tabId);await activate(tabId,command);const observed=await message(tabId,{action:'inspect_preview',...command});if(observed.recipient!==result.recipient)throw new Error('recipient_unavailable');Object.assign(result,{source_url:observed.source_url,observed_at:observed.observed_at,draft_present:observed.draft_present});}
    catch{Object.assign(result,{state:'unavailable',reason:'browser_unavailable',source_url:null,observed_at:new Date().toISOString(),draft_present:false});try{await chrome.tabs.remove(tabId);}catch{/* The operator may already have closed it. */}}
  }
  await store.set({previewJournal:journal});
  const result=await api('preview-finish',{job_id:journal.grant.job_id,claim_token:journal.grant.claim_token,results:journal.results},connection);await store.remove('previewJournal');await store.set({lastPreview:{jobId:journal.grant.job_id,state:result.state,opened:journal.results.filter(r=>r.state==='opened').length,at:new Date().toISOString()}});
}
async function openPreview(connection,grant){
  const journal={grant:{job_id:grant.job_id,claim_token:grant.claim_token},sender:grant.sender,results:[],tabs:[]};await store.set({previewJournal:journal});
  if(grant.sender!==connection.sender)throw new Error('sender_mismatch');const end=Date.now()+480000;
  for(const target of grant.targets){
    if(journal.results.filter(r=>r.state==='opened').length>=grant.goal||Date.now()>end)break;
    let tabId;try{
      const permission=await api('preview-check',journal.grant,connection);if(!permission.open_permitted)break;
      const expected=`https://www.instagram.com/${target.recipient}/`;if(target.profile_url!==expected||!/^[a-z0-9._]{1,30}$/.test(target.recipient))throw new Error('recipient_unavailable');
      const tab=await chrome.tabs.create({url:expected,active:true});tabId=tab.id;
      const command={kind:'chat_preview',job_id:grant.job_id,sender:grant.sender,recipient:target.recipient};await navigate(tabId,expected,command);await waitMessage(tabId,{action:'profile',...command});await waitMessage(tabId,{action:'open',...command},8000);await activate(tabId,command);const observed=await waitMessage(tabId,{action:'inspect_preview',...command},10000);
      if(observed.recipient!==target.recipient)throw new Error('recipient_unavailable');journal.results.push({candidate_id:target.candidate_id,recipient:target.recipient,state:'opened',reason:'chat_opened',source_url:observed.source_url,observed_at:observed.observed_at,draft_present:observed.draft_present});journal.tabs.push(tabId);await store.set({previewJournal:journal});
    }catch(error){const reason=failure(error);journal.results.push({candidate_id:target.candidate_id,recipient:target.recipient,state:'unavailable',reason:reason==='unconfirmed_result'?'browser_unavailable':reason,source_url:null,observed_at:new Date().toISOString(),draft_present:false});await store.set({previewJournal:journal});if(Number.isInteger(tabId)){try{await chrome.tabs.remove(tabId);}catch{/* Only a tab created by this preview may be closed. */}}if(error.status===403||['sender_mismatch','captcha','login_required','platform_restricted'].includes(reason))break;}
  }
  await previewFinish(connection,journal);
}
async function tick(){
  if(running)return;running=true;
  try{
    await secured;const {connection,journal,paused,previewJournal}=await store.get(["connection","journal","paused","previewJournal"]);if(!connection||paused)return;
    if(Date.parse(connection.expires_at)<=Date.now()){await store.set({status:"연결 만료 · ERUTY에서 다시 연결하세요"});return;}
    if(journal){await finish(connection,journal,journal.phase==="preparing"?"blocked":"unknown","unconfirmed_result");return;}
    if(previewJournal){await previewFinish(connection,previewJournal);return;}
    const tabId=await tabFor(connection);let probe;
    try{probe=await waitMessage(tabId,{action:"probe",sender:connection.sender},12000,true);}
    catch(e){
      // Extension reload invalidates old content scripts. Refresh our dedicated
      // tab before claiming any request; never repair/reload an armed job.
      if(e.message==="content_script_missing"){try{await chrome.tabs.reload(tabId);probe=await waitMessage(tabId,{action:"probe",sender:connection.sender});}catch(recovery){e=recovery;}}
      if(!probe){await api("heartbeat",{observed_username:"",reason:failure(e)==="unconfirmed_result"?"browser_unavailable":failure(e)},connection);await store.set({status:failure(e)});return;}
    }
    const heartbeat=await api("heartbeat",{observed_username:probe.sender,reason:"ready"},connection);await store.set({status:heartbeat.ready?"ready":heartbeat.reason});if(!heartbeat.ready)return;
    const {lastResult,reviewAttempted}=await store.get(["lastResult","reviewAttempted"]);
    if(lastResult?.outcome==="unknown"&&reviewAttempted!==lastResult.jobId){await store.set({reviewAttempted:lastResult.jobId});await review(connection,lastResult.jobId,tabId);return;}
    const preview=await api('preview-next',{},connection);if(preview.assignment){await openPreview(connection,preview.assignment);return;}
    const next=await api("next",{},connection);if(next.assignment)await execute(connection,next.assignment,tabId);
  }catch(e){await store.set({status:e.message==="forbidden"?"연결 해제·만료 · ERUTY에서 확인하세요":"서버 연결 확인 필요",...(e.message==="forbidden"?{paused:true}:{})});}
  finally{running=false;}
}
async function schedule(){await secured;await chrome.alarms.create(ALARM,{periodInMinutes:0.5});}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===ALARM)void tick();});
chrome.runtime.onInstalled.addListener(()=>{void schedule().then(tick);});
chrome.runtime.onStartup.addListener(()=>{void schedule().then(tick);});
chrome.runtime.onMessageExternal.addListener((request,sender,respond)=>{
  let url;try{url=new URL(sender.url);}catch{return;}
  if(url.origin!==ORIGIN||request?.type!=="ERUTY_PAIR"||!/^\/settings\/browser-executor\/?$/.test(url.pathname))return;
  void (async()=>{await secured;const {journal,connection}=await store.get(["journal","connection"]);if(journal)throw new Error("진행 중인 연락 결과를 먼저 확인해 주세요.");if(connection)throw new Error("기존 실행기 연결을 확장 프로그램에서 해제한 뒤 연결하세요.");const pair=await api("pair",{code:request.code,extension_id:chrome.runtime.id});await store.set({connection:pair,paused:false,status:"확인 중"});await schedule();respond({ok:true});void tick();})().catch(()=>respond({ok:false,error:"연결에 실패했습니다. 기존 연결 또는 만료된 연결 요청을 확인해 주세요."}));return true;
});
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||sender.tab||sender.url!==chrome.runtime.getURL("popup.html"))return;
  if(request?.type==="ERUTY_CHECK"){void store.remove("reviewAttempted").then(tick);respond({ok:true});}
  if(request?.type==="ERUTY_DISCONNECT"){void (async()=>{await secured;const {journal,connection}=await store.get(["journal","connection"]);if(running){respond({ok:false});return;}await store.set({paused:true});if(connection){try{await api("disconnect",{},connection);}catch(e){if(e.status!==403)throw e;}}if(journal)await store.set({lastResult:{jobId:journal.grant.job_id,outcome:"unknown",reason:"disconnected",at:new Date().toISOString()}});await store.remove(["connection","journal","previewJournal"]);await store.set({status:"연결 해제됨"});respond({ok:true});})().catch(()=>respond({ok:false}));return true;}
});

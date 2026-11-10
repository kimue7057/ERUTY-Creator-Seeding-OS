import {test,expect,type Page} from "@playwright/test";
import {readFileSync} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
const script=readFileSync("extensions/instagram-executor/instagram.js","utf8");
const body="SYNTHETIC approved test message";
declare global {interface Window {erutySyntheticListener:(request:unknown,sender:{id:string},respond:(r:{ok:boolean;reason?:string;observation?:unknown})=>void)=>void;erutySyntheticClicks:number;}}
async function fixture(page:Page,pending=false){
  await page.route("**/synthetic-executor-fixture",route=>route.fulfill({contentType:"text/html",body:`<style>nav a{display:block;width:40px;height:40px}section{margin-left:220px} [contenteditable]{min-height:40px;border:1px solid}</style><nav><a href="/synthetic_company/"><img alt="synthetic_company profile picture" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></a></nav><section><a aria-label="Open the profile page of synthetic_recipient" href="/synthetic_recipient/">synthetic_recipient</a><div id="messages"></div><div role="textbox" contenteditable="true"></div><button id="send">Send</button></section>`}));
  await page.goto("/synthetic-executor-fixture");
  await page.evaluate(pending=>{
    Object.defineProperty(window,"chrome",{value:{runtime:{id:"synthetic_extension",onMessage:{addListener:(fn:Window["erutySyntheticListener"])=>{window.erutySyntheticListener=fn;}}}}});window.erutySyntheticClicks=0;
    document.querySelector('#send')!.addEventListener('click',()=>{window.erutySyntheticClicks++;const editor=document.querySelector<HTMLElement>('[contenteditable]')!,row=document.createElement('div'),text=document.createElement('span');text.textContent=editor.innerText;row.appendChild(text);const action=document.createElement('button');action.setAttribute('aria-label','Reply to synthetic_company message');row.appendChild(action);document.querySelector('#messages')!.appendChild(row);editor.innerText="";if(pending){const status=document.createElement('span');status.textContent="Sending";row.appendChild(status);}});
  },pending);await page.addScriptTag({content:script});
}
const dispatch=(page:Page,request:unknown)=>page.evaluate(request=>new Promise<{ok:boolean;reason?:string;observation?:unknown}>(resolve=>window.erutySyntheticListener(request,{id:"synthetic_extension"},resolve)),request);
function command(){const id=randomUUID();return{type:"ERUTY_INSTAGRAM",job_id:id,sender:"synthetic_company",recipient:"synthetic_recipient",body};}
function permit(job_id:string){return{job_id,send_permitted:true,expires_at:new Date(Date.now()+120000).toISOString(),body_sha256:createHash('sha256').update(body).digest('hex')};}
test("synthetic DOM adapter sends exact text once, verifies outgoing attribution and rejects repeat Send",async({page})=>{
  await fixture(page);const c=command();expect((await dispatch(page,{...c,action:"prepare"})).ok).toBe(true);
  expect((await dispatch(page,{...c,action:"send",permit:permit(c.job_id)})).ok).toBe(true);expect((await dispatch(page,{...c,action:"verify"})).ok).toBe(true);
  expect((await dispatch(page,{...c,action:"send",permit:permit(c.job_id)})).ok).toBe(false);expect(await page.evaluate(()=>window.erutySyntheticClicks)).toBe(1);
});
test("synthetic wrong recipient or switched sender cannot send an armed proposal",async({page})=>{
  await fixture(page);const c=command();expect((await dispatch(page,{...c,recipient:"synthetic_other",action:"prepare"})).ok).toBe(false);
  expect((await dispatch(page,{...c,action:"prepare"})).ok).toBe(true);
  await page.locator('nav a').evaluate(a=>{a.setAttribute('href','/synthetic_other/');a.querySelector('img')!.setAttribute('alt','synthetic_other profile picture');});
  const result=await dispatch(page,{...c,action:"send",permit:permit(c.job_id)});expect(result.reason).toBe("sender_mismatch");expect(await page.evaluate(()=>window.erutySyntheticClicks)).toBe(0);
});
test("synthetic Sending status never becomes a confirmed result and cannot trigger a second click",async({page})=>{
  await fixture(page,true);const c=command();await dispatch(page,{...c,action:"prepare"});await dispatch(page,{...c,action:"send",permit:permit(c.job_id)});
  expect((await dispatch(page,{...c,action:"verify"})).ok).toBe(false);expect((await dispatch(page,{...c,action:"send",permit:permit(c.job_id)})).ok).toBe(false);expect(await page.evaluate(()=>window.erutySyntheticClicks)).toBe(1);
});
test("synthetic incoming copy of the text cannot borrow attribution from an older company message",async({page})=>{
  await fixture(page);const c=command();await dispatch(page,{...c,action:"prepare"});await dispatch(page,{...c,action:"send",permit:permit(c.job_id)});
  await page.locator('#messages').evaluate(messages=>{messages.querySelector('button')!.setAttribute('aria-label','Reply to shadow_synthetic_company message');const older=document.createElement('div');older.textContent='SYNTHETIC older unrelated outgoing';const action=document.createElement('button');action.setAttribute('aria-label','Reply to synthetic_company message');older.appendChild(action);messages.appendChild(older);});
  expect((await dispatch(page,{...c,action:"verify"})).ok).toBe(false);expect(await page.evaluate(()=>window.erutySyntheticClicks)).toBe(1);
});
test("synthetic failure diagnostics contain bounded UI controls and counts without message or page text",async({page})=>{
  await fixture(page);const c=command();
  await page.locator('section').evaluate(section=>{const b=document.createElement('button');b.textContent='Message';b.disabled=true;section.appendChild(b);const privateText=document.createElement('p');privateText.textContent='SYNTHETIC unrelated private thread text';section.appendChild(privateText);});
  const result=await dispatch(page,{...c,action:"diagnostic"});expect(result.ok).toBe(true);const text=JSON.stringify(result);expect(text).not.toContain('unrelated private thread text');expect(text).not.toContain(body);expect(text).toContain('"editor_count":1');expect(text).toContain('"enabled":false');
});
test("synthetic conversation fallback accepts only a newly selected site message link",async({page})=>{
  await fixture(page);await page.evaluate(()=>history.pushState(null,'','/synthetic_recipient/'));
  await page.locator('section').evaluate(section=>{const b=document.createElement('button');b.textContent='Message';b.id='profile-message';b.addEventListener('click',()=>{document.querySelector<HTMLAnchorElement>('#nav-message')!.href='/direct/t/synthetic_thread/';});section.appendChild(b);const a=document.createElement('a');a.id='nav-message';a.href='/direct/inbox/';a.innerHTML='<svg aria-label="Messages" width="24" height="24"></svg>';document.querySelector('nav')!.appendChild(a);});
  const c=command();expect((await dispatch(page,{...c,action:"conversation_link"})).ok).toBe(false);expect((await dispatch(page,{...c,action:"open"})).ok).toBe(true);
  const result=await dispatch(page,{...c,action:"conversation_link"}) as {ok:boolean;direct_url:string};expect(result.ok).toBe(true);expect(result.direct_url).toBe('http://127.0.0.1:3000/direct/t/synthetic_thread/');
});
test("synthetic profile links cannot supply a conversation fallback or authorize a different recipient",async({page})=>{
  await fixture(page);await page.evaluate(()=>history.pushState(null,'','/synthetic_recipient/'));await page.locator('section').evaluate(section=>{const a=document.createElement('a');a.href='/direct/t/synthetic_bio_injection/';a.textContent='Messages';section.appendChild(a);const b=document.createElement('button');b.textContent='Message';section.appendChild(b);});const c=command();await dispatch(page,{...c,action:"open"});expect((await dispatch(page,{...c,action:"conversation_link"})).ok).toBe(false);expect((await dispatch(page,{...c,recipient:'synthetic_other',action:'prepare'})).ok).toBe(false);expect(await page.evaluate(()=>window.erutySyntheticClicks)).toBe(0);
});

test("synthetic rendered text is verified even when the input command reports false",async({page})=>{
  await fixture(page);const c=command();await page.evaluate(()=>{const insert=document.execCommand.bind(document);document.execCommand=(command,show,value)=>{insert(command,show,value);return false;};});
  expect((await dispatch(page,{...c,action:"prepare"})).ok).toBe(true);await expect(page.locator('[contenteditable]')).toHaveText(body);
  expect((await dispatch(page,{...c,action:"send",permit:permit(c.job_id)})).ok).toBe(true);expect((await dispatch(page,{...c,action:"verify"})).ok).toBe(true);expect(await page.evaluate(()=>window.erutySyntheticClicks)).toBe(1);
});

test("synthetic unchanged approved draft is usable while unrelated text is preserved",async({page})=>{
  await fixture(page);const c=command();await page.locator('[contenteditable]').fill('SYNTHETIC unrelated draft');expect((await dispatch(page,{...c,action:"prepare"})).ok).toBe(false);await expect(page.locator('[contenteditable]')).toHaveText('SYNTHETIC unrelated draft');expect(await page.evaluate(()=>window.erutySyntheticClicks)).toBe(0);
  const diagnostic=await dispatch(page,{...c,action:"diagnostic"});expect(JSON.stringify(diagnostic)).toContain('"editor_state":"different"');expect(JSON.stringify(diagnostic)).not.toContain('unrelated draft');
  await page.locator('[contenteditable]').fill(body);await page.evaluate(()=>{document.execCommand=()=>{throw Error('An exact draft must not be changed');};});
  expect((await dispatch(page,{...c,action:"prepare"})).ok).toBe(true);expect((await dispatch(page,{...c,action:"send",permit:permit(c.job_id)})).ok).toBe(true);expect(await page.evaluate(()=>window.erutySyntheticClicks)).toBe(1);
});

test("synthetic existing matching outgoing message stops before editing or sending",async({page})=>{
  await fixture(page);const c=command();await page.locator('#messages').evaluate((messages,text)=>{const row=document.createElement('div'),span=document.createElement('span'),action=document.createElement('button');span.textContent=text;action.setAttribute('aria-label','Reply to synthetic_company message');row.append(span,action);messages.appendChild(row);},body);
  expect((await dispatch(page,{...c,action:"prepare"})).ok).toBe(false);await expect(page.locator('[contenteditable]')).toBeEmpty();expect(await page.evaluate(()=>window.erutySyntheticClicks)).toBe(0);
});

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

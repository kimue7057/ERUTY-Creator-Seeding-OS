import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {outreachExtensionId} from "../src/lib/outreach/executor-contracts";
test("Chrome executor recovers a crashed send as unknown without opening Instagram or clicking again",async()=>{
  const requests:{action:string;input:Record<string,unknown>}[]=[];let tabCalls=0;const storage:Record<string,unknown>={connection:{token:"a".repeat(64),sender:"synthetic_company",expires_at:new Date(Date.now()+60000).toISOString()},journal:{grant:{job_id:crypto.randomUUID(),claim_token:"b".repeat(64)},phase:"sending"}};
  let alarm:(alarm:{name:string})=>void=()=>{};
  const listener={addListener:()=>{}};
  const chrome={storage:{local:{setAccessLevel:async()=>{},get:async()=>({...storage}),set:async(v:Record<string,unknown>)=>Object.assign(storage,v),remove:async(key:string)=>{delete storage[key];}}},tabs:{get:async()=>{tabCalls++;},create:async()=>{tabCalls++;},sendMessage:async()=>{tabCalls++;}},runtime:{id:outreachExtensionId,onInstalled:listener,onStartup:listener,onMessageExternal:listener,onMessage:listener},alarms:{create:async()=>{},onAlarm:{addListener:(fn:typeof alarm)=>{alarm=fn;}}}};
  const context=vm.createContext({chrome,AbortSignal,URL,setTimeout,clearTimeout,Date,fetch:async(url:string,options:{body:string})=>{requests.push({action:url.split('/').at(-1)!,input:JSON.parse(options.body)});return{ok:true,json:async()=>({state:"unknown"})};}});
  vm.runInContext(readFileSync("extensions/instagram-executor/background.js","utf8"),context);alarm({name:"eruty-outreach"});
  for(let n=0;n<20&&storage.journal;n++)await new Promise(r=>setTimeout(r,5));assert.equal(tabCalls,0);assert.equal(requests.length,1);assert.equal(requests[0].action,"finish");assert.equal(requests[0].input.outcome,"unknown");assert.equal(storage.journal,undefined);
});
test("executor requests only its explicit service and Instagram permissions",()=>{const manifest=JSON.parse(readFileSync("extensions/instagram-executor/manifest.json","utf8"));assert.deepEqual(manifest.permissions,["storage","alarms"]);assert.deepEqual(manifest.host_permissions,["https://www.instagram.com/*","https://eruty-creator-seeding-os.vercel.app/*"]);assert.equal(manifest.incognito,"not_allowed");assert.ok(!manifest.externally_connectable.ids);});

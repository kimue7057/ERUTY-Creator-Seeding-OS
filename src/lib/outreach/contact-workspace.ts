import type {ContactListRow} from './contacts';
// Advance by the actual batch length, wrapping without skipping the tail.
export function nextSyncBatch<T>(rows:T[],cursor:number,size=3){
 if(!rows.length)return{items:[] as T[],next:0};
 const start=cursor>=0&&cursor<rows.length?cursor:0,items=rows.slice(start,start+size);
 return{items,next:start+items.length>=rows.length?0:start+items.length};
}
export function contactTask(row:Pick<ContactListRow,'blocked'|'lastDirection'|'syncError'|'lastSyncedAt'|'progress'>){return row.blocked?'결과 확인 필요':row.syncError||!row.lastSyncedAt?'수신 확인 필요':['closed','declined','hold'].includes(row.progress)?'보류·종료':row.lastDirection==='in'?'회신 필요':'답장 대기';}
const priorities=['결과 확인 필요','회신 필요','수신 확인 필요','답장 대기','보류·종료'];
export function groupContacts(rows:ContactListRow[]){
 const groups=new Map<string,ContactListRow[]>();
 for(const row of rows){const key=row.workflowId??row.id;groups.set(key,[...(groups.get(key)??[]),row]);}
 return [...groups.entries()].map(([id,items])=>{
  const ordered=[...items].sort((a,b)=>priorities.indexOf(contactTask(a))-priorities.indexOf(contactTask(b))||new Date(b.lastMessageAt).getTime()-new Date(a.lastMessageAt).getTime());
  return{id,rows:items,primary:ordered[0],task:contactTask(ordered[0])};
 });
}
export function campaignContactCounts(rows:ContactListRow[]){
 const result=new Map<string,{contacted:number;reply:number;waiting:number;agreed:number}>();
 for(const group of groupContacts(rows)){const r=group.primary;if(!r.campaignId)continue;const count=result.get(r.campaignId)??{contacted:0,reply:0,waiting:0,agreed:0};count.contacted++;if(group.task==='회신 필요')count.reply++;if(group.task==='답장 대기')count.waiting++;if(r.progress==='agreed')count.agreed++;result.set(r.campaignId,count);}
 return result;
}
export function safeContactReturn(value:string|undefined){
 if(!value||value.length>3000)return '/contacts';
 try{const url=new URL(value,'https://eruty.invalid');if(url.origin!=='https://eruty.invalid')return '/contacts';return url.pathname==='/contacts'||/^\/campaigns\/[a-f0-9-]{36}$/.test(url.pathname)?url.pathname+url.search:'/contacts';}catch{return '/contacts';}
}

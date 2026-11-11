'use client';
import {useEffect,useState,useTransition} from 'react';
import {loadChatPreviews,requestChatPreview,requestComposePreview} from '@/app/(app)/settings/browser-executor/actions';
import {chatPreviewStates} from '@/lib/outreach/chat-preview-contracts';
type Candidate={id:string;handle:string|null;name:string|null;campaignId:string;campaign:string};
const composeStates={queued:'본문 입력 대기',running:'본문 입력 확인 중',completed:'발송 전 본문 준비 완료',partial:'일부 본문 준비 완료',blocked:'본문 준비 중단'};
const hasBreak=(value:string)=>/[\r\n\u2028\u2029]/.test(value);
export function ChatPreview({accounts,candidates,writable}:{accounts:{id:string;label:string;expectedIdentity:string}[];candidates:Candidate[];writable:boolean}){
 const [accountId,setAccount]=useState(accounts[0]?.id??''),[campaignId,setCampaign]=useState(candidates[0]?.campaignId??''),[ids,setIds]=useState<string[]>([]),[busy,start]=useTransition(),[notice,setNotice]=useState(''),[data,setData]=useState<Awaited<ReturnType<typeof loadChatPreviews>>|null>(null),[requestId,setRequest]=useState<string|null>(null),[uncertain,setUncertain]=useState(false),[editing,setEditing]=useState<string|null>(null),[bodies,setBodies]=useState<Record<string,string>>({}),[composeId,setComposeId]=useState<string|null>(null);
 useEffect(()=>{let active=true;const load=async()=>{try{const result=await loadChatPreviews();if(active)setData(result);}catch{/* Preserve the last confirmed state. */}};const initial=setTimeout(()=>void load(),0),timer=setInterval(()=>void load(),10000);return()=>{active=false;clearTimeout(initial);clearInterval(timer);};},[]);
 const campaigns=[...new Map(candidates.map(c=>[c.campaignId,c.campaign])).entries()],goal=Math.min(5,ids.length),jobs=data&&'jobs'in data?data.jobs:[];
 return <section id="chat-preview" className="surface browser-contact-composer">
  <h2>후보 채팅창만 열기</h2><p className="description">선택한 후보 중 대화를 열 수 있는 사람의 채팅창을 최대 5개 남깁니다. 이 단계에서는 본문을 입력하거나 발송하지 않습니다.</p>
  <label>회사 계정<select className="input" aria-label="미리보기 회사 계정" value={accountId} disabled={busy||!writable||uncertain} onChange={e=>{setAccount(e.target.value);setRequest(null);}}>{accounts.map(a=><option key={a.id} value={a.id}>{a.label} · @{a.expectedIdentity}</option>)}</select></label>
  <label>캠페인<select className="input" aria-label="미리보기 캠페인" value={campaignId} disabled={busy||!writable||uncertain} onChange={e=>{setCampaign(e.target.value);setIds([]);setRequest(null);}}>{campaigns.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
  <div className="chat-preview-candidates">{candidates.filter(c=>c.campaignId===campaignId).map(c=><label key={c.id}><input type="checkbox" aria-label={`채팅 미리보기 @${c.handle}`} checked={ids.includes(c.id)} disabled={busy||!writable||uncertain||ids.length>=15&&!ids.includes(c.id)} onChange={e=>{setIds(current=>e.target.checked?[...current,c.id]:current.filter(id=>id!==c.id));setRequest(null);}}/><span>@{c.handle}{c.name&&<small> · {c.name}</small>}</span></label>)}</div>
  <p className="description">후보 {ids.length}/15명 선택 · 채팅창 {goal}개 목표 · 발송 0건</p>
  <button className="btn btn-primary" disabled={!writable||busy||uncertain||!accountId||!goal} onClick={()=>start(async()=>{const id=requestId??crypto.randomUUID();setRequest(id);try{const result=await requestChatPreview({id,accountId,campaignId,candidateIds:ids,goal});if('error'in result)setNotice(result.error??'요청 실패');else{setNotice('회사 Chrome에 채팅창 열기만 요청했습니다.');setRequest(null);setData(await loadChatPreviews());}}catch{setUncertain(true);setNotice('요청 응답을 확인하지 못했습니다. 아래 기록을 확인하세요. 중복 요청은 중지했습니다.');}})}>채팅창 {goal||5}개만 열기</button>
  <p role="status">{notice}</p>
  {jobs?.map(job=>{
   const composing=job.mode==='compose',opened=job.results.filter(r=>r.state==='opened'),ready=job.results.filter(r=>r.state==='drafted').length;
   return <article className="browser-outreach-receipt" data-preview-id={job.id} key={job.id}>
    <strong>{composing?composeStates[job.state]:chatPreviewStates[job.state]} · @{job.sender}</strong>
    <p>{composing?`본문 준비 ${ready}/${job.goal}명 · 발송 0건`:`채팅창 ${opened.length}/${job.goal}개 · 본문 입력·발송 없음`}</p>
    {job.results.map(r=><p key={r.candidate_id}>@{r.recipient} · {r.state==='drafted'?'입력 문장 확인됨':r.state==='opened'?'채팅창 확인됨':r.reason==='draft_conflict'||r.reason==='draft_text_mismatch'?'문안 불일치 · 입력 내용 보존':'중단'}{'formatting'in r&&r.formatting==='whitespace_normalized'?' · 줄바꿈·공백 표시 차이 있음':''}{'draft_present'in r&&r.draft_present?' · 기존 입력 내용 보존':''}</p>)}
    {composing&&job.messages.map(message=><details key={message.candidate_id}><summary>@{job.targets.find(t=>t.candidate_id===message.candidate_id)?.recipient} 준비한 문안</summary><p style={{whiteSpace:'pre-wrap'}}>{message.body}</p></details>)}
    {!composing&&opened.length>0&&writable&&<button className="btn" disabled={busy||uncertain} onClick={()=>{setEditing(job.id);setBodies({});setComposeId(null);}}>제안문 작성 · 발송 전 준비</button>}
    {editing===job.id&&<div data-compose-source={job.id}>
     <h3>제안문 작성 → 회사 Chrome 입력 → 발송 전 멈춤</h3><p className="description">수신자별 문안을 검토한 뒤 입력만 요청하세요. Instagram 첫 제안은 한 문단으로 준비합니다. 줄바꿈이 있으면 아래에서 공백으로 정리하고 내용을 다시 확인하세요. 다른 초안은 덮어쓰지 않으며 이 요청에는 발송 권한이 없습니다.</p>
     {opened.map(result=><label key={result.candidate_id}>@{result.recipient} 제안문<textarea className="input" aria-label={`제안문 @${result.recipient}`} rows={8} maxLength={1000} value={bodies[result.candidate_id]??''} disabled={busy||uncertain} onChange={e=>{setBodies(current=>({...current,[result.candidate_id]:e.target.value}));setComposeId(null);}}/></label>)}
     {opened.some(r=>hasBreak(bodies[r.candidate_id]??''))&&<button className="btn" disabled={busy||uncertain} onClick={()=>{setBodies(current=>Object.fromEntries(Object.entries(current).map(([id,body])=>[id,body.replace(/\s*[\r\n\u2028\u2029]+\s*/g,' ')])));setComposeId(null);}}>줄바꿈을 공백으로 정리</button>}
     <button className="btn btn-primary" disabled={busy||uncertain||opened.some(r=>!bodies[r.candidate_id]?.trim()||hasBreak(bodies[r.candidate_id]))} onClick={()=>start(async()=>{const id=composeId??crypto.randomUUID();setComposeId(id);try{const result=await requestComposePreview({id,sourcePreviewId:job.id,messages:opened.map(r=>({candidateId:r.candidate_id,body:bodies[r.candidate_id]}))});if('error'in result)setNotice(result.error??'요청 실패');else{setNotice('본문 입력만 요청했습니다. 회사 Chrome은 발송 전에 멈춥니다.');setEditing(null);setComposeId(null);setData(await loadChatPreviews());}}catch{setUncertain(true);setNotice('본문 입력 요청의 응답을 확인하지 못했습니다. 아래 기록을 확인하세요. 중복 요청은 중지했습니다.');}})}>본문 입력 후 멈추기 · {opened.length}명</button>
    </div>}
   </article>;
  })}
 </section>;
}

"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Mail, Instagram, Music2, Plus, ArrowUpRight, CheckCircle2, Link2 } from "lucide-react";
import { accountAction } from "@/app/(app)/settings/accounts/actions";
import { providerNames, senderStates, type SenderProvider } from "@/lib/outreach/contracts";
import type { PublicSenderAccount } from "@/lib/outreach/accounts";
import { useHydrated } from "@/components/use-hydrated";
import { ConnectionTest } from "./connection-test";
import { InstagramSystemUser } from "./instagram-system-user";
const icons={google:Mail,instagram:Instagram,tiktok:Music2};
function ConnectionCard({account,available,writable,systemUserRevision}:{account:PublicSenderAccount;available:boolean;writable:boolean;systemUserRevision?:number}) {
  const [state,action,pending]=useActionState(accountAction,{}),[confirm,setConfirm]=useState(false),Icon=icons[account.provider];
  const connected=account.status==="connected";
  return <article className="sender-card surface">
    <div className="sender-card-top"><span className={`sender-icon ${account.provider}`}><Icon size={22}/></span><div><p className="eyebrow">{providerNames[account.provider]}</p><h2>{account.label}</h2></div><span className={`badge ${connected?"badge-green":""}`}>{senderStates[account.status]}</span></div>
    <p className="sender-identity">{account.provider!=="google"?"@":""}{account.identity??account.expectedIdentity}</p>
    <p className="description">{connected ? account.provider==="google"?"메일 발송 권한 연결 · 아래 주소에서 선택할 수 있습니다.":"로그인으로 계정 확인 · DM 발송 연결은 별도로 필요합니다.":"등록한 계정입니다. 서비스 로그인과 권한 승인을 마쳐야 연결됩니다."}</p>
    <div className="sender-addresses"><strong>발신 주소</strong>{account.addresses.length?account.addresses.map(a=><div key={a.address}><span>{a.address}</span><span className="muted">{a.primary?"기본":"승인된 추가 주소"}</span></div>):<p className="description">로그인 연결 후 확인됩니다.</p>}</div>
    {account.provider!=="google"&&<p className="outreach-note">{account.provider==="instagram"?"DM은 프로페셔널 계정과 메시지 권한, 수신자와의 대화 조건을 확인해야 합니다. 현재 버전은 계정 인증까지 연결합니다.":"TikTok 로그인은 계정 확인용입니다. 실제 DM은 Business Messaging 승인과 별도 연결이 필요합니다."}</p>}
    {!available&&<p className="outreach-note">회사 앱 등록이 필요합니다. <Link className="source-link" href="/settings/connections">연결 정보 등록하기 →</Link></p>}
    {account.verifiedAt&&<p className="description">마지막 계정 확인: {new Date(account.verifiedAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</p>}
    {writable&&<form action={action} className="sender-actions"><input type="hidden" name="id" value={account.id}/>
      {account.provider==="google"&&<label className="sender-alias-check"><input type="checkbox" name="aliases"/>추가 발신 주소도 연결 <span className="muted">Google 메일 설정 권한 추가</span></label>}
      <button className="btn btn-primary" name="action" value="connect" disabled={pending||!available}><Link2 size={14}/>{pending?"처리 중…":connected?"다시 로그인 · 권한 변경":"로그인 연결"}</button>
      {connected&&<button className="btn" name="action" value="sync" disabled={pending}>주소·상태 새로고침</button>}
      {!confirm&&account.status!=="disconnected"&&<button type="button" className="btn" disabled={pending} onClick={()=>setConfirm(true)}>연결 해제</button>}
      {confirm&&<div className="sender-disconnect"><p>ERUTY에 저장된 인증 정보를 삭제합니다. Google·SNS 자체의 앱 권한은 해당 서비스 설정에서 별도로 철회할 수 있습니다.</p><button className="btn" name="action" value="disconnect" disabled={pending} onClick={()=>setConfirm(false)}>연결 해제 확인</button><button className="btn" type="button" onClick={()=>setConfirm(false)}>취소</button></div>}
      <p role="status" className={state.error?"form-error":"description"}>{state.error??state.message}</p>
    </form>}
    {writable&&account.provider==="instagram"&&systemUserRevision!==undefined&&<InstagramSystemUser account={account} revision={systemUserRevision}/>}
    {writable&&connected&&account.provider==="google"&&<ConnectionTest accountId={account.id} addresses={account.addresses}/>}
  </article>;
}
export function AccountManager({accounts,availability,writable,instagramSystemUserRevision}:{accounts:PublicSenderAccount[];availability:Record<SenderProvider,boolean>;writable:boolean;instagramSystemUserRevision?:number}) {
  const hydrated=useHydrated();
  const [provider,setProvider]=useState<SenderProvider>("google"),[state,action,pending]=useActionState(accountAction,{}),[adding,setAdding]=useState(accounts.length===0);
  return <>
    <div className="outreach-intro"><div><CheckCircle2 size={18}/><span>계정을 여러 개 연결하고, 연락할 때 발신 계정과 주소를 선택하세요.</span></div>{writable&&<button className="btn btn-primary" disabled={!hydrated} onClick={()=>setAdding(!adding)}><Plus size={16}/>{adding?"계정 추가 닫기":"계정 추가"}</button>}</div>
    {adding&&writable&&<section className="surface sender-register"><h2>발신 계정 추가</h2><p className="description">회사에서 사용하는 주소나 아이디를 등록한 다음 서비스에 로그인합니다. 비밀번호는 ERUTY에 입력하지 않습니다.</p><form action={action}><input type="hidden" name="action" value="register"/>
      <label>서비스<select aria-label="서비스" className="input" name="provider" value={provider} disabled={!hydrated} onChange={e=>setProvider(e.target.value as SenderProvider)}>{Object.entries(providerNames).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
      <label>구분 이름<input className="input" name="label" placeholder="예: 본사 공식 계정 · 브랜드 A" maxLength={80} required/></label>
      <label>{provider==="google"?"회사 이메일 주소":"SNS 아이디"}<input key={provider} className="input" name="identity" type={provider==="google"?"email":"text"} placeholder={provider==="google"?"회사에서 사용하는 이메일":"@아이디"} maxLength={254} required autoComplete="off"/></label>
      <button className="btn btn-primary" disabled={pending}>{pending?"등록 중…":"계정 등록"}<ArrowUpRight size={15}/></button><p role="status" className={state.error?"form-error":"description"}>{state.error??state.message}</p>
    </form></section>}
    <div className="sender-grid">{accounts.map(account=><ConnectionCard key={account.id+account.updatedAt} account={account} available={availability[account.provider]} writable={writable} systemUserRevision={instagramSystemUserRevision}/>)}</div>
    {!accounts.length&&<p className="outreach-note">등록된 발신 계정이 없습니다. 회사 이메일과 SNS를 각각 추가하세요.</p>}
  </>;
}

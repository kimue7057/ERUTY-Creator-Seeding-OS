"use client";
import { useActionState, useState } from "react";
import { accountAction, type AccountActionState } from "@/app/(app)/settings/accounts/actions";
import type { PublicSenderAccount } from "@/lib/outreach/accounts";
import { useHydrated } from "@/components/use-hydrated";

export function InstagramSystemUser({account,revision}:{account:PublicSenderAccount;revision:number}) {
  const hydrated=useHydrated(),[token,setToken]=useState(""),[confirmed,setConfirmed]=useState(false);
  const [state,action,pending]=useActionState(async(previous:AccountActionState,form:FormData)=>{
    // Remove the secret from the visible form immediately, including on failure.
    // Only the server receives it; action state contains static feedback only.
    setToken("");setConfirmed(false);
    try{return await accountAction(previous,form);}
    catch{return {error:"ERUTY에 연결 요청을 전달하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도하세요."};}
  },{});
  return <details className="outreach-note">
    <summary className="cursor-pointer font-semibold">회사 시스템 사용자 토큰으로 연결</summary>
    <p className="description mt-3">회사에서 앱과 Instagram 계정을 직접 관리하는 경우 관리자가 사용할 수 있는 연결 방식입니다. 계정과 앱에 대한 실제 접근 권한을 검증한 뒤 저장합니다.</p>
    <ol className="list-decimal pl-5 space-y-2 text-sm my-4">
      <li><a className="source-link" href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener noreferrer">Meta 비즈니스 설정 → 사용자 → 시스템 사용자 ↗</a>에서 회사 포트폴리오와 사용할 시스템 사용자를 선택합니다.</li>
      <li>해당 시스템 사용자에게 회사 Meta 앱과 Instagram <strong>@{account.expectedIdentity}</strong> 자산을 할당합니다. 토큰을 만드는 담당자에게도 앱 관리 권한이 필요합니다.</li>
      <li>‘토큰 생성’에서 ERUTY 서비스 연결 설정에 등록한 Meta 앱을 선택합니다. 계정 확인에는 <code>instagram_basic</code>이 필요합니다. 메시지 기능에 사용할 <code>instagram_manage_messages</code>는 Meta에서 허용되는 경우 선택합니다.</li>
      <li>생성한 시스템 사용자 토큰을 아래에 입력합니다. Graph API 탐색기의 일반 사용자·앱 토큰이나 Instagram 단독 로그인 토큰은 사용할 수 없습니다.</li>
    </ol>
    <form action={action} className="stack">
      <input type="hidden" name="action" value="instagram-system-user"/>
      <input type="hidden" name="id" value={account.id}/>
      <input type="hidden" name="revision" value={revision}/>
      <input type="hidden" name="updatedAt" value={new Date(account.updatedAt).toISOString()}/>
      <label className="field">Meta 시스템 사용자 토큰<input aria-label="Meta 시스템 사용자 토큰" className="input" name="accessToken" type="password" autoComplete="off" spellCheck={false} minLength={20} maxLength={16384} required value={token} disabled={pending} onChange={event=>setToken(event.target.value)}/></label>
      <label className="outreach-confirm"><input name="confirmed" type="checkbox" required checked={confirmed} disabled={pending} onChange={event=>setConfirmed(event.target.checked)}/>회사가 관리하는 앱·자산의 토큰이며, @{account.expectedIdentity}의 기존 인증 정보를 검증 후 교체하는 데 동의합니다.</label>
      <button className="btn btn-primary" disabled={!hydrated||pending||!token.trim()||!confirmed}>{pending?"Meta 앱·계정 확인 중…":"시스템 사용자 토큰 검증 후 연결"}</button>
      <p role="status" className={state.error?"form-error":"description"}>{state.error??state.message}</p>
      {state.instagramAccounts?.length?<div className="outreach-note" role="note" aria-label="Meta에서 확인된 Instagram 계정"><strong>이 토큰으로 확인된 Instagram 계정</strong><p className="description">ERUTY에 등록한 대상: @{account.expectedIdentity}</p><ul>{state.instagramAccounts.map(found=><li key={found.username}><a className="source-link" href={found.profileUrl} target="_blank" rel="noopener noreferrer">@{found.username} ↗</a></li>)}</ul><p className="description">이름이 다르면 Meta에서 할당한 Instagram 자산을 확인하세요. 확인 없이 다른 계정으로 연결하지 않습니다.</p></div>:null}
    </form>
    <p className="description mt-3">토큰은 검증 성공 후 서버에 암호화해 저장하며 다시 표시하지 않습니다. 토큰을 채팅으로 보내지 마세요. 계정 연결 후에도 현재 버전의 Instagram DM 발송·수신 기능은 제공되지 않습니다.</p>
  </details>;
}

"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { saveProviderApp } from "@/app/(app)/settings/connections/actions";
import { providerNames, type SenderProvider } from "@/lib/outreach/contracts";
import { parseGoogleClientFile } from "@/lib/outreach/app-contracts";
import type { ProviderAppStatus } from "@/lib/outreach/provider-apps";
const urls = {google:"https://console.cloud.google.com/auth/clients",instagram:"https://developers.facebook.com/apps/",tiktok:"https://developers.tiktok.com/apps/"};
export function ProviderSetup({initial,admin}:{initial:ProviderAppStatus[];admin:boolean}) {
  const [statuses,setStatuses]=useState(initial), [provider,setProvider]=useState<SenderProvider>("google");
  return <><div className="outreach-template-options" role="group" aria-label="연결 서비스">{statuses.map(s=><button key={s.provider} className="btn" aria-pressed={s.provider===provider} onClick={()=>setProvider(s.provider)}>{providerNames[s.provider]} · {s.configured?"등록됨":"등록 필요"}</button>)}</div>
    <ProviderForm key={provider+statuses.find(s=>s.provider===provider)!.revision} status={statuses.find(s=>s.provider===provider)!} admin={admin} onSaved={setStatuses}/></>;
}
function ProviderForm({status,admin,onSaved}:{status:ProviderAppStatus;admin:boolean;onSaved:(s:ProviderAppStatus[])=>void}) {
  const [clientId,setClientId]=useState(""),[secret,setSecret]=useState(""),[version,setVersion]=useState(status.version),[replace,setReplace]=useState(false),[notice,setNotice]=useState(""),[busy,startTransition]=useTransition();
  async function importFile(file?:File) {
    if(!file)return;
    try {
      if(file.size>32768)throw new Error("Google에서 내려받은 작은 JSON 인증 파일을 선택하세요.");
      const parsed=parseGoogleClientFile(await file.text(),status.redirectUri);
      setClientId(parsed.clientId);setSecret(parsed.clientSecret);setNotice("Google 웹 앱 정보를 읽었습니다. 연결 정보 저장을 누르면 등록됩니다.");
    } catch(error) {setNotice(error instanceof Error&&error.message.startsWith("Google")?error.message:"Google 웹 애플리케이션의 JSON 파일인지 확인하세요.");}
  }
  return <div className="setup-columns"><section className="surface outreach-stage"><p className="eyebrow">1 · 회사 앱 등록</p><h2>{providerNames[status.provider]} 연결</h2>
    <p className="description">{status.configured?`연결 정보가 등록되어 있습니다 (${status.clientHint}). 이제 발신 계정에서 로그인하세요.`:"회사 개발자 앱에서 발급한 연결 정보를 등록하세요. 계정 비밀번호는 입력하지 않습니다."}</p>
    {status.configured&&<Link className="btn btn-primary mt-5" href="/settings/accounts">발신 계정 로그인하기 →</Link>}
    <div className="outreach-note"><strong>로그인 완료 주소</strong><p className="setup-uri">{status.redirectUri}</p><button className="btn" onClick={()=>{navigator.clipboard.writeText(status.redirectUri).then(()=>setNotice("로그인 완료 주소를 복사했습니다.")).catch(()=>setNotice("주소를 선택해 복사하세요."));}}>주소 복사</button></div>
    {admin?<form className="outreach-settings-form" onSubmit={e=>{e.preventDefault();startTransition(async()=>{const result=await saveProviderApp({provider:status.provider,revision:status.revision,clientId,clientSecret:secret,version,replace});if(result.error)setNotice(result.error);else if(result.statuses){setSecret("");onSaved(result.statuses);setNotice("연결 정보를 저장했습니다. 발신 계정에서 로그인 연결을 진행하세요.");}});}}>
      {status.provider==="google"&&<label>Google 인증 파일 가져오기<input aria-label="Google 인증 파일 가져오기" className="input" type="file" accept=".json,application/json" disabled={busy} onChange={e=>{void importFile(e.target.files?.[0]);e.target.value="";}}/><span className="description">Google Clients에서 내려받은 웹 앱 JSON 파일로 입력할 수 있습니다.</span></label>}
      <label>{status.provider==="tiktok"?"Client key":"Client ID"}<input aria-label="Client ID" className="input" value={clientId} required maxLength={512} autoComplete="off" disabled={busy} onChange={e=>setClientId(e.target.value)}/></label>
      <label>Client secret<input aria-label="Client secret" className="input" type="password" value={secret} required maxLength={2048} autoComplete="new-password" disabled={busy} onChange={e=>setSecret(e.target.value)}/><span className="description">암호화해 저장하며, 저장한 비밀키는 다시 표시하지 않습니다.</span></label>
      {status.provider==="instagram"&&<label>Meta 앱의 API 버전<input className="input" value={version} required placeholder="Meta 대시보드에 표시된 v숫자.0" maxLength={30} onChange={e=>setVersion(e.target.value)}/></label>}
      {(status.configured||status.revision>0)&&<label className="outreach-confirm"><input type="checkbox" required checked={replace} onChange={e=>setReplace(e.target.checked)}/>기존 정보를 교체합니다. 연결된 계정은 다시 로그인해야 합니다.</label>}
      <button className="btn btn-primary" disabled={busy}>{busy?"저장 중…":"연결 정보 저장"}</button>
    </form>:<p className="outreach-note">회사 앱 등록은 워크스페이스 관리자만 할 수 있습니다. 계정 로그인은 관리자·매니저가 할 수 있습니다.</p>}
    <p role="status" className="outreach-feedback">{notice}</p>
  </section><aside className="surface outreach-stage setup-guide"><p className="eyebrow">최초 1회 · 설정 순서</p><h2>등록 후에는 로그인만 하면 됩니다</h2>
    {status.provider==="google"?<><ol><li><a className="source-link" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener noreferrer">회사 Google 계정으로 프로젝트 만들기 ↗</a></li><li><a className="source-link" href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener noreferrer">Gmail API 사용 설정 ↗</a></li><li>Google Auth Platform의 Branding에 회사 이름과 지원 이메일을 입력합니다. 사내 전용이면 Audience를 Internal로 설정합니다. External 테스트 앱이면 사용할 계정을 테스트 사용자에 추가합니다.</li><li>Clients에서 <strong>웹 애플리케이션</strong>을 만들고 왼쪽의 로그인 완료 주소를 승인된 리디렉션 URI에 추가합니다.</li><li>JSON 파일을 내려받아 왼쪽에 가져오거나 Client ID와 secret을 입력하고 저장합니다.</li><li>발신 계정에서 회사 메일로 로그인해 발송 권한을 승인합니다.</li></ol><p className="outreach-note">Google Workspace의 ID나 비밀번호를 전달할 필요는 없습니다. contact@ 주소가 별칭이면 실제 메일함 계정으로 로그인하고 ‘추가 발신 주소도 연결’을 선택하세요.</p></>:<><ol><li>회사 개발자 앱을 만들고 {status.provider==="instagram"?"Instagram Login":"Login Kit"}을 추가합니다.</li><li>왼쪽의 로그인 완료 주소를 등록하고 앱의 Client ID·secret을 저장합니다.</li><li>발신 계정에서 SNS 로그인을 완료합니다.</li></ol><p className="outreach-note">{status.provider==="instagram"?"Instagram은 프로페셔널 계정과 메시지 권한이 필요합니다. 계정 로그인만으로 임의의 크리에이터에게 먼저 DM을 보낼 수는 없습니다.":"TikTok Login Kit은 계정 확인용입니다. DM 발송은 Business Messaging 앱 승인과 별도 연결이 필요합니다."}</p></>}
    <a className="btn" href={urls[status.provider]} target="_blank" rel="noopener noreferrer">개발자 설정 열기 ↗</a>
  </aside></div>;
}

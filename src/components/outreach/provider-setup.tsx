"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { checkInstagramApp, saveProviderApp } from "@/app/(app)/settings/connections/actions";
import { providerNames, type SenderProvider } from "@/lib/outreach/contracts";
import { parseGoogleClientFile, parseInstagramLoginUrl } from "@/lib/outreach/app-contracts";
import type { ProviderAppStatus } from "@/lib/outreach/provider-apps";
import { useHydrated } from "@/components/use-hydrated";
const urls = {google:"https://console.cloud.google.com/auth/clients",instagram:"https://developers.facebook.com/apps/",tiktok:"https://developers.tiktok.com/apps/"};
export function ProviderSetup({initial,admin,initialProvider="google"}:{initial:ProviderAppStatus[];admin:boolean;initialProvider?:SenderProvider}) {
  const hydrated=useHydrated();
  const [statuses,setStatuses]=useState(initial), [provider,setProvider]=useState<SenderProvider>(initialProvider);
  return <><div className="outreach-template-options" role="group" aria-label="연결 서비스">{statuses.map(s=><button key={s.provider} className="btn" disabled={!hydrated} aria-pressed={s.provider===provider} onClick={()=>setProvider(s.provider)}>{providerNames[s.provider]} · {s.configured?"등록됨":"등록 필요"}</button>)}</div>
    <ProviderForm key={provider+statuses.find(s=>s.provider===provider)!.revision} status={statuses.find(s=>s.provider===provider)!} admin={admin} onSaved={setStatuses}/></>;
}
function ProviderForm({status,admin,onSaved}:{status:ProviderAppStatus;admin:boolean;onSaved:(s:ProviderAppStatus[])=>void}) {
  const hydrated=useHydrated();
  const [clientId,setClientId]=useState(""),[secret,setSecret]=useState(""),[version,setVersion]=useState(status.version),[replace,setReplace]=useState(false),[notice,setNotice]=useState(""),[busy,startTransition]=useTransition();
  const [instagramLoginMode,setInstagramLoginMode]=useState<"instagram"|"unified">(status.revision===0&&!status.configured?"unified":status.instagramLoginMode),[configurationId,setConfigurationId]=useState(status.configurationId),[loginUrl,setLoginUrl]=useState("");
  function importInstagramUrl() {
    try { const parsed=parseInstagramLoginUrl(loginUrl,status.redirectUri);setClientId(parsed.clientId);setConfigurationId(parsed.configurationId);setInstagramLoginMode("unified");setLoginUrl("");setNotice("Meta 앱 ID와 구성 ID를 가져왔습니다. 앱 시크릿과 API 버전을 입력하고 저장하세요. 로그인용 state는 ERUTY가 생성합니다."); }
    catch(error) {setNotice(error instanceof Error&&/^(Meta|인증 결과)/.test(error.message)?error.message:"Meta 설정 화면에서 생성한 로그인 URL인지 확인하세요.");}
  }
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
    {admin&&status.provider==="instagram"&&status.configured&&status.instagramLoginMode==="unified"&&<div className="outreach-note"><strong>저장된 Meta 앱 설정 점검</strong><p className="description">저장된 앱 ID·시크릿과 조회 가능한 앱 소유 포트폴리오를 Meta에 확인합니다. 점검 성공은 Instagram 계정 연결 완료와 다릅니다. 아래에서 수정 중인 값은 저장한 뒤 점검하세요.</p><button className="btn" type="button" disabled={busy||!hydrated} onClick={()=>startTransition(async()=>{
      const result=await checkInstagramApp({revision:status.revision});
      if(result.error){setNotice(result.error);return;}
      if(result.check){const owner=result.check.ownership;setNotice(`Meta가 저장된 앱 ID·시크릿을 확인했습니다. ${owner.status==="confirmed"?`앱 소유 비즈니스 포트폴리오: ${owner.business.name??"이름 미표시"} (ID: ${owner.business.id}).`:owner.status==="not_returned"?"Meta 응답에 앱 소유 포트폴리오 정보가 없어 비즈니스 설정에서 확인이 필요합니다.":"Meta API에서 앱 소유 포트폴리오를 조회하지 못했습니다."} Instagram 계정 연결 여부는 발신 계정 화면에서 확인하세요.`);}
    })}>{busy?"처리 중…":"저장된 앱 설정 점검"}</button></div>}
    <div className="outreach-note"><strong>로그인 완료 주소</strong><p className="setup-uri">{status.redirectUri}</p><button className="btn" onClick={()=>{navigator.clipboard.writeText(status.redirectUri).then(()=>setNotice("로그인 완료 주소를 복사했습니다.")).catch(()=>setNotice("주소를 선택해 복사하세요."));}}>주소 복사</button></div>
    {admin?<form className="outreach-settings-form" onSubmit={e=>{e.preventDefault();startTransition(async()=>{const result=await saveProviderApp({provider:status.provider,revision:status.revision,clientId,clientSecret:secret,version,replace,instagramLoginMode,configurationId});if(result.error)setNotice(result.error);else if(result.statuses){setSecret("");onSaved(result.statuses);setNotice("연결 정보를 저장했습니다. 발신 계정에서 로그인 연결을 진행하세요.");}});}}>
      <fieldset disabled={busy||!hydrated} className="contents">
      {status.provider==="instagram"&&<><label>Instagram 로그인 방식<select aria-label="Instagram 로그인 방식" className="input" value={instagramLoginMode} disabled={busy} onChange={e=>setInstagramLoginMode(e.target.value as "instagram"|"unified")}><option value="unified">Unified Login · Meta 구성 ID 사용</option><option value="instagram">기존 Instagram Login · 별도 Instagram 앱 ID 사용</option></select></label>
        {instagramLoginMode==="unified"&&<><label>Meta 로그인 URL 가져오기<input aria-label="Meta 로그인 URL 가져오기" className="input" value={loginUrl} maxLength={8192} autoComplete="off" placeholder="https://www.facebook.com/dialog/oauth?..." disabled={busy} onChange={e=>setLoginUrl(e.target.value)}/><span className="description">Meta의 ‘1. 앱 구성’에서 생성된 로그인 URL을 붙여 넣으세요. 앱 ID와 구성 ID만 가져옵니다.</span></label><button className="btn" type="button" disabled={busy||!loginUrl.trim()} onClick={importInstagramUrl}>로그인 URL에서 가져오기</button><label>로그인 구성 ID (config_id)<input aria-label="로그인 구성 ID" className="input" value={configurationId} required pattern="[0-9]+" maxLength={50} disabled={busy} onChange={e=>setConfigurationId(e.target.value)}/></label></>}
      </>}
      {status.provider==="google"&&<label>Google 인증 파일 가져오기<input aria-label="Google 인증 파일 가져오기" className="input" type="file" accept=".json,application/json" disabled={busy} onChange={e=>{void importFile(e.target.files?.[0]);e.target.value="";}}/><span className="description">Google Clients에서 내려받은 웹 앱 JSON 파일로 입력할 수 있습니다.</span></label>}
      <label>{status.provider==="tiktok"?"Client key":status.provider==="instagram"?instagramLoginMode==="unified"?"Meta 앱 ID":"Instagram 앱 ID":"Client ID"}<input aria-label="Client ID" className="input" value={clientId} required maxLength={512} autoComplete="off" disabled={busy} onChange={e=>setClientId(e.target.value)}/></label>
      <label>{status.provider==="instagram"&&instagramLoginMode==="unified"?"Meta 앱 시크릿":"Client secret"}<input aria-label="Client secret" className="input" type="password" value={secret} required maxLength={2048} autoComplete="new-password" disabled={busy} onChange={e=>setSecret(e.target.value)}/><span className="description">{status.provider==="instagram"&&instagramLoginMode==="unified"?"Meta 앱 설정의 기본 정보에서 확인하세요. 액세스 토큰을 입력하는 칸이 아닙니다. ":""}암호화해 저장하며, 저장한 비밀키는 다시 표시하지 않습니다.</span></label>
      {status.provider==="instagram"&&<label>Meta 앱의 API 버전<input aria-label="Meta 앱의 API 버전" className="input" value={version} required placeholder="Meta 대시보드에 표시된 v숫자.0" maxLength={30} onChange={e=>setVersion(e.target.value)}/><span className="description">Meta 앱 설정에서 사용하는 Graph API 버전을 확인해 입력하세요.</span></label>}
      {(status.configured||status.revision>0)&&<label className="outreach-confirm"><input type="checkbox" required checked={replace} onChange={e=>setReplace(e.target.checked)}/>기존 정보를 교체합니다. 연결된 계정은 다시 로그인해야 합니다.</label>}
      <button className="btn btn-primary" disabled={busy}>{busy?"저장 중…":"연결 정보 저장"}</button>
      </fieldset>
    </form>:<p className="outreach-note">회사 앱 등록은 워크스페이스 관리자만 할 수 있습니다. 계정 로그인은 관리자·매니저가 할 수 있습니다.</p>}
    <p role="status" className="outreach-feedback">{notice}</p>
  </section><aside className="surface outreach-stage setup-guide"><p className="eyebrow">최초 1회 · 설정 순서</p><h2>등록 후에는 로그인만 하면 됩니다</h2>
    {status.provider==="google"?<><ol><li><a className="source-link" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener noreferrer">회사 Google 계정으로 프로젝트 만들기 ↗</a></li><li><a className="source-link" href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener noreferrer">Gmail API 사용 설정 ↗</a></li><li>Google Auth Platform의 Branding에 회사 이름과 지원 이메일을 입력합니다. 사내 전용이면 Audience를 Internal로 설정합니다. External 테스트 앱이면 사용할 계정을 테스트 사용자에 추가합니다.</li><li>Clients에서 <strong>웹 애플리케이션</strong>을 만들고 왼쪽의 로그인 완료 주소를 승인된 리디렉션 URI에 추가합니다.</li><li>JSON 파일을 내려받아 왼쪽에 가져오거나 Client ID와 secret을 입력하고 저장합니다.</li><li>발신 계정에서 회사 메일로 로그인해 발송 권한을 승인합니다.</li></ol><p className="outreach-note">Google Workspace의 ID나 비밀번호를 전달할 필요는 없습니다. contact@ 주소가 별칭이면 실제 메일함 계정으로 로그인하고 ‘추가 발신 주소도 연결’을 선택하세요.</p></>:status.provider==="instagram"?<InstagramSetupGuide unified={instagramLoginMode==="unified"}/>:<><ol><li>회사 개발자 앱을 만들고 Login Kit을 추가합니다.</li><li>왼쪽의 로그인 완료 주소를 등록하고 앱의 Client key·secret을 저장합니다.</li><li>발신 계정에서 TikTok 로그인을 완료합니다.</li></ol><p className="outreach-note">TikTok Login Kit은 계정 확인용입니다. DM 발송은 Business Messaging 앱 승인과 별도 연결이 필요합니다.</p></>}
    <a className="btn" href={urls[status.provider]} target="_blank" rel="noopener noreferrer">개발자 설정 열기 ↗</a>
  </aside></div>;
}
function InstagramSetupGuide({unified}:{unified:boolean}) {
  return <><ol>
    <li>연결할 회사 Instagram을 비즈니스 또는 크리에이터 계정으로 준비합니다.</li>
    <li>{unified?<>Meta의 <strong>API setup with Unified login → 1. 앱 구성</strong>에서 새 구성을 만들고 선택합니다. Instagram 자산을 포함하고 사용할 권한을 확인합니다.</>:<>기존 앱의 <strong>API setup with Instagram login</strong>에서 별도 Instagram 앱 ID·시크릿을 확인합니다.</>}</li>
    <li>앱 역할에서 해당 계정을 Instagram 테스터로 추가하고, Instagram에서 초대를 수락합니다. Meta의 ‘계정 추가’에서 계정을 확인합니다.</li>
    <li>왼쪽 로그인 완료 주소를 Meta에 등록합니다. {unified?"생성된 로그인 URL을 왼쪽에 가져오면 앱 ID와 구성 ID가 입력됩니다.":"Instagram 앱 ID와 시크릿을 왼쪽에 입력합니다."}</li>
    <li>{unified?"Meta 앱 설정의 기본 정보에서 앱 시크릿을 확인하고 ":""}앱의 Graph API 버전을 입력한 뒤 연결 정보를 저장합니다.</li>
    <li>발신 계정에서 등록한 회사 계정의 ‘로그인 연결’을 누릅니다. Meta 권한 화면에서 해당 Instagram 계정을 선택하고 연결을 마칩니다.</li>
  </ol><p className="outreach-note">‘게시되지 않음’은 공개 전 상태입니다. 테스트 역할·권한을 준비하고 계정 연결을 확인하세요. 공개 운영의 게시·검수 요건은 Meta에서 별도로 완료해야 합니다.</p><p className="outreach-note">ERUTY는 Unified Login 회사 계정의 실제 대화 조회·24시간 이내 DM 회신을 지원합니다. 대화는 수동 새로고침으로 확인합니다. Webhooks 자동 수신은 아직 지원하지 않습니다. 로그인 완료 주소를 Webhooks 콜백에 넣지 마세요.</p></>;
}

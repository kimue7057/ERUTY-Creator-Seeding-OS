/* global chrome */
(()=>{
  const prepared=new Map();
  const normalize=s=>(s??"").replace(/\s+/g," ").trim();
  const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=="hidden";
  const fail=reason=>{throw new Error(reason);};
  const path=a=>new URL(a.href,location.href).pathname.replace(/^\/|\/$/g,"").toLowerCase();
  function check(){
    if(location.pathname.startsWith("/accounts/")||[...document.querySelectorAll('input[type="password"]')].some(visible))fail("login_required");
    if(/challenge|checkpoint/.test(location.pathname)||[...document.querySelectorAll('iframe[src*="captcha"]')].some(visible))fail("captcha");
    const notices=[...document.querySelectorAll('[role="dialog"],[role="alert"]')].filter(visible).map(e=>e.innerText).join(" ");
    if(/try again later|temporarily blocked|나중에 다시 시도|일시적으로 차단|메시지를 보낼 수 없/i.test(notices))fail("platform_restricted");
  }
  function sender(expected){
    check();
    const candidates=[...document.querySelectorAll('a[href]')].filter(a=>{const img=a.querySelector('img');return visible(a)&&img&&/프로필 사진|profile picture/i.test(img.alt)&&a.getBoundingClientRect().left<180&&a.getBoundingClientRect().width<170;});
    const identities=[...new Set(candidates.map(path).filter(p=>/^[a-z0-9._]{1,30}$/.test(p)))];
    if(identities.length!==1)fail("browser_unavailable");if(identities[0]!==expected)fail("sender_mismatch");return expected;
  }
  function validate(c){if(!/^[a-f0-9-]{36}$/.test(c.job_id)||!/^\w[\w.]{0,29}$/.test(c.sender)||!/^\w[\w.]{0,29}$/.test(c.recipient)||typeof c.body!=="string"||!c.body.trim()||c.body.length>1000)fail("unconfirmed_result");sender(c.sender);}
  function profile(c){validate(c);if(location.pathname.replace(/^\/|\/$/g,"").toLowerCase()!==c.recipient)fail("recipient_unavailable");const heading=[...document.querySelectorAll('h1,h2,a')].filter(visible).some(e=>normalize(e.innerText).toLowerCase()===c.recipient);if(!heading)fail("recipient_unavailable");}
  const name=e=>normalize(e.getAttribute('aria-label')||e.innerText||e.querySelector('svg')?.getAttribute('aria-label'));
  const buttons=root=>[...root.querySelectorAll('button,[role="button"]')].filter(visible).filter(e=>!e.disabled&&e.getAttribute('aria-disabled')!=="true");
  function thread(c){
    validate(c);const editors=[...document.querySelectorAll('[contenteditable="true"][role="textbox"]')].filter(visible);if(editors.length!==1)fail("recipient_unavailable");const editor=editors[0];
    const headers=[...document.querySelectorAll('a[aria-label][href]')].filter(a=>visible(a)&&path(a)===c.recipient&&/프로필 페이지|profile page/i.test(a.getAttribute('aria-label')));
    let root=editor.parentElement;while(root&&root!==document.body){if(headers.some(h=>root.contains(h)))return{root,editor};root=root.parentElement;}fail("recipient_unavailable");
  }
  function observation(c,root,editor,sent=false){
    const profile=[...document.querySelectorAll('a[href]')].find(a=>visible(a)&&path(a)===c.sender&&a.querySelector('img')&&a.getBoundingClientRect().left<180);
    const header=[...root.querySelectorAll('a[aria-label][href]')].find(a=>visible(a)&&path(a)===c.recipient&&/프로필 페이지|profile page/i.test(a.getAttribute('aria-label')));
    const text=sent?outgoing(root,editor,c).at(-1)?.innerText:editor.innerText;if(!profile||!header||!text)fail("unconfirmed_result");
    return{sender:c.sender,recipient:c.recipient,body:c.body,source_url:location.origin+location.pathname,observed_at:new Date().toISOString(),visible_text:[profile.querySelector('img').alt,header.getAttribute('aria-label'),text].join('\n')};
  }
  function outgoing(root,editor,c){
    const self=new RegExp(`(^|[^A-Za-z0-9._])${c.sender.replaceAll('.', '\\.')}($|[^A-Za-z0-9._])`,'i');
    return [...root.querySelectorAll('div,span,p')].filter(e=>visible(e)&&!editor.contains(e)&&e!==editor&&normalize(e.innerText)===normalize(c.body)&&![...e.children].some(ch=>normalize(ch.innerText)===normalize(c.body))).filter(e=>{let parent=e.parentElement;for(let i=0;parent&&parent!==root&&i<8;i++,parent=parent.parentElement){const labels=[...parent.querySelectorAll('[aria-label]')].map(a=>a.getAttribute('aria-label')??"").filter(label=>/님의 메시지|reply.*message|react.*message|message.*options/i.test(label));if(labels.length)return labels.every(label=>self.test(label));}return false;});
  }
  async function command(c){
    if(c.action==="probe")return{sender:sender(c.sender)};
    if(c.action==="diagnostic"){
      validate(c);const controls=[...document.querySelectorAll('button,[role="button"],a,[role="link"]')].filter(e=>visible(e)&&/메시지|message/i.test(name(e))&&e.getBoundingClientRect().top<600).slice(0,8);
      return{diagnostic:{path_kind:location.pathname.replace(/^\/|\/$/g,'').toLowerCase()===c.recipient?"recipient_profile":/^\/direct\/t\//.test(location.pathname)?"direct_thread":"other",message_controls:controls.map(e=>({label:["메시지 보내기","메시지","Message","Send message"].includes(name(e))?name(e):"other",kind:e.tagName==="BUTTON"||e.getAttribute('role')==="button"?"button":e.tagName==="A"||e.getAttribute('role')==="link"?"link":"other",enabled:!e.disabled&&e.getAttribute('aria-disabled')!=="true"})),editor_count:Math.min(20,[...document.querySelectorAll('[contenteditable="true"][role="textbox"]')].filter(visible).length),recipient_headers:Math.min(20,[...document.querySelectorAll('a[aria-label][href]')].filter(a=>visible(a)&&path(a)===c.recipient&&/프로필 페이지|profile page/i.test(a.getAttribute('aria-label'))).length)}};
    }
    if(c.action==="profile"){profile(c);return{};}
    if(c.action==="open"){profile(c);const controls=buttons(document).filter(e=>/^(메시지 보내기|Message|Send message)$/i.test(name(e)));if(controls.length!==1)fail("recipient_unavailable");controls[0].click();return{};}
    const {root,editor}=thread(c);
    if(c.action==="prepare"){
      const previous=prepared.get(c.job_id);if(previous){if(previous.sent)fail("unconfirmed_result");if(editor.innerText!==c.body)fail("unconfirmed_result");return{observation:observation(c,root,editor)};}
      if(editor.innerText.trim())fail("unconfirmed_result");
      const count=outgoing(root,editor,c).length;editor.focus();
      const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
      // Lexical's normal editable input path; no private Instagram endpoints.
      if(!document.execCommand('insertText',false,c.body))fail("unconfirmed_result");
      if(editor.innerText!==c.body)fail("unconfirmed_result");prepared.set(c.job_id,{root,editor,count,sent:false});return{observation:observation(c,root,editor)};
    }
    const state=prepared.get(c.job_id);if(!state||state.editor!==editor||state.root!==root)fail("unconfirmed_result");
    if(c.action==="send"){
      if(state.sent||editor.innerText!==c.body||c.permit?.job_id!==c.job_id||c.permit?.send_permitted!==true||Date.parse(c.permit.expires_at)<=Date.now())fail("unconfirmed_result");
      const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(c.body)))].map(x=>x.toString(16).padStart(2,'0')).join('');if(digest!==c.permit.body_sha256)fail("unconfirmed_result");
      const send=buttons(root).filter(e=>/^(보내기|Send)$/i.test(name(e)));if(send.length!==1)fail("recipient_unavailable");state.sent=true;send[0].click();return{};
    }
    if(c.action==="verify"){
      if(!state.sent||editor.innerText.trim()||/전송 중|Sending|보내지 못|couldn.t send/i.test(root.innerText)||outgoing(root,editor,c).length<=state.count)fail("unconfirmed_result");
      return{observation:observation(c,root,editor,true)};
    }
    fail("unconfirmed_result");
  }
  chrome.runtime.onMessage.addListener((request,source,respond)=>{if(source.id!==chrome.runtime.id||request?.type!=="ERUTY_INSTAGRAM")return;void command(request).then(result=>respond({ok:true,...result})).catch(e=>respond({ok:false,reason:e.message}));return true;});
})();

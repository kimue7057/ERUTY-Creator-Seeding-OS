/* global chrome */
(()=>{
  const prepared=new Map(),opened=new Map(),preparation=new Map();
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
  function validateIdentity(c){if(!/^[a-f0-9-]{36}$/.test(c.job_id)||!/^\w[\w.]{0,29}$/.test(c.sender)||!/^\w[\w.]{0,29}$/.test(c.recipient))fail("unconfirmed_result");sender(c.sender);}
  function validate(c){validateIdentity(c);if(typeof c.body!=="string"||!c.body.trim()||c.body.length>1000)fail("unconfirmed_result");}
  function profileIdentity(c){validateIdentity(c);if(location.pathname.replace(/^\/|\/$/g,"").toLowerCase()!==c.recipient)fail("recipient_unavailable");const heading=[...document.querySelectorAll('h1,h2,a')].filter(visible).some(e=>normalize(e.innerText).toLowerCase()===c.recipient);if(!heading)fail("recipient_unavailable");}
  function profile(c){validate(c);profileIdentity(c);}
  const previewHeaders=c=>[...document.querySelectorAll('header')].filter(h=>visible(h)&&[...h.querySelectorAll('h1,h2,a,span,[role="heading"]')].some(e=>visible(e)&&normalize(e.innerText).toLowerCase()===c.recipient));
  const previewScopes=c=>[...document.querySelectorAll('header,main')].filter(h=>visible(h)&&[...h.querySelectorAll('h1,h2,a,span,[role="heading"]')].some(e=>visible(e)&&normalize(e.innerText).toLowerCase()===c.recipient));
  function previewProfile(c){validateIdentity(c);if(location.pathname.replace(/^\/|\/$/g,'').toLowerCase()!==c.recipient)fail('recipient_unavailable');if(!previewScopes(c).length)profileIdentity(c);}

  const name=e=>normalize(e.getAttribute('aria-label')||e.innerText||e.querySelector('svg')?.getAttribute('aria-label'));
  const buttons=root=>[...root.querySelectorAll('button,[role="button"]')].filter(visible).filter(e=>!e.disabled&&e.getAttribute('aria-disabled')!=="true");
  function messageLinks(){return [...new Set([...document.querySelectorAll('a[href]')].filter(a=>visible(a)&&[...a.querySelectorAll('svg[aria-label]')].some(icon=>/^(메시지|Messages?|Direct)$/i.test(icon.getAttribute('aria-label')??''))).map(a=>new URL(a.href,location.href)).filter(u=>u.origin===location.origin&&/^\/direct\/t\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)&&!u.search&&!u.hash).map(u=>u.href))];}
  function threadIdentity(c){
    validateIdentity(c);const editors=[...document.querySelectorAll('[contenteditable="true"][role="textbox"]')].filter(visible);if(editors.length!==1)fail("recipient_unavailable");const editor=editors[0];
    const headers=[...document.querySelectorAll('a[aria-label][href]')].filter(a=>visible(a)&&path(a)===c.recipient&&/프로필 페이지|profile page/i.test(a.getAttribute('aria-label')));
    let root=editor.parentElement;while(root&&root!==document.body){if(headers.some(h=>root.contains(h)))return{root,editor};root=root.parentElement;}fail("recipient_unavailable");
  }
  function thread(c){validate(c);return threadIdentity(c);}
  function observation(c,root,editor,sent=false){
    const profile=[...document.querySelectorAll('a[href]')].find(a=>visible(a)&&path(a)===c.sender&&a.querySelector('img')&&a.getBoundingClientRect().left<180);
    const header=[...root.querySelectorAll('a[aria-label][href]')].find(a=>visible(a)&&path(a)===c.recipient&&/프로필 페이지|profile page/i.test(a.getAttribute('aria-label')));
    const text=sent?outgoing(root,editor,c).at(-1)?.innerText:editor.innerText;if(!profile||!header||!text)fail("unconfirmed_result");
    return{sender:c.sender,recipient:c.recipient,body:c.body,source_url:location.origin+location.pathname,observed_at:new Date().toISOString(),visible_text:[profile.querySelector('img').alt,header.getAttribute('aria-label'),text].join('\n')};
  }
  const exactMessages=(root,editor,c)=>[...root.querySelectorAll('div,span,p')].filter(e=>visible(e)&&!editor.contains(e)&&e!==editor&&normalize(e.innerText)===normalize(c.body)&&![...e.children].some(ch=>normalize(ch.innerText)===normalize(c.body)));
  function outgoing(root,editor,c){
    const self=new RegExp(`(^|[^A-Za-z0-9._])${c.sender.replaceAll('.', '\\.')}($|[^A-Za-z0-9._])`,'i');
    return exactMessages(root,editor,c).filter(e=>{let parent=e.parentElement;for(let i=0;parent&&parent!==root&&i<8;i++,parent=parent.parentElement){const labels=[...parent.querySelectorAll('[aria-label]')].map(a=>a.getAttribute('aria-label')??"").filter(label=>/님의 메시지|reply.*message|react.*message|message.*options/i.test(label));if(labels.length)return labels.every(label=>self.test(label));}return false;});
  }
  async function command(c){
    if(c.kind==='draft_preview'){
      if(c.permit!==undefined||!['foreground','profile','open','fill_draft','inspect_draft','diagnostic_preview'].includes(c.action))fail('unconfirmed_result');validate(c);
      if(['foreground','profile','open','diagnostic_preview'].includes(c.action))return command({...c,kind:'chat_preview',body:undefined});
      if(document.visibilityState!=='visible')fail('browser_unavailable');
      const {root,editor}=thread(c);
      if(outgoing(root,editor,c).length)fail('already_sent');
      if(c.action==='fill_draft'&&editor.innerText!==c.body){
        if(editor.innerText.trim())fail('draft_conflict');
        editor.focus();const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
        // Normal editable input only. No key events or send-capable controls.
        // Separate editable line breaks avoid Chromium's extra paragraph gap
        // when insertText receives consecutive newlines. Neither command sends.
        const lines=c.body.split('\n');for(let index=0;index<lines.length;index++){if(index)document.execCommand('insertLineBreak',false);if(lines[index])document.execCommand('insertText',false,lines[index]);}
      }
      if(editor.innerText!==c.body)fail(editor.innerText.trim()?'draft_conflict':'unconfirmed_result');
      const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(editor.innerText)))].map(x=>x.toString(16).padStart(2,'0')).join('');
      return{recipient:c.recipient,body_sha256:digest,source_url:location.origin+location.pathname,observed_at:new Date().toISOString()};
    }
    if(c.kind==='chat_preview'){
      if(c.body!==undefined||c.permit!==undefined||!['foreground','profile','open','inspect_preview','diagnostic_preview'].includes(c.action))fail('unconfirmed_result');validateIdentity(c);
      if(c.action==='diagnostic_preview'){
        const controls=[...document.querySelectorAll('button,[role="button"],a,[role="link"]')].filter(e=>visible(e)&&/메시지|message/i.test(name(e))).slice(0,8);
        const identity=[...document.querySelectorAll('h1,h2,a,span,[role="heading"]')].filter(e=>visible(e)&&normalize(e.innerText).toLowerCase()===c.recipient),headers=previewHeaders(c);
        return{diagnostic:{profile_identity:identity.some(e=>e.matches('h1,h2,[role="heading"]'))?'strict_heading':headers.length?'profile_header_text':identity.length?'other_visible_text':'missing',path_kind:location.pathname.replace(/^\/|\/$/g,'').toLowerCase()===c.recipient?'recipient_profile':/^\/direct\/t\//.test(location.pathname)?'direct_thread':'other',document_visible:document.visibilityState==='visible',message_controls:controls.map(e=>({label:['메시지','메시지 보내기','Message','Send message'].includes(name(e))?name(e):'other',kind:e.tagName==='A'||e.getAttribute('role')==='link'?'link':'button',enabled:!e.disabled&&e.getAttribute('aria-disabled')!=='true',region:headers.some(h=>h.contains(e))?'profile_header':e.closest('nav')?'navigation':e.closest('main')?'main':'other'})),editor_count:Math.min(20,[...document.querySelectorAll('[contenteditable="true"][role="textbox"]')].filter(visible).length),recipient_headers:Math.min(20,[...document.querySelectorAll('a[aria-label][href]')].filter(a=>visible(a)&&path(a)===c.recipient&&/프로필 페이지|profile page/i.test(a.getAttribute('aria-label'))).length)}};
      }
      if(document.visibilityState!=='visible')fail('browser_unavailable');
      if(c.action==='foreground')return{};
      if(c.action==='profile'){previewProfile(c);return{};}
      if(c.action==='open'){previewProfile(c);if([...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')].some(visible)){threadIdentity(c);return{};}if(opened.has(c.job_id))return{};const scopes=previewScopes(c),links=scopes.flatMap(h=>[...h.querySelectorAll('a[href],[role="link"][href]')]).filter(e=>{const url=new URL(e.getAttribute('href'),location.href);return visible(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&url.origin===location.origin&&!url.username&&!url.password&&/^\/direct\//.test(url.pathname);}),controls=[...new Set([...buttons(document),...links])].filter(e=>(!scopes.length||scopes.some(root=>root.contains(e)))&&!e.closest('form,[role="dialog"]')&&(/^(메시지|메시지 보내기|Message|Send message)$/i.test(name(e))||/^(메시지|메시지 보내기|Message|Send message)$/i.test(normalize(e.innerText))));if(controls.length!==1)fail('recipient_unavailable');opened.set(c.job_id,{before:messageLinks()});controls[0].click();return{};}
      const {editor}=threadIdentity(c);return{recipient:c.recipient,source_url:location.origin+location.pathname,observed_at:new Date().toISOString(),draft_present:!!editor.innerText.trim()};
    }
    if(c.action==="probe")return{sender:sender(c.sender)};
    if(c.action==="diagnostic"){
      validate(c);const controls=[...document.querySelectorAll('button,[role="button"],a,[role="link"]')].filter(e=>visible(e)&&/메시지|message/i.test(name(e))&&e.getBoundingClientRect().top<600).slice(0,8);
      const editors=[...document.querySelectorAll('[contenteditable="true"][role="textbox"]')].filter(visible),editor=editors.length===1?editors[0]:null;
      let current;try{current=thread(c);}catch{/* Report only fixed counts when a scoped thread is unavailable. */}
      return{diagnostic:{path_kind:location.pathname.replace(/^\/|\/$/g,'').toLowerCase()===c.recipient?"recipient_profile":/^\/direct\/t\//.test(location.pathname)?"direct_thread":"other",document_visible:document.visibilityState==="visible",...preparation.get(c.job_id),editor_state:!editor?"unavailable":editor.innerText===c.body?"exact":!editor.innerText.trim()?"empty":"different",exact_messages:current?Math.min(20,exactMessages(current.root,current.editor,c).length):0,attributed_messages:current?Math.min(20,outgoing(current.root,current.editor,c).length):0,message_controls:controls.map(e=>({label:["메시지 보내기","메시지","Message","Send message"].includes(name(e))?name(e):"other",kind:e.tagName==="BUTTON"||e.getAttribute('role')==="button"?"button":e.tagName==="A"||e.getAttribute('role')==="link"?"link":"other",enabled:!e.disabled&&e.getAttribute('aria-disabled')!=="true"})),editor_count:Math.min(20,editors.length),recipient_headers:Math.min(20,[...document.querySelectorAll('a[aria-label][href]')].filter(a=>visible(a)&&path(a)===c.recipient&&/프로필 페이지|profile page/i.test(a.getAttribute('aria-label'))).length)}};
    }
    if(document.visibilityState!=="visible")fail("browser_unavailable");
    if(c.action==="foreground"){validate(c);return{};}
    if(c.action==="profile"){profile(c);return{};}
    if(c.action==="open"){profile(c);if(opened.has(c.job_id))return{};const controls=buttons(document).filter(e=>/^(메시지 보내기|Message|Send message)$/i.test(name(e)));if(controls.length!==1)fail("recipient_unavailable");opened.set(c.job_id,{before:messageLinks()});controls[0].click();return{};}
    if(c.action==="conversation_link"){profile(c);const prior=opened.get(c.job_id);if(!prior)fail("recipient_unavailable");const selected=messageLinks().filter(url=>!prior.before.includes(url));if(selected.length!==1)fail("recipient_unavailable");return{direct_url:selected[0]};}
    const {root,editor}=thread(c);
    if(c.action==="prepare"){
      const previous=prepared.get(c.job_id);if(previous){if(previous.sent)fail("unconfirmed_result");if(editor.innerText!==c.body)fail("unconfirmed_result");return{observation:observation(c,root,editor)};}
      preparation.set(c.job_id,{prepare_step:"draft_check"});
      const count=outgoing(root,editor,c).length;if(count)fail("unconfirmed_result");
      // An unchanged, exact approved draft is usable; unrelated text is never
      // cleared or overwritten. The rendered text, not execCommand's boolean,
      // proves the result of the normal editable input path.
      if(editor.innerText!==c.body){
        if(editor.innerText.trim())fail("unconfirmed_result");editor.focus();
        const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
        preparation.set(c.job_id,{prepare_step:"input"});const inserted=document.execCommand('insertText',false,c.body);
        preparation.set(c.job_id,{prepare_step:"text_check",input_reported_success:inserted});
      }
      if(editor.innerText!==c.body)fail("unconfirmed_result");
      preparation.set(c.job_id,{...preparation.get(c.job_id),prepare_step:"observation"});
      prepared.set(c.job_id,{root,editor,count,sent:false});const observed=observation(c,root,editor);preparation.set(c.job_id,{...preparation.get(c.job_id),prepare_step:"ready"});return{observation:observed};
    }
    if(c.action==="inspect_sent"){
      if(editor.innerText.trim()||/전송 중|Sending|보내지 못|couldn.t send/i.test(root.innerText)||outgoing(root,editor,c).length!==1)fail("unconfirmed_result");
      return{observation:observation(c,root,editor,true)};
    }
    const state=prepared.get(c.job_id);if(!state)fail("unconfirmed_result");
    if(c.action==="send"){
      if(state.editor!==editor||state.root!==root||state.sent||editor.innerText!==c.body||c.permit?.job_id!==c.job_id||c.permit?.send_permitted!==true||Date.parse(c.permit.expires_at)<=Date.now())fail("unconfirmed_result");
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

import Link from 'next/link';
export function ContactWorkspaceNav({active,campaign}:{active:'contacts'|'drafts'|'sent'|'legacy';campaign?:string}){
 const query=(status?:string)=>new URLSearchParams({...campaign?{campaign}:{},...status?{status}:{}}).toString();
 const links=[{key:'contacts',label:'답장·협업',href:campaign?`/campaigns/${campaign}?tab=contacts`:'/contacts'},{key:'drafts',label:'작성 중인 제안',href:`/outreach?${query('draft')}`},{key:'sent',label:'발송 기록',href:`/outreach?${query('sent')}`}];
 return <nav className="workspace-tabs" aria-label="연락·협업 메뉴">{links.map(l=><Link key={l.key} href={l.href} aria-current={active===l.key?'page':undefined}>{l.label}</Link>)}</nav>;
}

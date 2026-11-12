"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {ListTodo,FolderKanban,Megaphone,MessagesSquare,Settings,ChevronsUpDown,LogOut} from "lucide-react";
import {logout} from "@/app/login/actions";
export function Sidebar({name,workspace,role}:{name:string;workspace:string;role:string;evaluationEnabled?:boolean}){
 const path=usePathname();
 const contactPath=path.startsWith('/contacts')||path.startsWith('/outreach')||/^\/projects\/[^/]+\/outreach/.test(path);
 const items=[
  {href:'/',label:'오늘 할 일',note:'검토·회신·다음 연락',icon:ListTodo,active:path==='/'||path.startsWith('/evaluations')},
  {href:'/campaigns',label:'캠페인',note:'발굴 → 선정 → 연락',icon:Megaphone,active:path.startsWith('/campaigns')},
  {href:'/contacts',label:'연락·협업',note:'작성 중인 제안과 받은 답장',icon:MessagesSquare,active:contactPath},
  {href:'/projects',label:'브랜드·제품',note:'캠페인에 쓸 소개와 자료',icon:FolderKanban,active:path.startsWith('/projects')&&!contactPath},
  {href:'/settings',label:'설정',note:'회사 계정·템플릿·연결',icon:Settings,active:path.startsWith('/settings')},
 ];
 return <aside className="sidebar"><Link href="/" aria-label="ERUTY 오늘 할 일"><div className="wordmark">eruty<span className="brand-dot"/></div><div className="brand-caption">CREATOR SEEDING OS</div></Link><div className="workspace"><span className="workspace-icon">E</span><span className="flex-1 truncate">{workspace}</span><ChevronsUpDown size={13}/></div><div className="nav-group eyebrow">Workspace</div>
 <nav aria-label="주 메뉴">{items.map(({href,label,note,icon:Icon,active})=><Link key={href} href={href} className={`nav-item ${active?'active':''}`} aria-current={active?'page':undefined}><Icon size={18} strokeWidth={1.7}/><span>{label}<small className="nav-note">{note}</small></span></Link>)}</nav>
 <div className="sidebar-bottom"><div className="release-note"><span className="badge badge-green">업무 흐름</span><div className="mt-2">캠페인에서 발굴·선정하고,<br/>연락·협업에서 답장을 관리하세요.</div></div><div className="user-card"><span className="avatar">{name.slice(0,1)}</span><div className="flex-1"><div className="font-semibold">{name}</div><div className="muted mt-1 text-[10px]">{role==='admin'?'관리자':role==='manager'?'캠페인 매니저':'리뷰어 · 조회 전용'}</div></div><form action={logout}><button aria-label="로그아웃" className="p-1 text-gray-400"><LogOut size={15}/></button></form></div></div></aside>;
}

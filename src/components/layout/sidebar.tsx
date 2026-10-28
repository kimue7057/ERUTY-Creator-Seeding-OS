"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderKanban, Megaphone, UserRoundCheck, ChevronsUpDown, LogOut } from "lucide-react";
import { logout } from "@/app/login/actions";
export function Sidebar({ name, workspace, role, evaluationEnabled=false }: { name: string; workspace: string; role: string; evaluationEnabled?:boolean }) {
  const path = usePathname();
  return <aside className="sidebar">
    <Link href="/" aria-label="ERUTY 홈"><div className="wordmark">eruty<span className="brand-dot" /></div><div className="brand-caption">CREATOR SEEDING OS</div></Link>
    <div className="workspace"><span className="workspace-icon">E</span><span className="flex-1 truncate">{workspace}</span><ChevronsUpDown size={13} /></div>
    <div className="nav-group eyebrow">Workspace</div>
    <nav aria-label="주 메뉴">
      {[{ href: "/", label: "홈", icon: LayoutDashboard }, { href: "/campaigns", label: "캠페인", icon: Megaphone },...(evaluationEnabled?[{href:"/evaluations",label:"검토함",icon:UserRoundCheck}]:[]),{ href: "/projects", label: "프로젝트", icon: FolderKanban }].map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={(href === "/" ? path === "/" : path.startsWith(href)) ? "page" : undefined} className={`nav-item ${(href === "/" ? path === "/" : path.startsWith(href)) ? "active" : ""}`}><Icon size={17} strokeWidth={1.7} />{label}</Link>)}
    </nav>
    <div className="sidebar-bottom"><div className="release-note"><span className="badge badge-green">CREATOR SEEDING</span><div className="mt-2">캠페인에서 발굴하고,<br />추천 후보를 최종 선정하세요.</div></div>
      <div className="user-card"><span className="avatar">{name.slice(0, 1)}</span><div className="flex-1"><div className="font-semibold">{name}</div><div className="muted mt-1 text-[10px]">{role === "admin" ? "관리자" : role === "manager" ? "캠페인 매니저" : "리뷰어 · 조회 전용"}</div></div><form action={logout}><button aria-label="로그아웃" className="p-1 text-gray-400"><LogOut size={15} /></button></form></div>
    </div>
  </aside>;
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderKanban, Megaphone, ScanSearch, UserRoundCheck, Mail, MessagesSquare, ChartNoAxesCombined, ChevronsUpDown, LogOut, Database } from "lucide-react";
import { logout } from "@/app/login/actions";
const future = [
  { label: "아웃리치 스튜디오", icon: Mail }, { label: "인박스 · CRM", icon: MessagesSquare },
  { label: "계약 및 성과", icon: ChartNoAxesCombined }, { label: "크리에이터 DB", icon: Database },
];
export function Sidebar({ name, workspace, role, evaluationEnabled=false }: { name: string; workspace: string; role: string; evaluationEnabled?:boolean }) {
  const path = usePathname();
  return <aside className="sidebar">
    <Link href="/" aria-label="ERUTY 홈"><div className="wordmark">eruty<span className="brand-dot" /></div><div className="brand-caption">CREATOR SEEDING OS</div></Link>
    <div className="workspace"><span className="workspace-icon">E</span><span className="flex-1 truncate">{workspace}</span><ChevronsUpDown size={13} /></div>
    <div className="nav-group eyebrow">Workspace</div>
    <nav aria-label="주 메뉴">
      {[{ href: "/", label: "오버뷰", icon: LayoutDashboard }, { href: "/projects", label: "프로젝트", icon: FolderKanban }, { href: "/campaigns", label: "캠페인", icon: Megaphone }, { href: "/discovery", label: "발굴 기록", icon: ScanSearch },...(evaluationEnabled?[{href:"/evaluations",label:"추천 후보 · 승인",icon:UserRoundCheck}]:[])].map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`nav-item ${(href === "/" ? path === "/" : path.startsWith(href)) ? "active" : ""}`}><Icon size={17} strokeWidth={1.7} />{label}</Link>)}
    </nav>
    <div className="future-nav mt-8"><div className="nav-group eyebrow">Seeding pipeline</div>{[...(!evaluationEnabled?[{label:"평가 및 승인",icon:UserRoundCheck}]:[]),...future].map(({ label, icon: Icon }) => <button key={label} className="nav-item" disabled title="후속 개발 예정"><Icon size={17} strokeWidth={1.7} />{label}<span className="planned">예정</span></button>)}</div>
    <div className="sidebar-bottom"><div className="release-note"><span className="badge badge-green">PHASE 1</span><div className="mt-2">브랜드를 정리하고,<br />다음 캠페인을 준비하세요.</div></div>
      <div className="user-card"><span className="avatar">{name.slice(0, 1)}</span><div className="flex-1"><div className="font-semibold">{name}</div><div className="muted mt-1 text-[10px]">{role === "admin" ? "관리자" : role === "manager" ? "캠페인 매니저" : "리뷰어 · 조회 전용"}</div></div><form action={logout}><button aria-label="로그아웃" className="p-1 text-gray-400"><LogOut size={15} /></button></form></div>
    </div>
  </aside>;
}

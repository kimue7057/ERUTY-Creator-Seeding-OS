import { requireActor } from "@/lib/auth/session";
import { Sidebar } from "@/components/layout/sidebar";
import { ChevronRight, ShieldCheck, LogOut } from "lucide-react";
import { logout } from "@/app/login/actions";
export const dynamic = "force-dynamic";
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  return <div className="app-shell"><Sidebar name={actor.name} workspace={actor.organizationName} role={actor.role} evaluationEnabled={process.env.EVALUATION_ENABLED==="true"} /><div className="content-shell"><header className="topbar"><div className="topbar-label">워크스페이스<ChevronRight size={12} /><span className="text-[#374c3d]">Creator Seeding OS</span></div><div className="flex items-center gap-2"><ShieldCheck size={14} /><span className="max-w-40 truncate">{actor.organizationName}</span><form action={logout} className="mobile-signout"><button aria-label="로그아웃" className="p-1"><LogOut size={14} /></button></form></div></header><main>{children}</main></div></div>;
}

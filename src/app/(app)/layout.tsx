import { requireActor } from "@/lib/auth/session";
import { Sidebar } from "@/components/layout/sidebar";
import { ChevronRight, ShieldCheck } from "lucide-react";
export const dynamic = "force-dynamic";
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  return <div className="app-shell"><Sidebar name={actor.name} workspace={actor.organizationName} role={actor.role} /><div className="content-shell"><header className="topbar"><div className="topbar-label">워크스페이스<ChevronRight size={12} /><span className="text-[#374c3d]">Creator Seeding OS</span></div><div className="flex items-center gap-2"><ShieldCheck size={14} /><span>{actor.organizationName}</span></div></header><main>{children}</main></div></div>;
}

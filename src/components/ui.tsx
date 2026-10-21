import Link from "next/link";
import { Plus, FolderOpen, ArrowUpRight } from "lucide-react";
export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: { href: string; label: string } }) {
  return <header className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="description">{description}</p></div>{action && <Link className="btn btn-primary" href={action.href}><Plus size={15} />{action.label}</Link>}</header>;
}
export function Empty({ title, text, href, label }: { title: string; text: string; href?: string; label?: string }) {
  return <div className="empty"><div className="empty-icon"><FolderOpen size={22} /></div><h3>{title}</h3><p>{text}</p>{href && <Link className="btn btn-primary" href={href}>{label}<ArrowUpRight size={14} /></Link>}</div>;
}
export function Steps() {
  return <div className="steps" aria-label="개발 단계">{["프로젝트 라이브러리", "캠페인 타겟팅", "SNS 직접 발굴", "평가 · 승인", "AI 이메일 작성", "회신 · CRM", "계약 · 성과"].map((label, i) => <div key={label} className={`step ${i < 2 ? "available" : ""}`}><div className="step-number">STEP 0{i + 1}{i >= 2 ? " · 예정" : ""}</div>{label}</div>)}</div>;
}
export function dateLabel(value: Date | string) { return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }

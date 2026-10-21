import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { dateLabel } from "@/components/ui";
export function ProjectCard({ project }: { project: { id: string; name: string; summary: string; productCount: number; campaignCount: number; updatedAt: Date } }) {
  return <Link className="project-card block" href={`/projects/${project.id}`}><div className="flex items-start justify-between"><span className="project-symbol">{project.name.slice(0, 1)}</span><ArrowUpRight size={16} className="text-[#8f9a8f]" /></div><h2>{project.name}</h2><p className="card-summary">{project.summary || "브랜드 소개를 추가해 프로젝트를 완성하세요."}</p><div className="mt-4 flex gap-2"><span className="badge">제품 {project.productCount}</span><span className="badge badge-green">캠페인 {project.campaignCount}</span></div><div className="card-footer"><span>업데이트 {dateLabel(project.updatedAt)}</span><span>프로젝트 보기 →</span></div></Link>;
}

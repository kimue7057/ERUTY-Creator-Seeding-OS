import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus, ExternalLink, FileClock } from "lucide-react";
import { requireActor } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/permissions";
import { getProject, projectProducts, projectAssetList } from "@/lib/projects/service";
import { safeId } from "@/lib/validation/projects";
import { PageHeading, Empty, dateLabel } from "@/components/ui";
export default async function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor(); const { id } = await params; if (!safeId(id)) notFound();
  const project = await getProject(actor, id); if (!project) notFound();
  const [products, assets] = await Promise.all([projectProducts(actor, id), projectAssetList(actor, id)]);
  const writer = canWrite(actor);
  return <><div className="mb-5 text-xs muted"><Link href="/projects">프로젝트</Link> / {project.name}</div><PageHeading eyebrow="Step 01 · Project library" title={project.name} description={`최근 업데이트 ${dateLabel(project.updatedAt)}`} action={writer ? { href: `/campaigns/new?projectId=${id}`, label: "캠페인 만들기" } : undefined} />
    <div className="detail-grid"><div className="stack"><section className="surface panel-body"><div className="flex items-center justify-between mb-5"><h2>브랜드 브리프</h2>{writer && <Link className="btn" href={`/projects/${id}/edit`}><Pencil size={13} />편집</Link>}</div><div className="stack">{[["브랜드 소개", project.summary], ["핵심 USP", project.usp], ["브랜드 스타일", project.brandStyle]].map(([label, value]) => <div key={label}><h3 className="text-xs muted mb-2">{label}</h3><p className="body-copy">{value || "아직 등록하지 않았습니다."}</p></div>)}</div></section>
      <section className="surface"><div className="flex justify-between items-center panel-body border-b border-[#e4e9e5]"><h2>제품 <span className="muted text-sm">{products.length}</span></h2>{writer && <Link href={`/projects/${id}/products/new`} className="btn"><Plus size={13} />제품 추가</Link>}</div>{products.length ? <div className="table-scroll"><table><thead><tr><th>제품명</th><th>제품 특징 · USP</th><th>관리</th></tr></thead><tbody>{products.map(p => <tr key={p.id}><td className="font-semibold">{p.name}</td><td className="max-w-64"><p className="line-clamp-2 muted">{p.features || "미등록"}</p>{p.url && <a className="text-[#376a4a] inline-flex gap-1 mt-2" target="_blank" rel="noreferrer" href={p.url}>제품 링크<ExternalLink size={11} /></a>}</td><td>{writer ? <Link className="btn" href={`/projects/${id}/products/${p.id}/edit`}>편집</Link> : "조회 전용"}</td></tr>)}</tbody></table></div> : <Empty title="등록된 제품이 없습니다" text="시딩할 제품을 추가하면 캠페인에서 선택할 수 있습니다." />}</section>
    </div><div className="stack"><section className="surface panel-body"><h2 className="mb-5">프로젝트 정보</h2><dl className="metadata"><dt>공식 웹사이트</dt><dd>{project.website ? <a href={project.website} target="_blank" rel="noreferrer" className="text-[#376a4a]">{project.website}</a> : "미등록"}</dd><dt>생성일</dt><dd>{dateLabel(project.createdAt)}</dd><dt>참고 링크</dt><dd className="stack">{project.referenceUrls.length ? project.referenceUrls.map(url => <a key={url} target="_blank" rel="noreferrer" className="text-[#376a4a]" href={url}>{url}</a>) : "미등록"}</dd></dl></section>
      <section className="surface panel-body"><div className="flex justify-between items-center mb-4"><h2>브랜드 자료</h2><span className="badge badge-amber">업로드 준비 중</span></div>{assets.length ? assets.map(a => <p className="body-copy" key={a.id}>{a.name} · v{a.version}</p>) : <div className="flex gap-3 text-xs muted leading-7"><FileClock size={20} className="shrink-0 mt-1" /><span>파일 업로드와 버전 관리는 다음 PR에서 연결합니다. 현재 업로드된 자료가 없습니다.</span></div>}</section><Link className="btn" href={`/campaigns?projectId=${id}`}>이 프로젝트의 캠페인 보기 →</Link></div></div>
  </>;
}

"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, FileText, ImageIcon, Film, History, ShieldCheck, X, Plus, LoaderCircle } from "lucide-react";
import { AssetAccess, assetRequest } from "./asset-access";
import { ASSET_CATEGORIES, FILE_RULES, categoryLabel, sizeLabel, uploadIntentSchema } from "@/lib/validation/assets";
import type { listAssets } from "@/lib/assets/service";
type LibraryAsset = Awaited<ReturnType<typeof listAssets>>[number];
type ProductOption = { id: string; name: string };
type Props = { projectId: string; assets: LibraryAsset[]; products: ProductOption[]; writable: boolean; configured: boolean };
export function AssetLibrary({ projectId, assets, products, writable, configured }: Props) {
  const router = useRouter(); const input = useRef<HTMLInputElement>(null);
  const active = useRef<{ xhr?: XMLHttpRequest; id?: string; cancelled: boolean }>({ cancelled: false });
  const target = useRef<LibraryAsset | null>(null);
  const [productId, setProductId] = useState(""); const [category, setCategory] = useState("brand_intro");
  const [busy, setBusy] = useState(""); const [percent, setPercent] = useState(0); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [dragging, setDragging] = useState(false);
  async function cancel() {
    active.current.cancelled = true; active.current.xhr?.abort();
    if (active.current.id) await assetRequest(`/api/projects/${projectId}/uploads/${active.current.id}`, "DELETE").catch(() => {});
  }
  async function upload(files: FileList | File[]) {
    if (busy || !writable || !configured) return;
    setError(""); setMessage("");
    const selectedTarget = target.current;
    for (const file of Array.from(files)) {
      if (selectedTarget && files.length > 1) { setError("새 버전은 파일을 하나씩 선택해 주세요."); break; }
      active.current = { cancelled: false }; setBusy(file.name); setPercent(0);
      try {
        const ext = file.name.split(".").pop()?.toLowerCase();
        const declaredMime = file.type || Object.entries(FILE_RULES).find(([, rule]) => rule.extensions.includes(ext ?? ""))?.[0];
        const payload = uploadIntentSchema.parse({ assetId: selectedTarget?.id ?? null, name: selectedTarget?.name ?? file.name, originalName: file.name, productId: selectedTarget?.productId ?? (productId || null), category: selectedTarget?.category ?? category, declaredMime, expectedSize: file.size });
        const intent = await assetRequest(`/api/projects/${projectId}/uploads`, "POST", payload); active.current.id = intent.id;
        if (active.current.cancelled) { await cancel(); throw new Error("업로드를 취소했습니다."); }
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest(); active.current.xhr = xhr;
          xhr.open("PUT", `/api/projects/${projectId}/uploads/${intent.id}`); xhr.setRequestHeader("Content-Type", payload.declaredMime); xhr.setRequestHeader("X-Eruty-Request", "1"); xhr.responseType = "json"; xhr.timeout = 310_000;
          xhr.upload.onprogress = e => { if (e.lengthComputable) setPercent(Math.round(e.loaded / e.total * 100)); };
          xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(xhr.response?.error ?? "업로드에 실패했습니다."));
          xhr.onerror = () => reject(new Error("네트워크 연결이 끊겼습니다. 다시 시도해 주세요."));
          xhr.ontimeout = () => reject(new Error("업로드 시간이 초과되었습니다."));
          xhr.onabort = () => reject(new Error("전송 중단을 요청했습니다. 이미 저장된 파일은 목록에 남습니다."));
          xhr.send(file);
        });
        setMessage(`${file.name} 저장 완료 · 파일 무결성 확인됨`);
      } catch (e) {
        if (active.current.id) await assetRequest(`/api/projects/${projectId}/uploads/${active.current.id}`, "DELETE").catch(() => {});
        const issues = (e as { issues?: { message: string }[] }).issues;
        setError(issues ? issues.map(i => i.message).join(" · ") : e instanceof Error ? e.message : "파일 저장에 실패했습니다.");
        break;
      } finally { setBusy(""); router.refresh(); }
    }
    target.current = null; if (input.current) input.current.value = "";
  }
  function choose(asset: LibraryAsset | null) { target.current = asset; if (input.current) { input.current.multiple = !asset; input.current.click(); } }
  return <section className="surface asset-library"><header className="asset-library-heading"><div><div className="eyebrow mb-2">Private asset library</div><h2>프로젝트 자료 <span className="muted text-sm">{assets.length}</span></h2></div><span className="badge badge-green"><ShieldCheck size={12} />비공개 · 버전 보존</span></header>
    {!configured && <div className="form-error mx-6" role="alert">비공개 저장소가 설정되지 않았습니다. 관리자에게 저장소 연결을 요청하세요.</div>}
    {writable ? <div className="asset-upload-area"><div className="field-grid mb-4"><label className="field">파일의 제품 연결<select className="input" aria-label="파일의 제품 연결" value={productId} disabled={!!busy} onChange={e => setProductId(e.target.value)}><option value="">프로젝트 공통 자료</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="field">자료 분류<select className="input" aria-label="자료 분류" value={category} disabled={!!busy} onChange={e => setCategory(e.target.value)}>{ASSET_CATEGORIES.map(c => <option value={c.value} key={c.value}>{c.label}</option>)}</select></label></div>
      <input ref={input} type="file" hidden multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.mp4" aria-label="자료 파일 선택" onChange={e => { if (e.target.files) void upload(e.target.files); }} />
      <div className={`asset-dropzone ${dragging ? "dragging" : ""}`} onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); target.current = null; void upload(e.dataTransfer.files); }}>
        <UploadCloud size={26} className="text-[#648b6d] mb-3" /><strong>자료를 여기에 끌어다 놓으세요</strong><p className="description mt-2 mb-4">PDF 20MB · JPG/PNG/WebP 10MB · MP4 50MB</p><button type="button" className="btn" disabled={!!busy || !configured} onClick={() => choose(null)}><Plus size={14} />파일 선택</button>
      </div>{busy && <div className="upload-progress" role="status"><div className="flex justify-between items-center gap-3"><span className="flex gap-2 items-center"><LoaderCircle className="animate-spin shrink-0" size={14} />{busy} · {percent < 100 ? `${percent}% 전송` : "유형·무결성 검증 및 저장 중"}</span><button aria-label="업로드 취소" className="btn" onClick={() => void cancel()}><X size={13} />취소</button></div><progress max={100} value={percent} className="w-full mt-3" /></div>}
    </div> : <p className="description px-6 pb-5">조회 전용 계정입니다. 자료 미리보기와 다운로드는 가능하며 업로드·분류 편집에는 권한이 필요합니다.</p>}
    {error && <div role="alert" className="form-error mx-6">{error}</div>}{message && <p role="status" className="asset-success">{message}</p>}
    {assets.length ? <div>{assets.map(asset => <AssetCard key={asset.id} asset={asset} projectId={projectId} products={products} writable={writable} disabled={!!busy || !configured} onVersion={() => choose(asset)} />)}</div> : <div className="empty"><FileText size={25} className="mx-auto text-[#91a48d] mb-3" /><h3>등록된 자료가 없습니다</h3><p>브랜드 소개서와 제품 이미지를 등록하면 새 캠페인 브리프에 함께 보존됩니다.</p></div>}
  </section>;
}
function AssetCard({ asset, projectId, products, writable, disabled, onVersion }: { asset: LibraryAsset; projectId: string; products: ProductOption[]; writable: boolean; disabled: boolean; onVersion: () => void }) {
  const router = useRouter(); const [editing, setEditing] = useState(false); const [pending, setPending] = useState(false); const [error, setError] = useState("");
  const [name, setName] = useState(asset.name); const [category, setCategory] = useState(asset.category); const [productId, setProductId] = useState(asset.productId ?? "");
  const current = asset.versions.find(v => v.version === asset.currentVersion);
  const Icon = current?.mimeType?.startsWith("image/") ? ImageIcon : current?.mimeType === "video/mp4" ? Film : FileText;
  async function save() {
    setPending(true); setError("");
    try { await assetRequest(`/api/projects/${projectId}/assets/${asset.id}`, "PATCH", { name, category, productId: productId || null }); setEditing(false); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "분류 저장에 실패했습니다."); } finally { setPending(false); }
  }
  return <article className="asset-card"><div className="asset-card-top"><div className="asset-icon"><Icon size={21} /></div><div className="min-w-0 flex-1"><h3 className="break-all">{asset.name}</h3><p className="description text-xs mt-1">{categoryLabel(asset.category)} · {asset.productId ? products.find(p => p.id === asset.productId)?.name ?? "보관된 제품" : "프로젝트 공통"}</p><p className="muted text-[10px] mt-2">{current?.originalName} · {sizeLabel(current?.byteSize ?? null)} · {current?.mimeType ?? "이전 파일 유형 미검증"}</p></div><span className="badge badge-green">현재 v{asset.currentVersion}</span></div>
    <div className="asset-card-actions">{current?.verificationStatus === "verified" ? <AssetAccess projectId={projectId} assetId={asset.id} versionId={current.id} name={asset.name} version={current.version} /> : <span className="badge badge-amber">이전 자료 · 실제 파일 미검증</span>}{writable && <div className="flex gap-2"><button className="btn" onClick={() => setEditing(v => !v)} disabled={disabled}>분류·제품 편집</button><button className="btn" onClick={onVersion} disabled={disabled}>새 버전 업로드</button></div>}</div>
    {editing && <div className="asset-edit"><label className="field">자료 이름<input className="input" value={name} maxLength={150} onChange={e => setName(e.target.value)} /></label><label className="field">제품 연결<select className="input" value={productId} onChange={e => setProductId(e.target.value)}><option value="">프로젝트 공통</option>{asset.productId && !products.some(p => p.id === asset.productId) && <option value={asset.productId}>보관된 제품</option>}{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="field">분류<select className="input" value={category} onChange={e => setCategory(e.target.value)}>{ASSET_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label><button className="btn btn-primary self-end" disabled={pending} onClick={save}>{pending ? "저장 중…" : "분류 저장"}</button></div>}
    {error && <p role="alert" className="form-error mt-3">{error}</p>}
    <details className="asset-history"><summary><History size={13} />버전 이력 · {asset.versions.length}개</summary>{asset.versions.map(v => <div className="asset-history-row" key={v.id}><div><strong>v{v.version}</strong>{v.version === asset.currentVersion && <span className="badge ml-2">현재</span>}<p className="description text-xs mt-2">{v.originalName} · {sizeLabel(v.byteSize)} · {new Date(v.createdAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</p><code className="asset-hash">SHA-256 {v.sha256 ?? "이전 자료 · 미검증"}</code></div>{v.verificationStatus === "verified" && <AssetAccess projectId={projectId} assetId={asset.id} versionId={v.id} name={asset.name} version={v.version} />}</div>)}</details>
  </article>;
}

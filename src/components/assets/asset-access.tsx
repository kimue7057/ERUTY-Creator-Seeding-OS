"use client";
/* Signed private URLs must bypass Next.js image optimization and shared caches. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { Download, Eye, X, LoaderCircle } from "lucide-react";
type Props = { projectId: string; assetId: string; versionId: string; name: string; version: number; campaignId?: string; briefVersion?: number };
export async function assetRequest(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, credentials: "same-origin", cache: "no-store", headers: { "X-Eruty-Request": "1", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error ?? "요청을 처리하지 못했습니다."); }
  return response.status === 204 ? null : response.json();
}
export function AssetAccess(props: Props) {
  const [pending, setPending] = useState(false); const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ url: string; mimeType: string; expiresAt: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (preview && element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, [preview]);
  async function open(inline: boolean) {
    setPending(true); setError("");
    try {
      const result = await assetRequest(`/api/projects/${props.projectId}/assets/${props.assetId}/download`, "POST", { versionId: props.versionId, inline, campaignId: props.campaignId, briefVersion: props.briefVersion });
      if (inline) setPreview(result);
      else { const anchor = document.createElement("a"); anchor.href = result.url; anchor.download = props.name; anchor.rel = "noreferrer"; anchor.click(); }
    } catch (e) { setError(e instanceof Error ? e.message : "파일을 열지 못했습니다."); }
    finally { setPending(false); }
  }
  return <><div className="asset-access"><button className="btn" disabled={pending} onClick={() => open(true)} aria-label={`${props.name} v${props.version} 미리보기`}><Eye size={13} />미리보기</button><button className="btn" disabled={pending} onClick={() => open(false)} aria-label={`${props.name} v${props.version} 다운로드`}>{pending ? <LoaderCircle size={13} className="animate-spin" /> : <Download size={13} />}다운로드</button></div>{error && <p role="alert" className="form-error mt-3">{error}</p>}
    {preview && <dialog ref={dialog} className="preview-dialog" aria-label={`${props.name} 미리보기`} onCancel={() => setPreview(null)}><header className="flex items-center justify-between gap-3"><div><h2>{props.name} <span className="badge">v{props.version}</span></h2><p className="description text-xs mt-2">권한 확인 후 발급한 60초 링크입니다. 만료되면 다시 열어 주세요.</p></div><button className="btn" aria-label="미리보기 닫기" autoFocus onClick={() => setPreview(null)}><X size={16} /></button></header>
      <div className="preview-content">{preview.mimeType.startsWith("image/") ? <img src={preview.url} alt={props.name} referrerPolicy="no-referrer" /> : preview.mimeType === "video/mp4" ? <video src={preview.url} controls preload="metadata">이 브라우저에서 동영상을 미리 볼 수 없습니다. 다운로드해 확인하세요.</video> : <iframe src={preview.url} title={`${props.name} PDF`} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" />}</div><footer className="flex justify-end mt-4"><button className="btn" disabled={pending} onClick={() => open(true)}>미리보기 다시 열기</button></footer>
    </dialog>}
  </>;
}

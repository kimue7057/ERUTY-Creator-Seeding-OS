"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { productAction, archiveProductAction } from "@/app/(app)/projects/actions";
import { initialState } from "@/lib/action-state";
import type { ProductInput } from "@/lib/validation/projects";
export function ProductForm({ projectId, product }: { projectId: string; product?: ProductInput & { id: string } }) {
  const [state, action, pending] = useActionState(productAction.bind(null, projectId, product?.id), initialState);
  const [archiveState, archive, archiving] = useActionState(archiveProductAction.bind(null, projectId, product?.id ?? ""), initialState);
  const [values, setValues] = useState({ name: product?.name ?? "", features: product?.features ?? "", url: product?.url ?? "" });
  function field(name: keyof typeof values) { return { name, value: values[name], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues(v => ({ ...v, [name]: e.target.value })) }; }
  return <><form action={action} className="surface"><section className="form-section"><h2>제품 정보</h2>{state.error && <div className="form-error" role="alert">{state.error}</div>}<div className="field-grid">
    <label className="field">제품명 *<input {...field("name")} className="input" required maxLength={100} /></label><label className="field">제품 URL<input {...field("url")} className="input" type="url" maxLength={2000} placeholder="https://" /></label><label className="field field-full">제품 특징 · USP<textarea {...field("features")} className="input" maxLength={5000} /></label>
  </div></section><footer className="form-actions"><Link className="btn" href={`/projects/${projectId}`}>취소</Link><button className="btn btn-primary" disabled={pending || archiving}>{pending ? "저장 중…" : "제품 저장"}</button></footer></form>
  {product && <form action={archive} className="mt-6">{archiveState.error && <p role="alert" className="form-error">{archiveState.error}</p>}<button disabled={archiving || pending} className="btn btn-danger">{archiving ? "보관 중…" : "제품 보관"}</button><p className="description mt-2 text-xs">보관하면 새 캠페인 선택 목록에서 제외됩니다. 기존 캠페인 기록은 유지됩니다.</p></form>}</>;
}

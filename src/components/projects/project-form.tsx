"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { projectAction } from "@/app/(app)/projects/actions";
import { initialState } from "@/lib/action-state";
import type { ProjectInput } from "@/lib/validation/projects";
import { useHydrated } from "@/components/use-hydrated";
import { FormError } from "@/components/form-error";
export function ProjectForm({ project }: { project?: ProjectInput & { id: string } }) {
  const [state, action, pending] = useActionState(projectAction.bind(null, project?.id), initialState);
  const hydrated = useHydrated();
  const [values, setValues] = useState({ name: project?.name ?? "", website: project?.website ?? "", summary: project?.summary ?? "", usp: project?.usp ?? "", brandStyle: project?.brandStyle ?? "", referenceUrls: project?.referenceUrls.join("\n") ?? "" });
  function field(name: keyof typeof values) { return { name, "aria-label": { name: "프로젝트명 *", website: "공식 웹사이트", summary: "브랜드 소개", usp: "핵심 USP", brandStyle: "브랜드 스타일", referenceUrls: "참고 링크" }[name], value: values[name], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues(v => ({ ...v, [name]: e.target.value })) }; }
  return <form action={action} className="surface" onReset={e => e.preventDefault()}><fieldset className="contents" disabled={!hydrated || pending}>
    <section className="form-section"><h2>브랜드 기본 정보</h2><FormError message={state.error} /><div className="field-grid">
      <label className="field">프로젝트명 *<input {...field("name")} className="input" required maxLength={100} placeholder="브랜드 또는 프로젝트 이름" /></label>
      <label className="field">공식 웹사이트<input {...field("website")} type="url" className="input" maxLength={2000} placeholder="https://" /></label>
      <label className="field field-full">브랜드 소개<textarea {...field("summary")} className="input" maxLength={5000} placeholder="브랜드가 전하고 싶은 이야기와 핵심 가치를 입력하세요." /></label>
      <label className="field field-full">핵심 USP<textarea {...field("usp")} className="input" maxLength={5000} placeholder="제품과 브랜드만의 차별점" /></label>
      <label className="field field-full">브랜드 스타일<textarea {...field("brandStyle")} className="input" maxLength={3000} placeholder="톤앤매너, 비주얼 방향, 원하는 콘텐츠 분위기" /></label>
      <label className="field field-full">참고 링크<textarea {...field("referenceUrls")} className="input" placeholder="https://example.com/reference" /><small>http/https 링크를 한 줄에 하나씩 입력하세요. 최대 20개.</small></label>
    </div></section><footer className="form-actions"><Link href={project ? `/projects/${project.id}` : "/projects"} className="btn">취소</Link><button className="btn btn-primary" disabled={pending}>{pending ? "저장 중…" : project ? "변경 저장" : "프로젝트 만들기"}</button></footer>
  </fieldset></form>;
}

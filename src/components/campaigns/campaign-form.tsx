"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { campaignAction } from "@/app/(app)/campaigns/actions";
import { initialState } from "@/lib/action-state";
import { FormError } from "@/components/form-error";
import { useHydrated } from "@/components/use-hydrated";
import { COUNTRIES, PLATFORMS, STATUSES, type CampaignInput } from "@/lib/validation/campaigns";
type ProductOption = { id: string; name: string; archivedAt: Date | null };
export function CampaignForm({ projectOptions, projectId, products, campaign }: { projectOptions: { id: string; name: string }[]; projectId: string; products: ProductOption[]; campaign?: CampaignInput & { id: string } }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [state, action, pending] = useActionState(campaignAction.bind(null, campaign?.id), initialState);
  const [values, setValues] = useState({ title: campaign?.title ?? "", categories: campaign?.categories.join(", ") ?? "", followerMin: String(campaign?.followerMin ?? 10000), followerMax: String(campaign?.followerMax ?? 100000), goalCount: String(campaign?.goalCount ?? 100), notes: campaign?.notes ?? "", exclusions: campaign?.exclusions ?? "", budget: campaign?.budget == null ? "" : String(campaign.budget), currency: campaign?.currency ?? "KRW", startsOn: campaign?.startsOn ?? "", endsOn: campaign?.endsOn ?? "", status: campaign?.status ?? "draft" });
  const [countries, setCountries] = useState<string[]>(campaign?.countryCodes ?? []);
  const [platforms, setPlatforms] = useState<string[]>(campaign?.platforms ?? []);
  const [productIds, setProductIds] = useState<string[]>(campaign?.productIds ?? []);
  function toggle(setter: React.Dispatch<React.SetStateAction<string[]>>, value: string) { setter(v => v.includes(value) ? v.filter(x => x !== value) : [...v, value]); }
  function field(name: keyof typeof values) { return { name, "aria-label": { title: "캠페인명 *", categories: "크리에이터 카테고리 *", followerMin: "최소 팔로워 수 *", followerMax: "최대 팔로워 수 *", goalCount: "목표 크리에이터 수 직접 입력", notes: "추가 타겟팅 조건", exclusions: "제외 조건", budget: "예산", currency: "통화", startsOn: "시작일", endsOn: "종료일", status: "관리 상태" }[name], value: values[name], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setValues(v => ({ ...v, [name]: e.target.value })) }; }
  const available = products.length > 0;
  return <form action={action} className="surface" onReset={e => e.preventDefault()}>
    <fieldset className="contents" disabled={!hydrated || pending}>
    <section className="form-section"><h2>01 · 캠페인 기본 정보</h2><FormError message={state.error} /><div className="field-grid">
      <label className="field">프로젝트 *<select className="input" name={campaign ? undefined : "projectId"} value={projectId} disabled={!!campaign || pending} onChange={e => router.push(`/campaigns/new?projectId=${e.target.value}`)}>{projectOptions.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select><small>{campaign ? "프로젝트 연결은 생성 후 변경할 수 없습니다." : "프로젝트를 바꾸면 입력 양식이 초기화됩니다."}</small></label>{campaign && <input type="hidden" name="projectId" value={projectId} />}
      <label className="field">캠페인명 *<input {...field("title")} className="input" required maxLength={150} placeholder="예: 가을 신제품 일본 시딩" /></label>
      <fieldset className="field field-full"><legend className="mb-2">관련 제품 *</legend>{available ? <div className="checks">{products.map(p => <label key={p.id} className="check-chip"><input type="checkbox" name="productIds" value={p.id} checked={productIds.includes(p.id)} onChange={() => toggle(setProductIds, p.id)} />{p.name}{p.archivedAt ? " (보관됨)" : ""}</label>)}</div> : <div className="info-banner m-0">이 프로젝트에 제품이 없습니다. <Link href={`/projects/${projectId}/products/new`} className="underline">제품을 먼저 추가하세요.</Link></div>}<small>선택한 제품과 브랜드 정보를 브리프에 보존합니다. 제품 구성이 바뀌면 새 버전을 만듭니다.</small></fieldset>
    </div></section>
    <section className="form-section"><h2>02 · 크리에이터 타겟팅</h2><div className="field-grid">
      <fieldset className="field field-full"><legend className="mb-2">대상 국가 * <span className="muted font-normal">여러 국가 선택 가능</span></legend><div className="checks">{COUNTRIES.map(c => <label key={c.code} className="check-chip"><input name="countryCodes" type="checkbox" value={c.code} checked={countries.includes(c.code)} onChange={() => toggle(setCountries, c.code)} />{c.label}<span className="muted text-[10px]">{c.code}</span></label>)}</div></fieldset>
      <fieldset className="field field-full"><legend className="mb-2">대상 플랫폼 *</legend><div className="checks">{PLATFORMS.map(p => <label className="check-chip" key={p.value}><input type="checkbox" name="platforms" value={p.value} checked={platforms.includes(p.value)} onChange={() => toggle(setPlatforms, p.value)} />{p.label}</label>)}</div></fieldset>
      <label className="field field-full">크리에이터 카테고리 *<input {...field("categories")} aria-label="크리에이터 카테고리 *" required className="input" placeholder="뷰티, 라이프스타일, 패션" /><small>쉼표로 구분해 여러 카테고리를 입력하세요.</small></label>
      <label className="field">최소 팔로워 수 *<input {...field("followerMin")} className="input" type="number" required min={0} max={2147483647} step={1} /></label><label className="field">최대 팔로워 수 *<input {...field("followerMax")} className="input" type="number" required min={0} max={2147483647} step={1} /></label>
      <div className="field field-full"><label htmlFor="goalCount">목표 크리에이터 수 *</label><div className="flex gap-2 flex-wrap">{[50, 100, 300, 500].map(n => <button key={n} type="button" aria-pressed={values.goalCount === String(n)} onClick={() => setValues(v => ({ ...v, goalCount: String(n) }))} className={`btn ${values.goalCount === String(n) ? "btn-primary" : ""}`}>{n}명</button>)}</div><input {...field("goalCount")} id="goalCount" className="input max-w-52" type="number" required min={1} max={100000} step={1} aria-label="목표 크리에이터 수 직접 입력" /><small>프리셋 선택 또는 직접 입력. 실제 발굴 인원을 보장하는 수치는 아닙니다.</small></div>
      <label className="field">추가 타겟팅 조건<textarea {...field("notes")} className="input" maxLength={5000} placeholder="원하는 콘텐츠 유형, 언어, 협업 조건" /></label><label className="field">제외 조건<textarea {...field("exclusions")} className="input" maxLength={5000} placeholder="제외할 계정 유형, 카테고리 등" /></label>
    </div></section>
    <section className="form-section"><h2>03 · 예산 및 일정 <span className="text-xs font-normal muted">선택 입력</span></h2><div className="field-grid">
      <label className="field">예산<input {...field("budget")} className="input" type="number" min={0} max={2147483647} step={1} placeholder="미정" /></label><label className="field">통화<select {...field("currency")} className="input">{["KRW", "USD", "JPY", "EUR"].map(c => <option key={c}>{c}</option>)}</select></label>
      <label className="field">시작일<input {...field("startsOn")} type="date" className="input" /></label><label className="field">종료일<input {...field("endsOn")} type="date" className="input" /></label><label className="field">관리 상태<select {...field("status")} className="input">{STATUSES.map(s => <option value={s.value} key={s.value}>{s.label}</option>)}</select><small>준비 완료는 타겟팅 설정 상태입니다. SNS 발굴을 실행하지 않습니다.</small></label>
    </div></section><footer className="form-actions"><Link href={campaign ? `/campaigns/${campaign.id}` : "/campaigns"} className="btn">취소</Link><button className="btn btn-primary" disabled={pending || !available}>{pending ? "저장 중…" : campaign ? "변경 저장" : "캠페인 만들기"}</button></footer>
    </fieldset></form>;
}

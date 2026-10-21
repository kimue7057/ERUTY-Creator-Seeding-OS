"use client";
import { useActionState } from "react";
import { login } from "./actions";
import { ArrowRight } from "lucide-react";
export function LoginForm() {
  const [state, action, pending] = useActionState(login, { error: "" });
  return <form action={action} className="login-form"><div className="eyebrow">Your workspace awaits</div><h1>워크스페이스 로그인</h1><p className="description mb-8">시딩 운영에 필요한 모든 정보를 한 곳에서.</p>{state.error && <div className="form-error" role="alert">{state.error}</div>}<div className="stack"><label className="field">이메일<input name="email" type="email" autoComplete="username" className="input" required maxLength={254} /></label><label className="field">비밀번호<input name="password" type="password" autoComplete="current-password" className="input" required maxLength={256} /></label><button disabled={pending} className="btn btn-primary mt-2">{pending ? "로그인 중…" : "로그인"}<ArrowRight size={15} /></button></div><p className="description mt-6 text-[11px]">접근 권한이 필요하면 워크스페이스 관리자에게 문의하세요.</p></form>;
}

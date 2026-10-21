import { LoginForm } from "./form";
export default function LoginPage() {
  return <div className="login-wrap"><section className="login-brand"><div><div className="wordmark">eruty<span className="brand-dot" /></div><div className="brand-caption text-[#a9c5ad]">CREATOR SEEDING OS</div></div><div><span className="eyebrow text-[#b7cdb8]">From brand to meaningful connection</span><h1>브랜드의 이야기에서,<br />새로운 연결까지.</h1><p className="leading-8 text-[#bdd0bd]">프로젝트를 정리하고 캠페인을 설계하는<br />크리에이터 시딩 운영 워크스페이스.</p></div><footer className="text-xs text-[#a9c1aa]">ERUTY · Creator Seeding OS</footer></section><section className="login-form-wrap"><LoginForm /></section></div>;
}

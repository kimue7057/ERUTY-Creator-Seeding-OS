"use client";
import Link from "next/link";
import { useState } from "react";
import type { SavedMessageTemplate } from "@/lib/outreach/templates";
import { applyTemplate, starterTemplates, type MailLayout } from "@/lib/outreach/template-contracts";
export function ComposeTemplates({templates,channel,creator,brand,campaign,hasSent,writable,onApply}:{templates:SavedMessageTemplate[];channel:string;creator:string;brand:string;campaign:string;hasSent:boolean;writable:boolean;onApply:(value:{subject:string;body:string;template:MailLayout;language:"한국어"|"English"})=>void}) {
  const [selected,setSelected]=useState(""),[reason,setReason]=useState("");
  const catalog=templates.filter(t=>!t.archivedAt&&t.channel===channel);
  const defaults=channel==="email"?starterTemplates.map((t,i)=>({...t,id:`builtin-${i}`,language:"한국어"})):[];
  const options=catalog.length?catalog:defaults;
  const current=options.find(t=>t.id===selected),needsReason=!!current?.body.includes("{{reason}}"),needsPrevious=current?.layout==="followup"&&!hasSent;
  const values={creator,brand:brand||"{{brand}}",campaign,reason:reason.trim()||"{{reason}}"};
  return <div className="compose-template-box"><div className="outreach-intro"><div><h3>저장한 템플릿으로 시작</h3><p className="description">분석에서 확인한 제안 이유를 넣고, 적용할 문장을 먼저 검토하세요.</p></div><Link className="source-link" href="/settings/templates" target="_blank">템플릿 관리 ↗</Link></div><label>메시지 템플릿<select aria-label="메시지 템플릿" className="input" value={selected} disabled={!writable} onChange={e=>setSelected(e.target.value)}><option value="">템플릿 선택</option>{options.map(t=><option key={t.id} value={t.id}>{t.name} · {t.language}</option>)}</select></label>
    {!options.length&&<p className="description">이 채널용 템플릿이 없습니다. 템플릿 관리에서 DM 문장을 저장할 수 있습니다.</p>}
    {current&&<>{needsReason&&<label className="mt-4">이 크리에이터에게 제안하는 이유<textarea className="input" value={reason} maxLength={1500} disabled={!writable} placeholder="분석과 원본에서 직접 확인한 콘텐츠 특징과 제안 이유를 적어주세요." onChange={e=>setReason(e.target.value)}/></label>}
      <div className="outreach-proposal mt-4"><strong>적용할 문장</strong><pre>{channel==="email"?applyTemplate(current.subject,values)+"\n\n":""}{applyTemplate(current.body,values)}</pre>
      {needsPrevious&&<p className="outreach-note">이 앱에서 확인된 이전 발송이 없습니다. 첫 연락에는 첫 협업 제안 템플릿을 사용하세요.</p>}
      {!brand&&<p className="outreach-note">회사 서명을 설정하거나 적용 후 {"{{brand}}"}를 실제 회사 이름으로 작성하세요.</p>}
      <button className="btn" disabled={!writable||needsReason&&!reason.trim()||needsPrevious} onClick={()=>{onApply({subject:applyTemplate(current.subject,values),body:applyTemplate(current.body,values),template:current.layout,language:current.language as "한국어"|"English"});setSelected("");}}>이 문장으로 본문 적용</button><p className="description">현재 제목·본문을 위 문장으로 바꿉니다. 발신 계정·수신 주소는 유지됩니다.</p></div>
    </>}
  </div>;
}

"use client";
import { useEffect, useRef, useState } from "react";
import { OutreachError, outreachErrorMessage, type SenderAddress } from "@/lib/outreach/contracts";
import { testEmailBody, testEmailSubject, type ConnectionTestResult } from "@/lib/outreach/test-email-contracts";

const statusLabels = { sending: "발송 결과 확인 중", sent: "메일 서비스 발송 완료", failed: "발송 실패", unknown: "발송 여부 확인 필요" };
export function ConnectionTest({ accountId, addresses }: { accountId: string; addresses: SenderAddress[] }) {
  const [open, setOpen] = useState(false), [from, setFrom] = useState(addresses[0]?.address ?? ""), [to, setTo] = useState("");
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState<ConnectionTestResult[]>([]), [message, setMessage] = useState("");
  const active = useRef(false), attempt = useRef<string | null>(null);
  const [result, setResult] = useState<ConnectionTestResult | null>(null), [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/outreach/test-email?accountId=${accountId}`, { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!cancelled) { setHistory(data.tests); setLoaded(true); }
    }).catch(() => { if (!cancelled) setMessage("테스트 이력을 불러오지 못했습니다. 새로고침해 주세요."); });
    return () => { cancelled = true; };
  }, [accountId, open]);
  const unresolved = history.some(t => t.status === "sending" || t.status === "unknown");
  async function checkResult() {
    setBusy(true);
    try {
      const response = await fetch(`/api/outreach/test-email?accountId=${accountId}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json(); setHistory(data.tests);
      const saved = (data.tests as ConnectionTestResult[]).find(t => t.id === attempt.current);
      if (saved) { setResult(saved); setUncertain(false); setMessage(""); }
      else setMessage("아직 발송 기록을 확인하지 못했습니다. 메일함을 확인한 뒤 결과를 다시 조회하세요.");
    } catch { setMessage("결과를 불러오지 못했습니다. 다시 조회해 주세요. 메일을 재발송하지는 않습니다."); }
    finally { setBusy(false); }
  }
  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current || !confirmed || result || uncertain || unresolved || !loaded) return;
    active.current = true; setBusy(true); setMessage("");
    const id = crypto.randomUUID(); attempt.current = id;
    try {
      const response = await fetch("/api/outreach/test-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, accountId, fromAddress: from, toAddress: to, confirmed: true }) });
      const data = await response.json();
      if (!response.ok) {
        if (response.status >= 500) throw new Error();
        setMessage(data.message ?? "요청 내용을 확인해 주세요."); return;
      }
      setResult(data.test); setHistory(previous => [data.test, ...previous].slice(0, 5));
    } catch { setUncertain(true); setMessage("응답이 끊겨 발송 결과를 확인해야 합니다. 아래에서 결과를 조회하세요."); }
    finally { active.current = false; setBusy(false); setConfirmed(false); }
  }
  return <section className="connection-test">
    <button type="button" className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>테스트 메일 {open ? "닫기" : "보내기"}</button>
    {open && <div className="connection-test-content">
      <p className="description">받을 주소로 테스트 메일 한 통을 보냅니다. 크리에이터 연락 이력에는 포함되지 않습니다.</p>
      <form onSubmit={send}>
        <label>테스트 발신 주소<select aria-label="테스트 발신 주소" className="input" value={from} disabled={busy || !!result || uncertain} onChange={e => { setFrom(e.target.value); setConfirmed(false); }}>{addresses.map(a => <option key={a.address} value={a.address}>{a.address}</option>)}</select></label>
        <label>테스트 수신 주소<input className="input" type="email" required maxLength={254} value={to} placeholder="테스트를 받을 이메일" disabled={busy || !!result || uncertain} onChange={e => { setTo(e.target.value); setConfirmed(false); }}/></label>
        <div className="outreach-note"><strong>{testEmailSubject}</strong><p>{testEmailBody}</p><p className="description">서명: {from}</p></div>
        {!result && !uncertain && <><label className="sender-alias-check"><input type="checkbox" checked={confirmed} disabled={busy || unresolved} onChange={e => setConfirmed(e.target.checked)}/>위 발신·수신 주소와 내용을 확인하고 실제 발송합니다.</label><button className="btn btn-primary" disabled={busy || !loaded || !confirmed || !to || unresolved}>{busy ? "발송 중…" : "테스트 메일 1통 발송"}</button></>}
      </form>
      {result && <p role="status" className={result.status === "sent" ? "outreach-success" : "outreach-note"}>{result.status === "sent" ? `${result.toAddress}으로 발송했습니다. 수신 메일함과 스팸함에서 도착 여부를 확인하세요.` : outreachErrorMessage(new OutreachError(result.errorCode ?? "send_unknown"))}</p>}
      {(uncertain || unresolved) && <div className="outreach-note"><p>발송 여부가 확인되지 않은 요청이 있습니다. 중복 발송을 막기 위해 새 테스트를 잠시 멈췄습니다.</p><button type="button" className="btn" disabled={busy} onClick={checkResult}>발송 결과 다시 조회</button></div>}
      {result && ["sent", "failed"].includes(result.status) && !unresolved && <button className="btn" type="button" onClick={() => { setResult(null); setConfirmed(false); attempt.current = null; }}>새 테스트 작성</button>}
      {message && <p role="alert" className="form-error">{message}</p>}
      {!!history.length && <div className="connection-test-history"><strong>최근 테스트</strong>{history.map(t => <p key={t.id}><span>{t.toAddress}</span><span>{statusLabels[t.status]} · {new Date(t.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</span></p>)}</div>}
    </div>}
  </section>;
}

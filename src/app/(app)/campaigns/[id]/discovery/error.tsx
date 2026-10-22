"use client";
export default function DiscoveryErrorPage({ reset }: { reset: () => void }) { return <section className="surface empty" role="alert"><h1>발굴 기록을 불러오지 못했습니다</h1><p>잠시 후 다시 시도해 주세요. 권한이 변경되었다면 로그인 상태를 확인해 주세요.</p><button className="btn btn-primary" onClick={reset}>다시 불러오기</button></section>; }

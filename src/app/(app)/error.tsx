"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <div className="surface empty"><h1>정보를 불러오지 못했습니다</h1><p>잠시 후 다시 시도해 주세요. 문제가 계속되면 DB 연결과 서버 상태를 확인하세요.</p><button className="btn btn-primary" onClick={reset}>다시 시도</button></div>;
}

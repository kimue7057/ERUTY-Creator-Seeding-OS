import Link from "next/link";
export default function NotFound() { return <div className="empty"><h1>항목을 찾을 수 없습니다</h1><p>주소와 워크스페이스 접근 권한을 확인해 주세요.</p><Link className="btn" href="/">워크스페이스로 돌아가기</Link></div>; }

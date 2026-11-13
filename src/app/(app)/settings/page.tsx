import Link from 'next/link';
import {PageHeading} from '@/components/ui';
export default function SettingsPage(){return <><PageHeading eyebrow="WORKSPACE SETTINGS" title="설정" description="연락에 사용할 회사 계정과 메시지 기본값을 관리하세요."/><div className="settings-grid">{[
 {href:'/settings/accounts',title:'발신 계정',text:'이메일·Instagram 회사 계정을 추가하고 연결 상태와 답장 수신 권한을 확인합니다.'},
 {href:'/settings/ai',title:'AI 문장 작성',text:'크리에이터 분석에 기반한 문장 생성과 OpenRouter 연결 상태를 확인합니다.'},
 {href:'/settings/templates',title:'템플릿·회사 서명',text:'제안문 템플릿과 공식 이메일 서명을 관리합니다. 실제 문안은 크리에이터별로 검토합니다.'},
 {href:'/settings/browser-executor',title:'회사 Chrome 연결',text:'Instagram 첫 연락을 실행할 회사 Chrome과 로그인 계정을 연결합니다.'},
 {href:'/settings/connections',title:'서비스 연결 설정',text:'Google·Meta·TikTok 앱의 인증 정보를 설정합니다.'},
 ].map(item=><Link key={item.href} href={item.href} className="surface settings-card"><h2>{item.title} →</h2><p className="description">{item.text}</p></Link>)}</div></>;}

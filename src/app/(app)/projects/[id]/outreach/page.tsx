import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireActor} from '@/lib/auth/session';
import {canWrite} from '@/lib/auth/permissions';
import {reviewPageData} from '@/lib/outreach/review-service';
import {OutreachError} from '@/lib/outreach/contracts';
import {ReviewWorkbench} from '@/components/outreach/review-workbench';
import {PageHeading} from '@/components/ui';
import {safeId} from '@/lib/validation/projects';
export default async function ProjectReview({params}:{params:Promise<{id:string}>}){
 const actor=await requireActor(),{id}=await params;if(!safeId(id))notFound();let data;try{data=await reviewPageData(actor,id);}catch(error){if(error instanceof OutreachError&&error.code==='not_found')notFound();throw error;}
 return <><PageHeading eyebrow="PROJECT · OUTREACH" title={`${data.workspace.project.name} · 협업 문의`} description="크리에이터별 초안과 DM 미리보기를 검토한 뒤, 회사 발신 계정을 선택해 연락하세요."/><div className="sender-actions"><Link className="btn" href={`/projects/${id}`}>프로젝트로</Link><Link className="btn" href="/settings/accounts">발신 계정 관리</Link><Link className="btn" href="/settings/browser-executor">회사 Chrome 연결</Link></div><ReviewWorkbench initial={data} writable={canWrite(actor)}/></>;
}

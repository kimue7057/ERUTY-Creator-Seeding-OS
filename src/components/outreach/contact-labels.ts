export const progressLabels={proposal:'제안 발송',negotiating:'협의 중',agreed:'진행 확정',declined:'진행 안 함',hold:'보류',closed:'종료'} as const;
export const contactTime=(value:string|Date|null)=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'아직 조회하지 않음';
export {contactTask} from '@/lib/outreach/contact-workspace';

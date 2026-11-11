export const progressLabels={proposal:'제안 발송',negotiating:'협의 중',agreed:'진행 확정',declined:'진행 안 함',hold:'보류',closed:'종료'} as const;
export const contactTime=(value:string|Date|null)=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'아직 조회하지 않음';
export function contactTask(row:{blocked:boolean;lastDirection:string;syncError:string|null;lastSyncedAt:Date|null;progress:string}){return row.blocked?'결과 확인 필요':row.syncError||!row.lastSyncedAt?'수신 확인 필요':['closed','declined','hold'].includes(row.progress)?'보류·종료':row.lastDirection==='in'?'회신 필요':'답장 대기';}

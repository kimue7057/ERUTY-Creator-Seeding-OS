'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {translateOutreachReview} from '@/app/(app)/outreach/translation-actions';
import {translationSourceKey,type ReviewTranslation} from '@/lib/outreach/translation-contracts';

export function AutoKoreanReview({subject,body,enabled}:{subject:string;body:string;enabled:boolean}){
 const review=useKoreanReviewTranslation(subject,body,enabled);return <KoreanReviewTranslation review={review}/>;
}

export function useKoreanReviewTranslation(subject:string,body:string,enabled:boolean){
 const source=translationSourceKey(subject,body),needed=enabled&&!!body.trim();
 const [result,setResult]=useState<{source:string;translation?:ReviewTranslation;error?:string}|null>(null),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!needed)return;let current=true;
  const timer=setTimeout(()=>{void translateOutreachReview({subject,body}).then(value=>{if(current)setResult({source,...value});}).catch(()=>{if(current)setResult({source,error:'한글 번역을 불러오지 못했습니다. 다시 시도해 주세요.'});});},900);
  return()=>{current=false;clearTimeout(timer);};
 },[source,subject,body,needed,retry]);
 const translation=needed&&result?.source===source?result.translation:undefined,error=needed&&result?.source===source?result.error:undefined;
 return {needed,translation,error,ready:!needed||!!translation,retry:()=>{setResult(null);setRetry(n=>n+1);}};
}
export function KoreanReviewTranslation({review}:{review:ReturnType<typeof useKoreanReviewTranslation>}){
 if(!review.needed)return null;
 return <section className="outreach-korean-review" aria-label="검토용 한글 번역" aria-busy={!review.translation&&!review.error}>
  <div><strong>검토용 한글 번역</strong><small>상대에게는 원문만 전송됩니다.</small></div>
  {review.translation?<>{review.translation.subject&&<p className="translation-subject"><span>제목</span>{review.translation.subject}</p>}<p className="translation-body" lang="ko">{review.translation.body}</p></>:review.error?<div role="status"><p>{review.error}</p><button className="btn" onClick={review.retry}>번역 다시 불러오기</button><Link className="source-link" href="/settings/ai" target="_blank">AI 연결 설정 ↗</Link></div>:<p role="status">현재 영문을 한글로 번역하고 있습니다…</p>}
 </section>;
}

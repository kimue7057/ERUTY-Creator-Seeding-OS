'use server';
import {requireActor} from '@/lib/auth/session';
import {reviewTranslationService} from '@/lib/outreach/translations';
import {outreachErrorMessage,OutreachError} from '@/lib/outreach/contracts';
export async function translateOutreachReview(input:unknown){
 const actor=await requireActor();try{return {translation:await reviewTranslationService().translate(actor,input)};}catch(e){return {error:e instanceof OutreachError&&e.code==='not_configured'?'한글 번역을 위해 설정에서 OpenRouter 연결을 확인하세요.':outreachErrorMessage(e)};}
}

"use server";
import {requireActor} from "@/lib/auth/session";
import {outreachExecutorService} from "@/lib/outreach/executors";
import {outreachErrorMessage} from "@/lib/outreach/contracts";
import {chatPreviewService} from '@/lib/outreach/chat-previews';
export async function loadChatPreviews(){const actor=await requireActor();try{return{jobs:await chatPreviewService().history(actor)};}catch(error){return{error:outreachErrorMessage(error)};}}
export async function requestChatPreview(input:unknown){const actor=await requireActor();try{if(process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED!=='true')return{error:'연락 실행기를 사용할 수 없습니다.'};return{job:await chatPreviewService().create(actor,input)};}catch(error){return{error:outreachErrorMessage(error)};}}
export async function requestComposePreview(input:unknown){const actor=await requireActor();try{if(process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED!=='true')return{error:'연락 실행기를 사용할 수 없습니다.'};return{job:await chatPreviewService().compose(actor,input)};}catch(error){return{error:outreachErrorMessage(error)};}}
export async function loadOutreachExecutors(){const actor=await requireActor();try{return{connections:await outreachExecutorService().list(actor),checkedAt:Date.now()};}catch(error){return{error:outreachErrorMessage(error)};}}
export async function pairOutreachExecutor(input:unknown){const actor=await requireActor();try{if(process.env.CODEX_AUTOMATIC_DISCOVERY_ENABLED!=="true")return{error:"연락 실행기를 사용할 수 없습니다."};return{pair:await outreachExecutorService().startPair(actor,input)};}catch(error){return{error:outreachErrorMessage(error)};}}
export async function revokeOutreachExecutor(id:string){const actor=await requireActor();try{return await outreachExecutorService().revoke(actor,id);}catch(error){return{error:outreachErrorMessage(error)};}}

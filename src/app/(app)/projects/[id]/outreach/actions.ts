'use server';
import {requireActor} from '@/lib/auth/session';
import {reviewOutreachService,reviewPageData} from '@/lib/outreach/review-service';
import {outreachErrorMessage} from '@/lib/outreach/contracts';
import {browserSendService} from '@/lib/outreach/browser-sends';
export async function loadProjectReview(projectId:string){const actor=await requireActor();try{return{data:await reviewPageData(actor,projectId)};}catch(error){return{error:outreachErrorMessage(error)};}}
export async function saveProjectReview(input:unknown){const actor=await requireActor();try{return{draft:await reviewOutreachService().save(actor,input)};}catch(error){return{error:outreachErrorMessage(error)};}}
export async function importProjectReview(projectId:string){const actor=await requireActor();try{return await reviewOutreachService().importPrepared(actor,projectId);}catch(error){return{error:outreachErrorMessage(error)};}}
export async function copyProjectReview(id:string){const actor=await requireActor();try{return{draft:await reviewOutreachService().copy(actor,id)};}catch(error){return{error:outreachErrorMessage(error)};}}
export async function sendProjectReview(input:unknown){const actor=await requireActor();try{return{result:await reviewOutreachService().send(actor,input)};}catch(error){return{error:outreachErrorMessage(error)};}}
export async function cancelProjectReviewSend(id:string){const actor=await requireActor();try{return await browserSendService().cancel(actor,id);}catch(error){return{error:outreachErrorMessage(error)};}}

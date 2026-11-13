'use server';
import {z} from 'zod';import {revalidatePath} from 'next/cache';import {requireActor} from '@/lib/auth/session';
import {aiSettingsService} from '@/lib/outreach/ai-settings';import {outreachErrorMessage} from '@/lib/outreach/contracts';
export async function saveAiConnection(input:unknown){const actor=await requireActor();try{await aiSettingsService().save(actor,input);revalidatePath('/settings/ai');revalidatePath('/campaigns','layout');return{settings:await aiSettingsService().status(actor)};}catch(error){return{error:error instanceof z.ZodError?'API 키와 모델 ID의 입력 형식을 확인하세요.':outreachErrorMessage(error)};}}
export async function disableAiConnection(revision:number){const actor=await requireActor();try{await aiSettingsService().disable(actor,revision);revalidatePath('/settings/ai');revalidatePath('/campaigns','layout');return{settings:await aiSettingsService().status(actor)};}catch(error){return{error:outreachErrorMessage(error)};}}

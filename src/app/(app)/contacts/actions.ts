'use server';
import {revalidatePath} from 'next/cache';
import {z} from 'zod';
import {requireActor} from '@/lib/auth/session';
import {contactService} from '@/lib/outreach/contacts';
import {outreachErrorMessage} from '@/lib/outreach/contracts';
export async function listContacts(){const actor=await requireActor();try{return{rows:await contactService().list(actor)};}catch(error){return{error:outreachErrorMessage(error)};}}
export async function readContact(id:string){const actor=await requireActor();try{return{detail:await contactService().detail(actor,id)};}catch(error){return{error:outreachErrorMessage(error)};}}
export async function syncContact(id:string){const actor=await requireActor();try{return{detail:await contactService().sync(actor,id)};}catch(error){return{error:outreachErrorMessage(error),detail:await contactService().detail(actor,id).catch(()=>undefined)};}}
export async function syncContactBatch(ids:string[]){const actor=await requireActor();try{const targets=z.array(z.uuid()).max(3).parse(ids);for(const id of targets)await contactService().sync(actor,id).catch(()=>{});return{rows:await contactService().list(actor)};}catch(error){return{error:outreachErrorMessage(error)};}}
export async function updateContact(id:string,input:unknown){const actor=await requireActor();try{await contactService().update(actor,id,input);revalidatePath('/contacts');return{detail:await contactService().detail(actor,id)};}catch(error){return{error:outreachErrorMessage(error)};}}
export async function replyToContact(input:unknown){const actor=await requireActor();try{const detail=await contactService().reply(actor,input);revalidatePath('/contacts');return{detail};}catch(error){return{error:outreachErrorMessage(error)};}}

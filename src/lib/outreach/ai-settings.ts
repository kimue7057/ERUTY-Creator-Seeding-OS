import {and,eq} from 'drizzle-orm';import {z} from 'zod';
import {db} from '../db';import {outreachAiSettings as settings} from '../db/ai-schema';import {auditEvents} from '../db/schema';
import type {ActorScope} from '../auth/permissions';import {outreachMember} from './access';import {seal,unseal} from './crypto';import {OutreachError} from './contracts';
import {checkOpenRouter,defaultOutreachModel,routerKey,routerModel} from './openrouter';
export const aiSettingsInput=z.strictObject({revision:z.number().int().nonnegative(),apiKey:z.union([z.literal(''),routerKey]),model:routerModel});
export function aiSettingsService(database:Pick<typeof db,'transaction'>=db,fetcher:typeof fetch=fetch){
 const scope=(actor:ActorScope)=>eq(settings.organizationId,actor.organizationId);
 return{
  status:(actor:ActorScope)=>database.transaction(async tx=>{await outreachMember(tx,actor);const [row]=await tx.select({model:settings.model,enabled:settings.enabled,verifiedAt:settings.verifiedAt,revision:settings.revision}).from(settings).where(scope(actor));return{provider:'openrouter' as const,configured:!!row,enabled:row?.enabled??false,model:row?.model??defaultOutreachModel,verifiedAt:row?.verifiedAt??null,revision:row?.revision??0};}),
  credentials:(actor:ActorScope)=>database.transaction(async tx=>{await outreachMember(tx,actor,true);const [row]=await tx.select().from(settings).where(scope(actor)).for('share');if(!row?.enabled)throw new OutreachError('not_configured');return{apiKey:routerKey.parse(unseal(row.credentialsCiphertext,`${actor.organizationId}:outreach-ai:openrouter`)),model:row.model};}),
  save:async(actor:ActorScope,input:unknown)=>{
   const data=aiSettingsInput.parse(input);
   const apiKey=await database.transaction(async tx=>{await outreachMember(tx,actor,true,true);const [row]=await tx.select().from(settings).where(scope(actor));if((row?.revision??0)!==data.revision)throw new OutreachError('draft_changed');if(data.apiKey)return data.apiKey;if(!row)throw new OutreachError('ai_key_required');return routerKey.parse(unseal(row.credentialsCiphertext,`${actor.organizationId}:outreach-ai:openrouter`));});
   await checkOpenRouter({apiKey,model:data.model},fetcher);
   await database.transaction(async tx=>{await outreachMember(tx,actor,true,true);const patch={credentialsCiphertext:seal(apiKey,`${actor.organizationId}:outreach-ai:openrouter`),model:data.model,enabled:true,verifiedAt:new Date(),updatedAt:new Date(),updatedBy:actor.userId};
    const saved=data.revision===0?await tx.insert(settings).values({organizationId:actor.organizationId,...patch,createdBy:actor.userId}).onConflictDoNothing().returning():await tx.update(settings).set({...patch,revision:data.revision+1}).where(and(scope(actor),eq(settings.revision,data.revision))).returning();if(!saved.length)throw new OutreachError('draft_changed');
    await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:actor.organizationId,action:'outreach.ai_connection_verified'});
   });return{saved:true};
  },
  disable:(actor:ActorScope,revision:number)=>database.transaction(async tx=>{await outreachMember(tx,actor,true,true);z.number().int().positive().parse(revision);const saved=await tx.update(settings).set({enabled:false,revision:revision+1,updatedBy:actor.userId,updatedAt:new Date()}).where(and(scope(actor),eq(settings.revision,revision))).returning({id:settings.organizationId});if(!saved.length)throw new OutreachError('draft_changed');await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:actor.organizationId,action:'outreach.ai_connection_disabled'});}),
 };
}
export type AiSettingsStatus=Awaited<ReturnType<ReturnType<typeof aiSettingsService>['status']>>;

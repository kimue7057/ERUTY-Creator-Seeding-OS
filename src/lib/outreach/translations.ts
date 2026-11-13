import {createHash} from 'node:crypto';
import {and,eq,sql} from 'drizzle-orm';
import {db} from '../db';import {auditEvents} from '../db/schema';import {outreachReviewTranslations as translations} from '../db/translation-schema';
import type {ActorScope} from '../auth/permissions';
import {outreachMember} from './access';import {aiSettingsService} from './ai-settings';import {OutreachError} from './contracts';import {openRouterJson} from './openrouter';
import {reviewTranslationInput,reviewTranslationOutput,translationSourceKey,translationInstructions,translationJsonSchema,type ReviewTranslation} from './translation-contracts';

const pending=new Map<string,Promise<ReviewTranslation>>();
export function reviewTranslationService(database:Pick<typeof db,'transaction'>=db,fetcher:typeof fetch=fetch){
 return {translate:async(actor:ActorScope,input:unknown):Promise<ReviewTranslation>=>{
  const source=reviewTranslationInput.parse(input),hash=createHash('sha256').update(translationSourceKey(source.subject,source.body)).digest('hex');
  const scope=and(eq(translations.organizationId,actor.organizationId),eq(translations.sourceSha256,hash));
  const cached=await database.transaction(async tx=>{await outreachMember(tx,actor);const [row]=await tx.select({subject:translations.subject,body:translations.body}).from(translations).where(scope);return row;});
  if(cached)return reviewTranslationOutput.parse(cached);
  // Authorize each caller before reusing an in-flight company request.
  await database.transaction(async tx=>{await outreachMember(tx,actor,true);});
  const key=actor.organizationId+':'+hash,existing=pending.get(key);if(existing)return existing;
  const work=(async()=>{
   const credentials=await aiSettingsService(database,fetcher).credentials(actor);
   await database.transaction(async tx=>{await outreachMember(tx,actor,true);await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor.organizationId}),hashtext(${actor.userId+':review-translation'}))`);
    const [{count}]=await tx.select({count:sql<number>`count(*)::int`}).from(auditEvents).where(and(eq(auditEvents.organizationId,actor.organizationId),eq(auditEvents.actorId,actor.userId),eq(auditEvents.action,'outreach.translation_requested'),sql`${auditEvents.createdAt}>now()-interval '2 minutes'`));
    if(count>=12)throw new OutreachError('translation_busy');
    await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:actor.organizationId,action:'outreach.translation_requested'});
   });
   const raw=await openRouterJson(credentials,translationInstructions,JSON.stringify({source}),translationJsonSchema,8000,fetcher),checked=reviewTranslationOutput.safeParse(raw);
   if(!checked.success||(!source.subject&&checked.data.subject)||source.subject&&!checked.data.subject.trim())throw new OutreachError('translation_invalid');
   return database.transaction(async tx=>{await outreachMember(tx,actor,true);await tx.insert(translations).values({organizationId:actor.organizationId,sourceSha256:hash,sourceSubject:source.subject,sourceBody:source.body,...checked.data,model:credentials.model,createdBy:actor.userId}).onConflictDoNothing();
    const [saved]=await tx.select({subject:translations.subject,body:translations.body}).from(translations).where(scope);return reviewTranslationOutput.parse(saved);
   });
  })();pending.set(key,work);try{return await work;}finally{if(pending.get(key)===work)pending.delete(key);}
 }};
}

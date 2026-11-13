import test from 'node:test';import assert from 'node:assert/strict';
import {withDiscoveryDatabase} from '../discovery-fixture';import {aiSettingsService} from '../../src/lib/outreach/ai-settings';import {reviewTranslationService} from '../../src/lib/outreach/translations';import {OutreachError} from '../../src/lib/outreach/contracts';
process.env.OUTREACH_ENCRYPTION_KEY='a'.repeat(64);
const credentials={revision:0,apiKey:'synthetic-translation-key-12345',model:'openai/gpt-5.4-mini'},code=(s:string)=>(e:unknown)=>e instanceof OutreachError&&e.code===s;
const ok:typeof fetch=async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]});
test('translations cache exact content inside the organization, deduplicate concurrent calls, allow cached review, and never change drafts or sends',async()=>withDiscoveryDatabase(async f=>{
 await aiSettingsService(f.database,ok).save(f.actor,credentials);let calls=0;
 const mock:typeof fetch=async(url,init)=>{calls++;assert.equal(String(url),'https://openrouter.ai/api/v1/chat/completions');const request=JSON.parse(String(init?.body)),input=JSON.parse(request.messages[1].content);assert.deepEqual(input.source,{subject:'Original title',body:'Hi SYNTHETIC creator!\n\nMay we discuss the brief?'});await new Promise(r=>setTimeout(r,30));return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({subject:'제안 제목',body:'안녕하세요, 합성 크리에이터님!\n\n소개 자료에 대해 이야기 나눌 수 있을까요?'})}}]});};
 const service=reviewTranslationService(f.database,mock),source={subject:'Original title',body:'Hi SYNTHETIC creator!\n\nMay we discuss the brief?'};
 await assert.rejects(service.translate({...f.reader,role:'admin'},source),code('forbidden'));assert.equal(calls,0);
 const [one,two]=await Promise.all([service.translate(f.actor,source),service.translate(f.actor,source)]);assert.deepEqual(one,two);assert.equal(calls,1);
 assert.deepEqual(await service.translate(f.reader,source),one);assert.equal(calls,1);
 await assert.rejects(service.translate(f.other,source),code('not_configured'));assert.equal(calls,1);
 await assert.rejects(service.translate(f.reader,{...source,body:source.body+' Changed.'}),code('forbidden'));
 for(const name of ['outreach_drafts','outreach_browser_sends','contact_reply_attempts'])assert.equal((await f.client.query('select count(*)::int n from '+name)).rows[0].n,0);
 assert.equal((await f.client.query('select count(*)::int n from outreach_review_translations')).rows[0].n,1);
}));
test('translation failures are retryable, rate limited even on failure, and never cached as successful review',async()=>withDiscoveryDatabase(async f=>{
 await aiSettingsService(f.database,ok).save(f.actor,credentials);let invalid=true,calls=0;
 const service=reviewTranslationService(f.database,async()=>{calls++;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({subject:'',body:invalid?'English instead of Korean':'정상적인 한글 번역입니다.'})}}]});}),source={subject:'',body:'SYNTHETIC proposal'};
 await assert.rejects(service.translate(f.actor,source),code('translation_invalid'));invalid=false;await service.translate(f.actor,source);assert.equal(calls,2);
 await f.client.query("insert into audit_events(organization_id,actor_id,entity_id,action) select $1,$2,$1,'outreach.translation_requested' from generate_series(1,10)",[f.actor.organizationId,f.actor.userId]);
 await assert.rejects(service.translate(f.actor,{...source,body:source.body+' edited'}),code('translation_busy'));assert.equal(calls,2);
 assert.ok((await service.translate(f.actor,source)).body.includes('한글'));assert.equal(calls,2);
}));

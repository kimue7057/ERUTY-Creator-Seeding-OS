import test from 'node:test';import assert from 'node:assert/strict';
import {checkOpenRouter} from '../src/lib/outreach/openrouter';import {OutreachError} from '../src/lib/outreach/contracts';
import {starterCatalog,applyTemplate,hasPlaceholders} from '../src/lib/outreach/template-contracts';
const credentials={apiKey:'synthetic-openrouter-test-key',model:'openai/gpt-5.4-mini'};
test('OpenRouter uses a fixed origin, bearer auth, supported strict JSON routing and no tools or external sends',async()=>{
 const mock:typeof fetch=async(url,init)=>{assert.equal(String(url),'https://openrouter.ai/api/v1/chat/completions');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+credentials.apiKey);const body=JSON.parse(String(init?.body));assert.equal(body.model,credentials.model);assert.deepEqual(body.provider,{require_parameters:true});assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);assert.equal(body.tools,undefined);return Response.json({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]});};await checkOpenRouter(credentials,mock);
});
test('provider errors, refusals, truncated responses and malformed JSON never leak raw messages or become successful output',async()=>{
 for(const [status,code] of [[401,'ai_key_invalid'],[402,'ai_credit_required'],[403,'ai_access_denied'],[404,'ai_model_unavailable'],[429,'ai_rate_limited'],[502,'ai_provider_unavailable']] as const)await assert.rejects(checkOpenRouter(credentials,async()=>Response.json({error:{message:'never echo '+credentials.apiKey}},{status})),(e:unknown)=>e instanceof OutreachError&&e.code===code&&!e.message.includes(credentials.apiKey));
 for(const data of [{choices:[{finish_reason:'length',message:{content:'{"ok":true}'}}]},{choices:[{finish_reason:'stop',message:{content:'not json'}}]},{choices:[{finish_reason:'stop',message:{content:'{"ok":true}',refusal:'refused'}}]}])await assert.rejects(checkOpenRouter(credentials,async()=>Response.json(data)),(e:unknown)=>e instanceof OutreachError&&e.code==='ai_response_invalid');
});
test('email and DM starter sets cover both languages, keep short paragraphs and resolve only declared variables',()=>{
 assert.equal(starterCatalog.length,14);assert.equal(new Set(starterCatalog.map(t=>[t.channel,t.language,t.name].join(':'))).size,14);
 for(const language of ['한국어','English']){assert.equal(starterCatalog.filter(t=>t.channel==='email'&&t.language===language).length,4);assert.equal(starterCatalog.filter(t=>t.channel==='instagram'&&t.language===language).length,3);}
 for(const t of starterCatalog){const body=applyTemplate(t.body,{creator:'SYNTHETIC creator',brand:'SYNTHETIC product brand',campaign:'SYNTHETIC campaign',reason:'SYNTHETIC observed content fit'});assert.equal(hasPlaceholders(body),false);if(t.channel==='instagram'){assert.ok(body.length<=1000);assert.ok(body.split(/\n\s*\n/).length>=3);assert.equal(t.subject,'');}}
});

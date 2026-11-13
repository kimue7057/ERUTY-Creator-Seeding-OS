import test from 'node:test';import assert from 'node:assert/strict';
import {isEnglishMessage,reviewTranslationOutput,translationSourceKey} from '../src/lib/outreach/translation-contracts';
import {rawEmail,draftInputSchema} from '../src/lib/outreach/message';
test('review translation distinguishes English and Korean and binds subject, whitespace and exact body',()=>{
 assert.equal(isEnglishMessage('Hi creator!\n\nCan we share the brief?'),true);assert.equal(isEnglishMessage('안녕하세요. 협업 제안을 드립니다.'),false);assert.equal(isEnglishMessage('BEBEDORÉ 제품을 소개해 드리고 협업에 대해 말씀 나누고 싶습니다.'),false);
 assert.notEqual(translationSourceKey('A','Body'),translationSourceKey('B','Body'));assert.notEqual(translationSourceKey('','A\n\nB'),translationSourceKey('','A B'));
 assert.equal(reviewTranslationOutput.safeParse({subject:'',body:'English only'}).success,false);assert.equal(reviewTranslationOutput.safeParse({subject:'',body:'한글 번역입니다.'}).success,true);
});
test('internal translation cannot enter the outgoing email or the draft payload',()=>{
 const input={id:crypto.randomUUID(),campaignId:crypto.randomUUID(),creatorAccountId:crypto.randomUUID(),inputSha256:'a'.repeat(64),revision:0,channel:'email',subject:'Original title',body:'Original English\n\nMessage only.',template:'letter',senderAccountId:null,fromAddress:'company@example.invalid',toAddress:'creator@example.invalid',recipientSource:'https://example.invalid',koreanTranslation:{subject:'번역 제목',body:'번역 본문'}};
 const parsed=draftInputSchema.parse(input);assert.equal('koreanTranslation' in parsed,false);
 const mail=Buffer.from(rawEmail({...input,from:input.fromAddress,to:input.toAddress,template:'letter'}),'base64url').toString();
 const decoded=mail.split('Content-Transfer-Encoding: base64\r\n\r\n').slice(1).map(p=>Buffer.from(p.split('\r\n--')[0].replace(/\r\n/g,''),'base64').toString()).join('\n');assert.ok(decoded.includes(input.body));assert.ok(!decoded.includes('번역'));
});

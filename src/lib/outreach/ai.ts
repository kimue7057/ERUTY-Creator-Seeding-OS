import {z} from 'zod';
import {OutreachError} from './contracts';
import {providerJson} from './providers';
import type {EvaluationContext} from '../evaluation/service';
import type {EvaluationOutput} from '../evaluation/contracts';
import {openRouterJson} from './openrouter';
import {proposalInstructions,proposalOutput,validateProposal,type ProposalContext} from './proposal-contracts';
export const outreachApiReady=()=>process.env.OUTREACH_AI_ENABLED==='true'&&!!process.env.OPENAI_API_KEY&&!!process.env.OUTREACH_MODEL;
export const outreachAiReady=outreachApiReady;
export async function writeProposal(snapshot:EvaluationContext['snapshot'],assessment:EvaluationOutput,channel:string,language:string,purpose:string,fetcher:typeof fetch=fetch,credentials?:{apiKey:string;model:string}){
 if(!credentials&&!outreachApiReady())throw new OutreachError('not_configured');
 const context:ProposalContext={snapshot,assessment,channel:z.enum(['email','instagram']).parse(channel),language:z.enum(['한국어','English']).parse(language),purpose:z.string().trim().min(1).max(1500).parse(purpose)};
 const schema=z.toJSONSchema(proposalOutput);delete schema.$schema;
 if(credentials){try{return validateProposal(await openRouterJson(credentials,proposalInstructions,JSON.stringify({channel,language,purpose,creator:snapshot.creator,brand:snapshot.brief,assessment,evidence:snapshot.evidence.map(e=>({id:e.id,url:e.source_url,facts:e.facts,limitations:e.limitations}))}),schema,4000,fetcher),context);}catch(error){if(error instanceof OutreachError)throw error;throw new OutreachError('ai_response_invalid');}}
 const result=await providerJson('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OUTREACH_MODEL,store:false,max_output_tokens:4000,instructions:proposalInstructions,input:JSON.stringify({channel,language,purpose,creator:snapshot.creator,brand:snapshot.brief,assessment,evidence:snapshot.evidence.map(e=>({id:e.id,url:e.source_url,facts:e.facts,limitations:e.limitations}))}),text:{format:{type:'json_schema',name:'outreach_proposal',strict:true,schema}}})},fetcher);
 const response=z.object({status:z.literal('completed'),output:z.array(z.object({type:z.string(),content:z.array(z.object({type:z.string(),text:z.string().optional()})).optional()}))}).parse(result);
 try{return validateProposal(JSON.parse(response.output.flatMap(o=>o.content??[]).filter(c=>c.type==='output_text').map(c=>c.text).join('')),context);}catch{throw new OutreachError('provider_invalid');}
}

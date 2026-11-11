import {createHash,randomBytes} from "node:crypto";
import {and,desc,eq,gt,inArray,sql} from "drizzle-orm";
import {z} from "zod";
import {db} from "../db";
import {auditEvents} from "../db/schema";
import {senderAccounts as accounts,outreachDrafts as drafts,browserOutreachSends as jobs,instagramDmSends,browserOutreachExecutors as executors,chatPreviews} from "../db/outreach-schema";
import {discoveryWorkers as workers,discoveryExecutions} from "../db/worker-schema";
import {creatorAssessments} from "../db/assessment-schema";
import type {ActorScope} from "../auth/permissions";
import {outreachMember,type OutreachTx} from "./access";
import {normalizeIdentity,OutreachError} from "./contracts";
import {browserSendInput,browserLease,browserSendGrant,browserObservation,browserFinish,browserReview,browserReviewFinish,type BrowserSendGrant,type BrowserObservation} from "./browser-contracts";
import {hasPlaceholders} from "./template-contracts";
import {evaluationService} from "../evaluation/service";
import {assessmentFingerprint} from "../evaluation/shortlist-policy";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const active=["queued","preparing","armed","unknown"] as const;
const visible={id:jobs.id,accountId:jobs.accountId,draftId:jobs.draftId,senderUsername:jobs.senderUsername,recipientUsername:jobs.recipientUsername,body:jobs.body,state:jobs.state,reason:jobs.reason,createdAt:jobs.createdAt,sentAt:jobs.sentAt,armedAt:jobs.armedAt};
const eligible=(accountId?:string)=>sql`(not exists (select 1 from ${executors} e where e.worker_id=${workers.id}) or exists (select 1 from ${executors} e where e.worker_id=${workers.id} and e.status='connected' and e.expires_at>now() ${accountId?sql`and e.account_id=${accountId}::uuid`:sql``}))`;
export function browserSendService(database:Pick<typeof db,"transaction">=db){
  const scope=(actor:ActorScope,id:string)=>and(eq(jobs.organizationId,actor.organizationId),eq(jobs.id,z.uuid().parse(id)));
  const draftScope=(actor:ActorScope,id:string)=>and(eq(drafts.organizationId,actor.organizationId),eq(drafts.id,id));
  async function account(tx:OutreachTx,actor:ActorScope,id:string,allowDisconnected=false){
    await outreachMember(tx,actor,true);const [row]=await tx.select().from(accounts).where(and(eq(accounts.organizationId,actor.organizationId),eq(accounts.id,z.uuid().parse(id)))).for("update");
    if(!row||row.provider!=="instagram")throw new OutreachError("not_found");
    if(!allowDisconnected&&row.status==="disconnected"||!/^\w[\w.]{0,29}$/.test(row.expectedIdentity))throw new OutreachError("reconnect");return row;
  }
  async function approval(tx:OutreachTx,actor:ActorScope,row:{draftId:string|null;draftRevision:number|null;accountId:string;recipientUsername:string;senderUsername:string;body:string},sending:boolean){
    if(!row.draftId)return;
    const [draft]=await tx.select().from(drafts).where(draftScope(actor,row.draftId)).for("update");
    if(!draft||draft.revision!==row.draftRevision||draft.channel!=="instagram"||draft.senderAccountId!==row.accountId||draft.body.trim()!==row.body||normalizeIdentity(draft.fromAddress)!==row.senderUsername||draft.status!==(sending?"sending":"draft"))throw new OutreachError("draft_changed");
    const detail=await evaluationService(tx).detail(actor,draft.campaignId,draft.creatorAccountId);
    if(!detail.can_outreach||assessmentFingerprint(detail.snapshot)!==draft.inputSha256)throw new OutreachError("stale");
    if(detail.snapshot.creator.platform!=="instagram"||normalizeIdentity(detail.snapshot.creator.handle??"")!==row.recipientUsername)throw new OutreachError("instagram_dm_recipient_changed");
  }
  async function host(tx:OutreachTx,actor:ActorScope,input:z.infer<typeof browserLease>,fresh=true){
    await outreachMember(tx,actor,true);
    const [row]=await tx.select().from(workers).where(and(eq(workers.organizationId,actor.organizationId),eq(workers.userId,actor.userId),eq(workers.id,input.worker_id))).for("update");
    if(!row||row.instanceId!==input.instance_id||fresh&&(row.ready!=="ready"||row.outreachReady!=="yes"||!row.platforms.includes("instagram")||row.lastSeenAt.getTime()<Date.now()-45000))throw new OutreachError("browser_outreach_offline");
    const [connection]=await tx.select().from(executors).where(eq(executors.workerId,row.id));
    if(connection&&fresh&&(connection.status!=="connected"||!connection.expiresAt||connection.expiresAt.getTime()<=Date.now()))throw new OutreachError("browser_outreach_offline");
    return {...row,outreachAccountId:connection?.accountId};
  }
  async function claimed(tx:OutreachTx,actor:ActorScope,grant:BrowserSendGrant,fresh=true){
    const worker=await host(tx,actor,grant,fresh);
    const [found]=await tx.select().from(jobs).where(scope(actor,grant.job_id));if(!found||worker.outreachAccountId&&found.accountId!==worker.outreachAccountId)throw new OutreachError("not_found");
    const [sender]=await tx.select().from(accounts).where(and(eq(accounts.organizationId,actor.organizationId),eq(accounts.id,found.accountId))).for("update");
    if(!sender||fresh&&sender.status==="disconnected")throw new OutreachError("reconnect");
    const [row]=await tx.select().from(jobs).where(scope(actor,grant.job_id)).for("update");
    if(row.workerId!==grant.worker_id||row.instanceId!==grant.instance_id||row.claimHash!==hash(grant.claim_token)||!row.claimExpiresAt||fresh&&row.claimExpiresAt.getTime()<=Date.now())throw new OutreachError("browser_outreach_claim_expired");
    if(normalizeIdentity(sender.expectedIdentity)!==row.senderUsername)throw new OutreachError("connection_changed");return row;
  }
  function validateObservation(row:{senderUsername:string;recipientUsername:string;body:string},input:BrowserObservation){
    const data=browserObservation.parse(input),url=new URL(data.source_url),time=Date.parse(data.observed_at);
    const direct=/^\/direct\/(?:t\/[A-Za-z0-9_-]+\/?|(?:new|inbox)\/?)?$/.test(url.pathname),profile=normalizeIdentity(url.pathname.replace(/^\/|\/$/g,""))===row.recipientUsername;
    if(url.protocol!=="https:"||!["www.instagram.com","instagram.com"].includes(url.hostname)||url.username||url.password||url.port||!direct&&!profile||url.search||url.hash)throw new OutreachError("browser_outreach_observation_invalid");
    if(data.sender!==row.senderUsername||data.recipient!==row.recipientUsername||data.body!==row.body||time>Date.now()+30000||time<Date.now()-120000)throw new OutreachError("browser_outreach_observation_invalid");
    return data;
  }
  async function reviewable(tx:OutreachTx,actor:ActorScope,data:z.infer<typeof browserReview>){
    const worker=await host(tx,actor,data);if(!worker.outreachAccountId)throw new OutreachError("forbidden");
    const [found]=await tx.select().from(jobs).where(scope(actor,data.job_id));if(!found||found.accountId!==worker.outreachAccountId||found.workerId!==worker.id||found.instanceId!==worker.instanceId)throw new OutreachError("not_found");
    const sender=await account(tx,actor,found.accountId),[row]=await tx.select().from(jobs).where(scope(actor,data.job_id)).for("update");
    if(normalizeIdentity(sender.expectedIdentity)!==row.senderUsername)throw new OutreachError("connection_changed");
    if(!row.armedAt||row.state!=="unknown"&&!(row.state==="sent"&&row.reason==="confirmed_on_recheck"))throw new OutreachError("browser_outreach_pending");return row;
  }
  async function setDraft(tx:OutreachTx,actor:ActorScope,row:{draftId:string|null},status:"sending"|"sent"|"failed"|"unknown"){
    if(row.draftId)await tx.update(drafts).set({status,updatedAt:new Date(),updatedBy:actor.userId,...(status==="sent"?{sentAt:new Date()}: {})}).where(and(draftScope(actor,row.draftId),eq(drafts.status,"sending")));
  }
  const service={
    reviewContext:(actor:ActorScope,input:unknown)=>database.transaction(async tx=>{
      const data=browserReview.parse(input),row=await reviewable(tx,actor,data);return{id:row.id,state:row.state,sender:row.senderUsername,recipient:row.recipientUsername,recipient_url:`https://www.instagram.com/${row.recipientUsername}/`,body:row.body,send_permitted:false};
    }),
    reviewFinish:(actor:ActorScope,input:unknown)=>database.transaction(async tx=>{
      const data=browserReviewFinish.parse(input),row=await reviewable(tx,actor,data);if(row.state==="sent")return{state:row.state};
      if(!data.observation){if(data.ui_diagnostic)console.info(JSON.stringify({event:"outreach.executor_ui_blocked",jobId:row.id,diagnostic:data.ui_diagnostic}));return{state:"unknown" as const};}
      const observation=validateObservation(row,data.observation);
      if(Date.parse(observation.observed_at)<row.armedAt!.getTime()||!observation.visible_text.replace(/\s+/g," ").includes(row.body.replace(/\s+/g," ")))throw new OutreachError("browser_outreach_observation_invalid");
      await tx.update(jobs).set({state:"sent",reason:"confirmed_on_recheck",observation,observationSha256:hash(JSON.stringify(observation)),sentAt:new Date(),updatedAt:new Date()}).where(scope(actor,row.id));
      if(row.draftId)await tx.update(drafts).set({status:"sent",sentAt:new Date(),updatedAt:new Date(),updatedBy:actor.userId}).where(and(draftScope(actor,row.draftId),eq(drafts.status,"unknown"),eq(drafts.revision,row.draftRevision!)));
      await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:row.id,action:"outreach.browser_send_rechecked_sent"});return{state:"sent" as const};
    }),
    availability:(actor:ActorScope,accountId?:string)=>database.transaction(async tx=>{await outreachMember(tx,actor);if(accountId)z.uuid().parse(accountId);return tx.select({id:workers.id,name:workers.name,browserSurface:workers.browserSurface}).from(workers).where(and(eq(workers.organizationId,actor.organizationId),eq(workers.ready,"ready"),eq(workers.outreachReady,"yes"),gt(workers.lastSeenAt,new Date(Date.now()-45000)),sql`'instagram'=any(${workers.platforms})`,eligible(accountId))).limit(10);}),
    history:(actor:ActorScope,accountId?:string)=>database.transaction(async tx=>{await outreachMember(tx,actor);if(accountId)z.uuid().parse(accountId);return tx.select(visible).from(jobs).where(and(eq(jobs.organizationId,actor.organizationId),accountId?eq(jobs.accountId,accountId):undefined)).orderBy(desc(jobs.createdAt),desc(jobs.id)).limit(50);}),
    create:(actor:ActorScope,input:unknown)=>database.transaction(async tx=>{
      const data=browserSendInput.parse(input),sender=await account(tx,actor,data.accountId);
      if(hasPlaceholders(data.body)||data.recipient===sender.expectedIdentity)throw new OutreachError("browser_outreach_observation_invalid");
      const fingerprint=hash(JSON.stringify(data)),[old]=await tx.select(visible).from(jobs).where(scope(actor,data.id));
      if(old){const [stored]=await tx.select({hash:jobs.inputSha256}).from(jobs).where(scope(actor,data.id));if(stored.hash!==fingerprint)throw new OutreachError("instagram_dm_request_changed");return old;}
      const [online]=await tx.select({id:workers.id}).from(workers).where(and(eq(workers.organizationId,actor.organizationId),eq(workers.ready,"ready"),eq(workers.outreachReady,"yes"),gt(workers.lastSeenAt,new Date(Date.now()-45000)),sql`'instagram'=any(${workers.platforms})`,eligible(data.accountId))).limit(1);if(!online)throw new OutreachError("browser_outreach_offline");
      const [pending]=await tx.select({id:jobs.id}).from(jobs).where(and(eq(jobs.organizationId,actor.organizationId),eq(jobs.accountId,data.accountId),eq(jobs.recipientUsername,data.recipient),inArray(jobs.state,[...active])));
      const [apiPending]=await tx.select({id:instagramDmSends.id}).from(instagramDmSends).where(and(eq(instagramDmSends.organizationId,actor.organizationId),eq(instagramDmSends.accountId,data.accountId),sql`lower(${instagramDmSends.recipientUsername})=${data.recipient}`,inArray(instagramDmSends.status,["sending","unknown"])));
      if(pending||apiPending)throw new OutreachError("browser_outreach_pending");
      const values={id:data.id,organizationId:actor.organizationId,accountId:data.accountId,draftId:data.draftId,draftRevision:data.draftRevision,senderUsername:normalizeIdentity(sender.expectedIdentity),recipientUsername:data.recipient,body:data.body,inputSha256:fingerprint,createdBy:actor.userId};
      await approval(tx,actor,values,false);
      const [created]=await tx.insert(jobs).values(values).returning(visible);
      if(data.draftId)await tx.update(drafts).set({status:"sending",updatedAt:new Date(),updatedBy:actor.userId}).where(draftScope(actor,data.draftId));
      await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:data.id,action:"outreach.browser_send_confirmed"});return created;
    }),
    cancel:(actor:ActorScope,id:string)=>database.transaction(async tx=>{
      await outreachMember(tx,actor,true);const [found]=await tx.select().from(jobs).where(scope(actor,id));if(!found)throw new OutreachError("not_found");await account(tx,actor,found.accountId,true);
      const [row]=await tx.select().from(jobs).where(scope(actor,id)).for("update");if(!["queued","preparing"].includes(row.state))throw new OutreachError("browser_outreach_pending");
      await tx.update(jobs).set({state:"cancelled",updatedAt:new Date()}).where(scope(actor,id));await setDraft(tx,actor,row,"failed");
      await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:id,action:"outreach.browser_send_cancelled"});return{cancelled:true};
    }),
    next:(actor:ActorScope,input:unknown)=>database.transaction(async tx=>{
      const lease=browserLease.parse(input),worker=await host(tx,actor,lease);
      // A replacement Chrome profile also settles an old executor's crash.
      const [expired]=await tx.select().from(jobs).where(and(eq(jobs.organizationId,actor.organizationId),inArray(jobs.state,["preparing","armed"]),sql`${jobs.claimExpiresAt}<=now()`,worker.outreachAccountId?eq(jobs.accountId,worker.outreachAccountId):undefined)).orderBy(jobs.claimExpiresAt).limit(1);
      if(expired){await tx.select({id:accounts.id}).from(accounts).where(and(eq(accounts.organizationId,actor.organizationId),eq(accounts.id,expired.accountId))).for("update");const [stale]=await tx.select().from(jobs).where(scope(actor,expired.id)).for("update");if(["preparing","armed"].includes(stale.state)&&stale.claimExpiresAt&&stale.claimExpiresAt.getTime()<=Date.now()){const state=stale.state==="armed"?"unknown" as const:"blocked" as const;await tx.update(jobs).set({state,reason:"unconfirmed_result",updatedAt:new Date()}).where(scope(actor,stale.id));await setDraft(tx,actor,stale,state==="unknown"?"unknown":"failed");}return{assignment:null};}
      const [current]=await tx.select().from(jobs).where(and(eq(jobs.workerId,worker.id),inArray(jobs.state,["preparing","armed"])));
      if(current&&current.claimExpiresAt&&current.claimExpiresAt.getTime()<=Date.now()){
        await tx.select({id:accounts.id}).from(accounts).where(and(eq(accounts.organizationId,actor.organizationId),eq(accounts.id,current.accountId))).for("update");
        const [stale]=await tx.select().from(jobs).where(scope(actor,current.id)).for("update");
        if(["preparing","armed"].includes(stale.state)){const state=stale.state==="armed"?"unknown" as const:"blocked" as const;await tx.update(jobs).set({state,reason:"unconfirmed_result",updatedAt:new Date()}).where(scope(actor,stale.id));await setDraft(tx,actor,stale,state==="unknown"?"unknown":"failed");}
        return{assignment:null};
      }
      const [discovering]=await tx.select({id:discoveryExecutions.id}).from(discoveryExecutions).where(and(eq(discoveryExecutions.workerId,worker.id),inArray(discoveryExecutions.state,["starting","running"])));
      const [assessing]=await tx.select({id:creatorAssessments.id}).from(creatorAssessments).where(and(eq(creatorAssessments.workerId,worker.id),eq(creatorAssessments.state,"running")));
      const [preview]=await tx.select({id:chatPreviews.id}).from(chatPreviews).where(and(eq(chatPreviews.organizationId,actor.organizationId),eq(chatPreviews.workerId,worker.id),eq(chatPreviews.state,'running')));
      if(current||discovering||assessing||preview)return{assignment:null};
      const [found]=await tx.select().from(jobs).where(and(eq(jobs.organizationId,actor.organizationId),eq(jobs.state,"queued"),worker.outreachAccountId?eq(jobs.accountId,worker.outreachAccountId):undefined)).orderBy(jobs.createdAt,jobs.id).limit(1);if(!found)return{assignment:null};
      const sender=await account(tx,actor,found.accountId,true);const [row]=await tx.select().from(jobs).where(scope(actor,found.id)).for("update");if(row.state!=="queued")return{assignment:null};
      if(sender.status==="disconnected"||normalizeIdentity(sender.expectedIdentity)!==row.senderUsername){await tx.update(jobs).set({state:"blocked",reason:"sender_mismatch",updatedAt:new Date()}).where(scope(actor,row.id));await setDraft(tx,actor,row,"failed");return{assignment:null};}
      if(row.createdAt.getTime()<Date.now()-3600000){await tx.update(jobs).set({state:"blocked",reason:"unconfirmed_result",updatedAt:new Date()}).where(scope(actor,row.id));await setDraft(tx,actor,row,"failed");return{assignment:null};}
      const token=randomBytes(32).toString("hex");await tx.update(jobs).set({state:"preparing",workerId:worker.id,instanceId:worker.instanceId,claimHash:hash(token),claimExpiresAt:new Date(Date.now()+600000),updatedAt:new Date()}).where(scope(actor,row.id));
      return{assignment:{job_id:row.id,worker_id:worker.id,instance_id:worker.instanceId,claim_token:token}};
    }),
    context:(actor:ActorScope,input:unknown)=>database.transaction(async tx=>{
      const grant=browserSendGrant.parse(input),row=await claimed(tx,actor,grant,false);
      return{id:row.id,state:row.state,reason:row.reason,sender:row.senderUsername,recipient:row.recipientUsername,recipient_url:`https://www.instagram.com/${row.recipientUsername}/`,body:row.body,expires_at:row.claimExpiresAt!.toISOString(),send_permitted:false};
    }),
    arm:(actor:ActorScope,input:unknown)=>database.transaction(async tx=>{
      const data=browserSendGrant.extend({observation:browserObservation}).parse(input),row=await claimed(tx,actor,data);
      if(row.state!=="preparing")throw new OutreachError("browser_outreach_pending");await approval(tx,actor,row,true);validateObservation(row,data.observation);
      const armedAt=new Date();await tx.update(jobs).set({state:"armed",armedAt,updatedAt:armedAt}).where(scope(actor,row.id));
      await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:row.id,action:"outreach.browser_send_armed"});
      return{send_permitted:true,job_id:row.id,body_sha256:hash(row.body),expires_at:new Date(armedAt.getTime()+120000).toISOString()};
    }),
    finish:(actor:ActorScope,input:unknown)=>database.transaction(async tx=>{
      const data=browserFinish.parse(input),row=await claimed(tx,actor,data,false);
      if(["sent","blocked","unknown","cancelled"].includes(row.state))return{state:row.state};
      if(row.state!=="preparing"&&row.state!=="armed")throw new OutreachError("browser_outreach_claim_expired");
      const sent=data.outcome==="sent"&&row.state==="armed"&&data.reason==="confirmed_on_screen"&&data.observation;
      if(data.outcome==="sent"&&!sent)throw new OutreachError("browser_outreach_observation_invalid");
      const observation=sent?validateObservation(row,data.observation!):null,state=sent?"sent" as const:row.state==="armed"?"unknown" as const:"blocked" as const;
      if(observation&&(Date.parse(observation.observed_at)<row.armedAt!.getTime()||!observation.visible_text.replace(/\s+/g," ").includes(row.body.replace(/\s+/g," "))))throw new OutreachError("browser_outreach_observation_invalid");
      await tx.update(jobs).set({state,reason:data.reason,observation,observationSha256:observation?hash(JSON.stringify(observation)):null,sentAt:sent?new Date():null,updatedAt:new Date()}).where(scope(actor,row.id));
      await setDraft(tx,actor,row,state==="sent"?"sent":state==="unknown"?"unknown":"failed");
      if(data.ui_diagnostic&&state!=="sent"){console.info(JSON.stringify({event:"outreach.executor_ui_blocked",jobId:row.id,diagnostic:data.ui_diagnostic}));await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:row.id,action:`outreach.browser_ui_blocked.${data.ui_diagnostic.stage}`});}
      await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:row.id,action:`outreach.browser_send_${state}`});return{state};
    }),
  };return service;
}

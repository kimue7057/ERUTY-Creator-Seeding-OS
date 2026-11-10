import {createHash,randomBytes,randomUUID} from "node:crypto";
import {and,desc,eq,gt} from "drizzle-orm";
import {z} from "zod";
import {db} from "../db";
import {memberships,auditEvents} from "../db/schema";
import {browserOutreachExecutors as executors,senderAccounts,browserOutreachSends,outreachDrafts} from "../db/outreach-schema";
import {discoveryWorkers as workers} from "../db/worker-schema";
import {outreachMember} from "./access";
import type {ActorScope} from "../auth/permissions";
import {OutreachError,normalizeIdentity} from "./contracts";
import {outreachExtensionId,executorHeartbeat,executorPairInput} from "./executor-contracts";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
type ExecutorIdentity={actor:ActorScope;lease:{worker_id:string;instance_id:string};id:string;accountId:string};
export function outreachExecutorService(database:Pick<typeof db,"transaction">=db){
  const service={
    list:(actor:ActorScope)=>database.transaction(async tx=>{await outreachMember(tx,actor);return tx.select({id:executors.id,accountId:executors.accountId,name:executors.name,status:executors.status,observedUsername:executors.observedUsername,lastReason:executors.lastReason,lastSeenAt:executors.lastSeenAt,expiresAt:executors.expiresAt}).from(executors).where(eq(executors.organizationId,actor.organizationId)).orderBy(desc(executors.createdAt)).limit(30);}),
    startPair:(actor:ActorScope,input:unknown)=>database.transaction(async tx=>{
      const data=z.strictObject({accountId:z.uuid(),name:z.string().trim().min(1).max(60),confirmed:z.literal(true)}).parse(input);await outreachMember(tx,actor,true,true);
      const [account]=await tx.select().from(senderAccounts).where(and(eq(senderAccounts.organizationId,actor.organizationId),eq(senderAccounts.id,data.accountId))).for("update");
      if(!account||account.provider!=="instagram"||account.status==="disconnected")throw new OutreachError("not_found");
      const id=randomUUID(),workerId=randomUUID(),instanceId=randomUUID(),code=randomBytes(32).toString("hex"),expires=new Date(Date.now()+300000);
      await tx.insert(workers).values({id:workerId,instanceId,organizationId:actor.organizationId,userId:actor.userId,name:data.name,browserSurface:"chrome",platforms:["instagram"],ready:"unavailable",outreachReady:"no"});
      await tx.insert(executors).values({id,organizationId:actor.organizationId,userId:actor.userId,accountId:account.id,workerId,instanceId,name:data.name,extensionId:outreachExtensionId,pairHash:hash(code),pairExpiresAt:expires});
      await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:id,action:"outreach.executor_pair_requested"});
      return {code,extension_id:outreachExtensionId,expires_at:expires.toISOString(),sender:account.expectedIdentity};
    }),
    pair:(input:unknown)=>database.transaction(async tx=>{
      const data=executorPairInput.parse(input),[row]=await tx.select().from(executors).where(and(eq(executors.pairHash,hash(data.code)),eq(executors.status,"pairing"),gt(executors.pairExpiresAt,new Date()))).for("update");
      if(!row)throw new OutreachError("forbidden");const [member]=await tx.select().from(memberships).where(and(eq(memberships.organizationId,row.organizationId),eq(memberships.userId,row.userId)));
      if(!member||member.role!=="admin")throw new OutreachError("forbidden");
      const [account]=await tx.select().from(senderAccounts).where(and(eq(senderAccounts.organizationId,row.organizationId),eq(senderAccounts.id,row.accountId)));if(!account||account.status==="disconnected")throw new OutreachError("reconnect");
      const token=randomBytes(32).toString("hex"),expires=new Date(Date.now()+30*86400000);
      await tx.update(executors).set({status:"connected",pairHash:null,tokenHash:hash(token),expiresAt:expires,updatedAt:new Date()}).where(eq(executors.id,row.id));
      await tx.insert(auditEvents).values({organizationId:row.organizationId,actorId:row.userId,entityId:row.id,action:"outreach.executor_paired"});
      return {token,expires_at:expires.toISOString(),worker_id:row.workerId,instance_id:row.instanceId,sender:normalizeIdentity(account.expectedIdentity),account_id:row.accountId};
    }),
    authenticate:(token:string)=>database.transaction(async tx=>{
      if(!/^[a-f0-9]{64}$/.test(token))throw new OutreachError("forbidden");
      const [row]=await tx.select().from(executors).where(and(eq(executors.tokenHash,hash(token)),eq(executors.status,"connected"),gt(executors.expiresAt,new Date())));if(!row)throw new OutreachError("forbidden");
      const [member]=await tx.select().from(memberships).where(and(eq(memberships.organizationId,row.organizationId),eq(memberships.userId,row.userId)));if(!member||member.role==="reviewer")throw new OutreachError("forbidden");
      return{actor:{organizationId:row.organizationId,userId:row.userId,role:member.role} as ActorScope,lease:{worker_id:row.workerId,instance_id:row.instanceId},id:row.id,accountId:row.accountId};
    }),
    heartbeat:(identity:ExecutorIdentity,input:unknown)=>database.transaction(async tx=>{
      const data=executorHeartbeat.parse(input);await outreachMember(tx,identity.actor,true);
      const [connection]=await tx.select().from(executors).where(and(eq(executors.id,identity.id),eq(executors.status,"connected"),gt(executors.expiresAt,new Date()))).for("update");if(!connection)throw new OutreachError("forbidden");
      const [account]=await tx.select().from(senderAccounts).where(and(eq(senderAccounts.organizationId,identity.actor.organizationId),eq(senderAccounts.id,connection.accountId)));
      const ready=!!account&&account.status!=="disconnected"&&data.reason==="ready"&&data.observed_username===normalizeIdentity(account.expectedIdentity);
      const reason=ready?"ready":data.reason==="ready"?"sender_mismatch":data.reason,now=new Date();
      await tx.update(executors).set({observedUsername:data.observed_username,lastReason:reason,lastSeenAt:now,updatedAt:now}).where(eq(executors.id,connection.id));
      await tx.update(workers).set({ready:ready?"ready":"unavailable",outreachReady:ready?"yes":"no",lastSeenAt:now}).where(eq(workers.id,connection.workerId));return{ready,reason};
    }),
    revoke:(actor:ActorScope,id:string,self=false)=>database.transaction(async tx=>{
      await outreachMember(tx,actor,true,!self);const [row]=await tx.update(executors).set({status:"revoked",revokedAt:new Date(),updatedAt:new Date()}).where(and(eq(executors.organizationId,actor.organizationId),eq(executors.id,z.uuid().parse(id)),self?eq(executors.userId,actor.userId):undefined)).returning({id:executors.id,workerId:executors.workerId});if(!row)throw new OutreachError("not_found");
      const pending=await tx.select().from(browserOutreachSends).where(and(eq(browserOutreachSends.organizationId,actor.organizationId),eq(browserOutreachSends.workerId,row.workerId))).for("update");
      for(const job of pending.filter(j=>["preparing","armed"].includes(j.state))){const state=job.state==="armed"?"unknown" as const:"blocked" as const;await tx.update(browserOutreachSends).set({state,reason:"unconfirmed_result",updatedAt:new Date()}).where(eq(browserOutreachSends.id,job.id));if(job.draftId)await tx.update(outreachDrafts).set({status:state==="unknown"?"unknown":"failed",updatedAt:new Date(),updatedBy:actor.userId}).where(and(eq(outreachDrafts.organizationId,actor.organizationId),eq(outreachDrafts.id,job.draftId),eq(outreachDrafts.status,"sending")));}
      await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:id,action:"outreach.executor_revoked"});return{revoked:true};
    }),
  };return service;
}

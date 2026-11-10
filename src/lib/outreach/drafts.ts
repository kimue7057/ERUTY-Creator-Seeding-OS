import { and, desc, eq, ilike, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { outreachDrafts as drafts } from "../db/outreach-schema";
import { auditEvents, campaigns } from "../db/schema";
import { creatorAccounts } from "../db/discovery-schema";
import type { ActorScope } from "../auth/permissions";
import { evaluationService } from "../evaluation/service";
import { assessmentFingerprint } from "../evaluation/shortlist-policy";
import { accountService, outreachMember } from "./accounts";
import { OutreachError } from "./contracts";
import { draftInputSchema,rawEmail } from "./message";
import { fetchIdentity } from "./providers";
import { hasPlaceholders } from "./template-contracts";
export function draftService(database:Pick<typeof db,"transaction">=db,fetcher:typeof fetch=fetch) {
  const scope=(actor:ActorScope,id:string)=>and(eq(drafts.organizationId,actor.organizationId),eq(drafts.id,z.uuid().parse(id)));
  async function approved(actor:ActorScope,campaignId:string,creatorId:string,hash?:string,store:Pick<typeof db,"transaction">=database) {
    const detail=await evaluationService(store).detail(actor,campaignId,creatorId);
    if(!detail.can_outreach||hash&&assessmentFingerprint(detail.snapshot)!==hash) throw new OutreachError("stale");
    return detail;
  }
  return {
    workspace:(actor:ActorScope,filter:{status?:string;channel?:string;search?:string;page?:number}={})=>database.transaction(async tx=>{
      await outreachMember(tx,actor);
      const status=z.enum(["draft","sent","failed","unknown","sending"]).safeParse(filter.status),channel=z.enum(["email","instagram","tiktok"]).safeParse(filter.channel);
      const search=(filter.search??"").slice(0,150).replace(/[\\%_]/g,"\\$&"),page=z.number().int().min(1).max(10000).parse(filter.page??1);
      return tx.select({id:drafts.id,campaignId:drafts.campaignId,creatorAccountId:drafts.creatorAccountId,subject:drafts.subject,channel:drafts.channel,status:drafts.status,fromAddress:drafts.fromAddress,toAddress:drafts.toAddress,updatedAt:drafts.updatedAt,creatorName:creatorAccounts.displayName,handle:creatorAccounts.currentHandle,platform:creatorAccounts.platform,campaignTitle:campaigns.title}).from(drafts)
        .innerJoin(campaigns,and(eq(campaigns.id,drafts.campaignId),eq(campaigns.organizationId,actor.organizationId)))
        .innerJoin(creatorAccounts,and(eq(creatorAccounts.id,drafts.creatorAccountId),eq(creatorAccounts.organizationId,actor.organizationId)))
        .where(and(eq(drafts.organizationId,actor.organizationId),status.success?eq(drafts.status,status.data):undefined,channel.success?eq(drafts.channel,channel.data):undefined,search?or(ilike(drafts.subject,`%${search}%`),ilike(creatorAccounts.displayName,`%${search}%`),ilike(creatorAccounts.currentHandle,`%${search}%`),ilike(campaigns.title,`%${search}%`)):undefined))
        .orderBy(desc(drafts.updatedAt),desc(drafts.id)).limit(26).offset((page-1)*25);
    }),
    duplicate:(actor:ActorScope,id:string)=>database.transaction(async tx=>{
      await outreachMember(tx,actor,true);
      const [source]=await tx.select().from(drafts).where(scope(actor,id)).for("share");
      if(!source)throw new OutreachError("not_found");
      if(["sending","unknown"].includes(source.status))throw new OutreachError("send_unknown");
      await approved(actor,source.campaignId,source.creatorAccountId,source.inputSha256,tx);
      const data=draftInputSchema.parse({...source,id:randomUUID(),revision:0,senderAccountId:null,fromAddress:""});
      const [row]=await tx.insert(drafts).values({...data,revision:1,organizationId:actor.organizationId,createdBy:actor.userId,updatedBy:actor.userId}).returning();
      await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:row.id,action:"outreach.draft_copied"});
      return row;
    }),
    get:(actor:ActorScope,id:string)=>database.transaction(async tx=>{await outreachMember(tx,actor);const [row]=await tx.select().from(drafts).where(scope(actor,id));return row??null;}),
    list:(actor:ActorScope,campaignId:string,creatorId:string)=>database.transaction(async tx=>{await outreachMember(tx,actor);z.uuid().parse(campaignId);z.uuid().parse(creatorId);return tx.select().from(drafts).where(and(eq(drafts.organizationId,actor.organizationId),eq(drafts.campaignId,campaignId),eq(drafts.creatorAccountId,creatorId))).orderBy(desc(drafts.createdAt),desc(drafts.id)).limit(30);}),
    save:(actor:ActorScope,input:unknown)=>database.transaction(async tx=>{
      await outreachMember(tx,actor,true);const data=draftInputSchema.parse(input);
      await approved(actor,data.campaignId,data.creatorAccountId,data.inputSha256,tx);
      if(data.senderAccountId) {
        const accounts=await accountService(tx).list(actor),account=accounts.find(a=>a.id===data.senderAccountId);
        if(!account||account.provider!==(data.channel==="email"?"google":data.channel)||data.fromAddress&&!account.addresses.some(a=>a.address===data.fromAddress))throw new OutreachError("reconnect");
      } else if(data.fromAddress) throw new OutreachError("reconnect");
      const {revision,...values}=data;
      if(revision===0){
        const [created]=await tx.insert(drafts).values({...values,organizationId:actor.organizationId,createdBy:actor.userId,updatedBy:actor.userId}).onConflictDoNothing().returning();
        if(!created)throw new OutreachError("draft_changed");return created;
      }
      const [saved]=await tx.update(drafts).set({...values,revision:revision+1,updatedAt:new Date(),updatedBy:actor.userId}).where(and(scope(actor,data.id),eq(drafts.campaignId,data.campaignId),eq(drafts.creatorAccountId,data.creatorAccountId),eq(drafts.revision,revision),eq(drafts.status,"draft"))).returning();
      if(!saved)throw new OutreachError("draft_changed");return saved;
    }),
    send:async(actor:ActorScope,id:string,revision:number,confirmed:boolean)=>{
      z.number().int().positive().parse(revision); if(confirmed!==true)throw new OutreachError("recipient_required");
      // Commit the attempt before external IO. An ambiguous/crashed send is never
      // automatically retried; the same draft cannot generate another delivery.
      const claimed=await database.transaction(async tx=>{
        await outreachMember(tx,actor,true);
        const [row]=await tx.select().from(drafts).where(scope(actor,id)).for("update");
        if(!row||row.revision!==revision)throw new OutreachError("draft_changed");
        if(row.status==="sent")return row;
        if(row.status!=="draft")throw new OutreachError(row.status==="sending"||row.status==="unknown"?"send_unknown":"draft_changed");
        await approved(actor,row.campaignId,row.creatorAccountId,row.inputSha256,tx);
        if(row.channel!=="email")throw new OutreachError("social_unavailable");
        if(!row.senderAccountId||!row.body.trim()||!row.subject.trim())throw new OutreachError("recipient_required");
        if(hasPlaceholders(row.subject+row.body+row.branding.signature))throw new OutreachError("placeholders_remaining");
        z.email().parse(row.toAddress);z.email().parse(row.fromAddress);const source=new URL(row.recipientSource);
        if(source.protocol!=="https:"||source.username||source.password)throw new OutreachError("recipient_required");
        const [claim]=await tx.update(drafts).set({status:"sending",updatedAt:new Date(),updatedBy:actor.userId}).where(scope(actor,id)).returning();
        await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:id,action:"outreach.send_confirmed"});
        return claim;
      });
      if(claimed.status==="sent")return claimed;
      let submitted=false;
      try {return await database.transaction(async tx=>{
        await outreachMember(tx,actor,true);
        await approved(actor,claimed.campaignId,claimed.creatorAccountId,claimed.inputSha256,tx);
        const {row:account,token}=await accountService(database,fetcher).credentials(tx,actor,claimed.senderAccountId!);
        if(account.provider!=="google")throw new OutreachError("reconnect");
        const verified=await fetchIdentity("google",token,fetcher);
        if(verified.id!==account.providerId||!verified.addresses.some(a=>a.address===claimed.fromAddress))throw new OutreachError("reconnect");
        const raw=rawEmail({id,from:claimed.fromAddress,to:claimed.toAddress,subject:claimed.subject,body:claimed.body,template:claimed.template,branding:claimed.branding});
        submitted=true;
        const response=await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{Authorization:`Bearer ${token.accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({raw}),redirect:"error",signal:AbortSignal.timeout(20000)});
        if(!response.ok){await response.body?.cancel();if([400,401,403,404,429].includes(response.status)){submitted=false;throw new OutreachError("send_failed");}throw new OutreachError("send_unknown");}
        const result=z.object({id:z.string().min(1).max(200)}).parse(await response.json());
        const [saved]=await tx.update(drafts).set({status:"sent",providerMessageId:result.id,sentAt:new Date(),updatedAt:new Date()}).where(scope(actor,id)).returning();
        await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:id,action:"outreach.sent"});return saved;
      });}catch(error){
        await database.transaction(async tx=>{await outreachMember(tx,actor,true);await tx.update(drafts).set({status:submitted?"unknown":"failed",updatedAt:new Date()}).where(and(scope(actor,id),eq(drafts.status,"sending")));}).catch(()=>{});
        if(submitted)throw new OutreachError("send_unknown");throw error;
      }
    },
  };
}

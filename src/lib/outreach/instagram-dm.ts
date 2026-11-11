import { createHash } from "node:crypto";
import { and,desc,eq,inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { instagramDmSends as sends,outreachDrafts as drafts,browserOutreachSends } from "../db/outreach-schema";
import { auditEvents } from "../db/schema";
import type { ActorScope } from "../auth/permissions";
import { accountService,outreachMember } from "./accounts";
import type { OutreachTx } from "./access";
import { normalizeIdentity,OutreachError } from "./contracts";
import { fetchIdentity } from "./providers";
import { instagramDmProvider,InstagramDmError,InstagramDmSendError } from "./instagram-dm-provider";
import { assertDmWindow,dmSelectionSchema,instagramReplySchema } from "./instagram-dm-contracts";
import { evaluationService } from "../evaluation/service";
import { assessmentFingerprint } from "../evaluation/shortlist-policy";
import { hasPlaceholders } from "./template-contracts";

// Bound a complete operation as well as each individual provider request.
function boundedFetch(fetcher:typeof fetch):typeof fetch {
  const deadline=AbortSignal.timeout(45000);
  return (url,init)=>fetcher(url,{...init,signal:init?.signal?AbortSignal.any([deadline,init.signal]):deadline});
}
export function instagramDmService(database:Pick<typeof db,"transaction">=db,fetcher:typeof fetch=fetch){
  const scope=(actor:ActorScope,id:string)=>and(eq(sends.organizationId,actor.organizationId),eq(sends.id,id));
  const draftScope=(actor:ActorScope,id:string)=>and(eq(drafts.organizationId,actor.organizationId),eq(drafts.id,id));
  async function context(tx:OutreachTx,actor:ActorScope,accountId:string,net:typeof fetch){
    const {row,token,config}=await accountService(database,net).credentials(tx,actor,z.uuid().parse(accountId));
    if(row.provider!=="instagram"||config.instagramLoginMode!=="unified"||!config.secret||!config.version)throw new OutreachError("instagram_dm_mode_required");
    const verified=await fetchIdentity("instagram",token,net,config);
    if(verified.id!==row.providerId||normalizeIdentity(verified.identity)!==normalizeIdentity(row.expectedIdentity))throw new OutreachError("reconnect");
    if(!verified.tokens.scopes.includes("instagram_manage_messages"))throw new OutreachError("instagram_dm_access_required");
    return{row,provider:instagramDmProvider({id:verified.id,username:verified.identity,accessToken:token.accessToken,secret:config.secret,version:config.version},net)};
  }
  async function approvedDraft(tx:OutreachTx,actor:ActorScope,data:z.infer<typeof instagramReplySchema>,sending=false){
    if(!data.draftId)return;
    const [draft]=await tx.select().from(drafts).where(draftScope(actor,data.draftId)).for("update");
    if(!draft||draft.revision!==data.draftRevision||draft.status!==(sending?"sending":"draft")||draft.channel!=="instagram"||draft.senderAccountId!==data.accountId||draft.body.trim()!==data.body||draft.instagramConversation?.conversationId!==data.selection.conversationId||draft.instagramConversation?.recipientId!==data.selection.recipientId||draft.instagramConversation?.username!==data.selection.username)throw new OutreachError("draft_changed");
    const detail=await evaluationService(tx).detail(actor,draft.campaignId,draft.creatorAccountId);
    if(!detail.can_outreach||assessmentFingerprint(detail.snapshot)!==draft.inputSha256)throw new OutreachError("stale");
    if(detail.snapshot.creator.platform!=="instagram"||normalizeIdentity(detail.snapshot.creator.handle??"")!==normalizeIdentity(data.selection.username))throw new OutreachError("instagram_dm_recipient_changed");
  }
  const service={
    history:(actor:ActorScope,accountId?:string)=>database.transaction(async tx=>{
      await outreachMember(tx,actor);if(accountId)z.uuid().parse(accountId);
      return tx.select().from(sends).where(and(eq(sends.organizationId,actor.organizationId),accountId?eq(sends.accountId,accountId):undefined)).orderBy(desc(sends.createdAt),desc(sends.id)).limit(50);
    }),
    list:(actor:ActorScope,accountId:string,after?:string)=>database.transaction(async tx=>{
      const net=boundedFetch(fetcher);if(after)z.string().min(1).max(4096).parse(after);
      const {provider}=await context(tx,actor,accountId,net);return provider.list(after);
    }),
    thread:(actor:ActorScope,accountId:string,input:unknown)=>database.transaction(async tx=>{
      const {provider}=await context(tx,actor,accountId,boundedFetch(fetcher));return provider.thread(dmSelectionSchema.parse(input));
    }),
    send:async(actor:ActorScope,input:unknown)=>{
      const data=instagramReplySchema.parse(input),net=boundedFetch(fetcher);
      if(hasPlaceholders(data.body))throw new OutreachError("placeholders_remaining");
      const hash=createHash("sha256").update(JSON.stringify(data)).digest("hex");
      const claimed=await database.transaction(async tx=>{
        // A sender lock serializes competing sends, disconnects and token changes.
        const {row,provider}=await context(tx,actor,data.accountId,net);
        const [existing]=await tx.select().from(sends).where(scope(actor,data.id));
        if(existing){if(existing.inputSha256!==hash)throw new OutreachError("instagram_dm_request_changed");if(existing.status==="sent")return existing;throw new OutreachError(existing.status==="failed"?"instagram_dm_send_rejected":"instagram_dm_send_unknown");}
        const [pending]=await tx.select({id:sends.id}).from(sends).where(and(eq(sends.organizationId,actor.organizationId),eq(sends.accountId,data.accountId),eq(sends.conversationId,data.selection.conversationId),inArray(sends.status,["sending","unknown"])));
        if(pending)throw new OutreachError("instagram_dm_send_unknown");
        const [browserPending]=await tx.select({id:browserOutreachSends.id}).from(browserOutreachSends).where(and(eq(browserOutreachSends.organizationId,actor.organizationId),eq(browserOutreachSends.accountId,data.accountId),eq(browserOutreachSends.recipientUsername,normalizeIdentity(data.selection.username)),inArray(browserOutreachSends.state,["queued","preparing","armed","unknown"])));
        if(browserPending)throw new OutreachError("browser_outreach_pending");
        await approvedDraft(tx,actor,data);
        if(data.draftId){const [d]=await tx.select().from(drafts).where(draftScope(actor,data.draftId));if(!row.addresses.some(a=>a.address===d.fromAddress))throw new OutreachError("reconnect");}
        const thread=await provider.thread(data.selection);assertDmWindow(thread.lastIncomingAt);if(data.expectedLastMessageId&&thread.messages.at(-1)?.id!==data.expectedLastMessageId)throw new OutreachError("contact_changed");
        const [claim]=await tx.insert(sends).values({id:data.id,organizationId:actor.organizationId,accountId:row.id,draftId:data.draftId,conversationId:data.selection.conversationId,senderProviderId:row.providerId!,fromUsername:row.identity!,recipientId:data.selection.recipientId,recipientUsername:data.selection.username,body:data.body,inputSha256:hash,createdBy:actor.userId}).returning();
        if(data.draftId)await tx.update(drafts).set({status:"sending",updatedAt:new Date(),updatedBy:actor.userId}).where(draftScope(actor,data.draftId));
        await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:data.id,action:"outreach.instagram_dm_confirmed"});return claim;
      });
      if(claimed.status==="sent")return claimed;
      let submitted=false;
      try{return await database.transaction(async tx=>{
        const {row,provider}=await context(tx,actor,data.accountId,net);
        if(row.providerId!==claimed.senderProviderId||normalizeIdentity(row.identity??"")!==normalizeIdentity(claimed.fromUsername))throw new OutreachError("reconnect");
        await approvedDraft(tx,actor,data,true);
        const thread=await provider.thread(data.selection);assertDmWindow(thread.lastIncomingAt);if(data.expectedLastMessageId&&thread.messages.at(-1)?.id!==data.expectedLastMessageId)throw new OutreachError("contact_changed");
        submitted=true;
        const providerMessageId=await provider.send(data.selection.recipientId,data.body);
        const sentAt=new Date();const [saved]=await tx.update(sends).set({status:"sent",providerMessageId,sentAt,updatedAt:sentAt}).where(and(scope(actor,data.id),eq(sends.status,"sending"))).returning();
        if(data.draftId)await tx.update(drafts).set({status:"sent",providerMessageId,sentAt,updatedAt:sentAt}).where(draftScope(actor,data.draftId));
        await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:data.id,action:"outreach.instagram_dm_sent"});return saved;
      });}catch(error){
        if(error instanceof InstagramDmSendError&&!error.ambiguous)submitted=false;
        const uncertain=submitted,status=uncertain?"unknown" as const:"failed" as const;
        // If persistence itself fails, the already committed 'sending' receipt
        // remains a barrier to a second request, including a different request ID.
        await database.transaction(async tx=>{
          await outreachMember(tx,actor,true);
          await tx.update(sends).set({status,errorCode:uncertain?"instagram_dm_send_unknown":error instanceof OutreachError?error.code:"provider_unavailable",graphCode:error instanceof InstagramDmError?error.diagnostic.graphCode:null,graphSubcode:error instanceof InstagramDmError?error.diagnostic.graphSubcode:null,updatedAt:new Date()}).where(and(scope(actor,data.id),eq(sends.status,"sending")));
          if(data.draftId)await tx.update(drafts).set({status,updatedAt:new Date()}).where(and(draftScope(actor,data.draftId),eq(drafts.status,"sending")));
          await tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:data.id,action:uncertain?"outreach.instagram_dm_unknown":"outreach.instagram_dm_failed"});
        }).catch(()=>{});
        if(uncertain)throw new OutreachError("instagram_dm_send_unknown");throw error;
      }
    },
    sendDraft:async(actor:ActorScope,id:string,revision:number,confirmed:boolean)=>{
      const row=await database.transaction(async tx=>{await outreachMember(tx,actor,true);const [r]=await tx.select().from(drafts).where(draftScope(actor,z.uuid().parse(id)));return r;});
      if(!row||row.revision!==revision||!row.senderAccountId||!row.instagramConversation)throw new OutreachError("draft_changed");
      if(row.status==="sent")return row;
      await service.send(actor,{id:row.id,accountId:row.senderAccountId,selection:row.instagramConversation,body:row.body,confirmed,draftId:row.id,draftRevision:revision});
      return database.transaction(async tx=>{await outreachMember(tx,actor);const [saved]=await tx.select().from(drafts).where(draftScope(actor,id));return saved;});
    },
  };return service;
}

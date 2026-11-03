import { randomBytes } from "node:crypto";
import { and, eq, desc, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { auditEvents } from "../db/schema";
import { senderAccounts as accounts, senderOAuthStates as states } from "../db/outreach-schema";
import type { ActorScope } from "../auth/permissions";
import { hashSecret, seal, unseal } from "./crypto";
import { normalizeIdentity, OutreachError, registerAccountSchema, type SenderProvider } from "./contracts";
import { authorizationUrl, exchangeCode, fetchIdentity, matchesExpected, providerConfig, refreshTokens, type ProviderTokens } from "./providers";
import { resolveProviderConfig } from "./provider-apps";
import { outreachMember } from "./access";
export { outreachMember } from "./access";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const publicAccountColumns = { id:accounts.id,provider:accounts.provider,label:accounts.label,expectedIdentity:accounts.expectedIdentity,identity:accounts.identity,addresses:accounts.addresses,status:accounts.status,verifiedAt:accounts.verifiedAt,expiresAt:accounts.expiresAt };
export function accountService(database: Pick<typeof db,"transaction"> = db, fetcher: typeof fetch = fetch) {
  const scoped = (actor: ActorScope, id: string) => and(eq(accounts.organizationId,actor.organizationId),eq(accounts.id,z.uuid().parse(id)));
  const context = (org: string,id: string) => `${org}:${id}:sender-token`;
  const audit = (tx:Tx,actor:ActorScope,id:string,action:string) => tx.insert(auditEvents).values({organizationId:actor.organizationId,actorId:actor.userId,entityId:id,action});
  async function load(tx:Tx,actor:ActorScope,id:string,write=true) {
    await outreachMember(tx,actor,write);
    const [row] = await tx.select().from(accounts).where(scoped(actor,id)).for("update");
    if (!row) throw new OutreachError("not_found"); return row;
  }
  async function credentials(tx:Tx,actor:ActorScope,id:string) {
    const row = await load(tx,actor,id);
    if (row.status !== "connected" || !row.tokenCiphertext) throw new OutreachError("reconnect");
    const old = JSON.parse(unseal(row.tokenCiphertext,context(actor.organizationId,id))) as ProviderTokens;
    const config = await resolveProviderConfig(tx,actor.organizationId,row.provider);
    if (row.appFingerprint && row.appFingerprint !== config.fingerprint || !row.appFingerprint && config.source === "workspace") throw new OutreachError("reconnect");
    const token = await refreshTokens(row.provider,old,fetcher,config);
    if (token !== old) await tx.update(accounts).set({tokenCiphertext:seal(JSON.stringify(token),context(actor.organizationId,id)),expiresAt:new Date(token.expiresAt),updatedAt:new Date(),updatedBy:actor.userId}).where(scoped(actor,id));
    return {row,token,config};
  }
  return {
    list: (actor:ActorScope) => database.transaction(async tx => {
      await outreachMember(tx,actor);
      const rows=await tx.select({...publicAccountColumns,appFingerprint:accounts.appFingerprint}).from(accounts).where(eq(accounts.organizationId,actor.organizationId)).orderBy(desc(accounts.createdAt),accounts.id);
      const configs=new Map<SenderProvider,Awaited<ReturnType<typeof resolveProviderConfig>>>();
      for(const provider of new Set(rows.map(r=>r.provider)))configs.set(provider,await resolveProviderConfig(tx,actor.organizationId,provider));
      return rows.map(({appFingerprint,...row})=>{
        const config=configs.get(row.provider)!;
        const changed=appFingerprint?appFingerprint!==config.fingerprint:config.source==="workspace";
        return {...row,status:row.status==="connected"&&changed?"reconnect" as const:row.status};
      });
    }),
    register: (actor:ActorScope,input:unknown) => database.transaction(async tx => {
      const data = registerAccountSchema.parse(input); await outreachMember(tx,actor,true);
      const [row] = await tx.insert(accounts).values({organizationId:actor.organizationId,provider:data.provider,label:data.label,expectedIdentity:normalizeIdentity(data.identity),createdBy:actor.userId,updatedBy:actor.userId}).onConflictDoNothing().returning(publicAccountColumns);
      if (!row) throw new OutreachError("duplicate"); await audit(tx,actor,row.id,"outreach.account_registered"); return row;
    }),
    begin: (actor:ActorScope,id:string,sessionHash:string,aliases=false) => database.transaction(async tx => {
      const row = await load(tx,actor,id), state = randomBytes(32).toString("base64url"), verifier=randomBytes(48).toString("base64url");
      const config = await resolveProviderConfig(tx,actor.organizationId,row.provider);
      const url = authorizationUrl(row.provider,state,verifier,row.expectedIdentity,aliases,config);
      // A newer connection request invalidates old outstanding callbacks for this account.
      await tx.update(states).set({consumedAt:new Date()}).where(and(eq(states.organizationId,actor.organizationId),eq(states.accountId,id),isNull(states.consumedAt)));
      await tx.insert(states).values({stateHash:hashSecret(state),organizationId:actor.organizationId,accountId:id,userId:actor.userId,sessionHash,appFingerprint:config.fingerprint,verifierCiphertext:seal(verifier,`${actor.organizationId}:${id}:oauth`),aliases:aliases?"yes":"no",expiresAt:new Date(Date.now()+600000)});
      return url;
    }),
    complete: async (actor:ActorScope,provider:SenderProvider,state:string,sessionHash:string,code:string|null) => {
      z.string().min(20).max(200).parse(state);
      const grant = await database.transaction(async tx => {
        await outreachMember(tx,actor,true);
        const [grant] = await tx.update(states).set({consumedAt:new Date()}).where(and(eq(states.stateHash,hashSecret(state)),eq(states.organizationId,actor.organizationId),eq(states.userId,actor.userId),eq(states.sessionHash,sessionHash),gt(states.expiresAt,new Date()),isNull(states.consumedAt))).returning();
        if (!grant) throw new OutreachError("oauth_expired"); return grant;
      });
      if (!code) throw new OutreachError("oauth_denied");
      return database.transaction(async tx => {
        const row = await load(tx,actor,grant.accountId);
        if (row.provider !== provider || row.updatedAt > grant.createdAt) throw new OutreachError("oauth_expired");
        const config = await resolveProviderConfig(tx,actor.organizationId,provider);
        if (grant.appFingerprint !== config.fingerprint) throw new OutreachError("oauth_expired");
        const verified = await exchangeCode(provider,z.string().max(4096).parse(code),unseal(grant.verifierCiphertext,`${actor.organizationId}:${row.id}:oauth`),fetcher,config);
        if (!matchesExpected(row.expectedIdentity,verified)) throw new OutreachError("wrong_identity");
        const [existing] = await tx.select({id:accounts.id}).from(accounts).where(and(eq(accounts.organizationId,actor.organizationId),eq(accounts.provider,provider),eq(accounts.providerId,verified.id)));
        if (existing && existing.id !== row.id) throw new OutreachError("duplicate");
        await tx.update(accounts).set({providerId:verified.id,identity:verified.identity,addresses:verified.addresses,scopes:verified.tokens.scopes,status:"connected",appFingerprint:config.fingerprint,tokenCiphertext:seal(JSON.stringify(verified.tokens),context(actor.organizationId,row.id)),expiresAt:new Date(verified.tokens.expiresAt),verifiedAt:new Date(),updatedAt:new Date(),updatedBy:actor.userId}).where(scoped(actor,row.id));
        await audit(tx,actor,row.id,"outreach.account_connected"); return row.id;
      });
    },
    disconnect: (actor:ActorScope,id:string) => database.transaction(async tx => {
      await load(tx,actor,id);
      await tx.update(accounts).set({status:"disconnected",tokenCiphertext:null,addresses:[],scopes:[],expiresAt:null,updatedAt:new Date(),updatedBy:actor.userId}).where(scoped(actor,id));
      await tx.update(states).set({consumedAt:new Date()}).where(and(eq(states.organizationId,actor.organizationId),eq(states.accountId,id),isNull(states.consumedAt)));
      await audit(tx,actor,id,"outreach.account_disconnected");
    }),
    sync: async (actor:ActorScope,id:string) => {
      try { return await database.transaction(async tx => {
        const {row,token,config} = await credentials(tx,actor,id), verified=await fetchIdentity(row.provider,token,fetcher,config);
        if (verified.id !== row.providerId || !matchesExpected(row.expectedIdentity,verified)) throw new OutreachError("wrong_identity");
        await tx.update(accounts).set({identity:verified.identity,addresses:verified.addresses,verifiedAt:new Date(),updatedAt:new Date(),updatedBy:actor.userId}).where(scoped(actor,id));
        await audit(tx,actor,id,"outreach.account_synced");
      }); } catch(error) {
        if (error instanceof OutreachError && ["reconnect","wrong_identity","permission_missing"].includes(error.code)) await database.transaction(async tx => {await load(tx,actor,id);await tx.update(accounts).set({status:"reconnect",updatedAt:new Date()}).where(scoped(actor,id));});
        throw error;
      }
    },
    // Credentials never leave the server. A transaction lock serializes refresh,
    // disconnect and send against the same account.
    credentials,
  };
}
export type PublicSenderAccount = Awaited<ReturnType<ReturnType<typeof accountService>["list"]>>[number];
export function connectionAvailability() {
  return Object.fromEntries((["google","instagram","tiktok"] as const).map(p=>[p,providerConfig(p).configured])) as Record<SenderProvider,boolean>;
}

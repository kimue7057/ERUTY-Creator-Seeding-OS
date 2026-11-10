import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { auditEvents } from "../db/schema";
import { outreachProviderApps as apps } from "../db/outreach-schema";
import type { ActorScope } from "../auth/permissions";
import { outreachMember, type OutreachTx } from "./access";
import { providerConfig } from "./providers";
import { providerAppInputSchema } from "./app-contracts";
import { hashSecret, seal, unseal } from "./crypto";
import { OutreachError, type SenderProvider } from "./contracts";
import { checkUnifiedAppCredentials } from "./instagram-unified";

export async function resolveProviderConfig(tx: OutreachTx, organizationId: string, provider: SenderProvider) {
  // Shared lock makes the credentials stable for the entire OAuth/send transaction.
  const [row] = await tx.select().from(apps).where(and(eq(apps.organizationId, organizationId), eq(apps.provider, provider))).for("share");
  let config = providerConfig(provider);
  if (row) {
    const saved = providerAppInputSchema.parse(JSON.parse(unseal(row.credentialsCiphertext, `${organizationId}:${provider}:provider-app`)));
    const prefix = { google: "GOOGLE", instagram: "INSTAGRAM", tiktok: "TIKTOK" }[provider];
    config = providerConfig(provider, { ...process.env, [`OUTREACH_${prefix}_CLIENT_ID`]: saved.clientId, [`OUTREACH_${prefix}_CLIENT_SECRET`]: saved.clientSecret, OUTREACH_INSTAGRAM_API_VERSION: saved.version, OUTREACH_INSTAGRAM_LOGIN_MODE: saved.instagramLoginMode, OUTREACH_INSTAGRAM_CONFIGURATION_ID: saved.configurationId });
  }
  // Keep existing Gmail/legacy fingerprints stable; only Unified Login adds a
  // mode/configuration binding, invalidating that provider's old grants.
  const binding = [config.id, config.secret, config.version, config.redirectUri];
  if (provider === "instagram" && config.instagramLoginMode === "unified") binding.push("unified", config.configurationId);
  return { ...config, fingerprint: hashSecret(JSON.stringify(binding)), revision: row?.revision ?? 0, source: row ? "workspace" : "environment" };
}
export function providerAppService(database: Pick<typeof db, "transaction"> = db, fetcher: typeof fetch = fetch) {
  return {
    checkInstagram: (actor: ActorScope, input: unknown) => database.transaction(async tx => {
      await outreachMember(tx, actor, true, true);
      const { revision } = z.object({ revision: z.number().int().nonnegative() }).strict().parse(input);
      const config = await resolveProviderConfig(tx, actor.organizationId, "instagram");
      if (config.revision !== revision) throw new OutreachError("draft_changed");
      if (!config.configured || config.instagramLoginMode !== "unified") throw new OutreachError("not_configured");
      const result = await checkUnifiedAppCredentials(config, fetcher);
      return { ...result, revision, checkedAt: new Date().toISOString() };
    }),
    status: (actor: ActorScope) => database.transaction(async tx => {
      await outreachMember(tx, actor);
      const statuses = [];
      for (const provider of ["google", "instagram", "tiktok"] as const) {
        const config = await resolveProviderConfig(tx, actor.organizationId, provider);
        statuses.push({ provider, configured: config.configured, revision: config.revision, source: config.source, redirectUri: config.redirectUri, clientHint: config.id ? `…${config.id.slice(-24)}` : "", version: config.version ?? "", instagramLoginMode: config.instagramLoginMode === "unified" ? "unified" as const : "instagram" as const, configurationId: provider === "instagram" ? config.configurationId : "" });
      }
      return statuses;
    }),
    save: (actor: ActorScope, input: unknown) => database.transaction(async tx => {
      await outreachMember(tx, actor, true, true);
      const data = providerAppInputSchema.parse(input);
      if (data.revision > 0 && !data.replace) throw new OutreachError("replacement_required");
      const credentialsCiphertext = seal(JSON.stringify(data), `${actor.organizationId}:${data.provider}:provider-app`);
      let id: string | undefined;
      if (data.revision === 0) {
        const config = providerConfig(data.provider);
        if (config.configured && !data.replace) throw new OutreachError("replacement_required");
        [id] = (await tx.insert(apps).values({ organizationId: actor.organizationId, provider: data.provider, credentialsCiphertext, createdBy: actor.userId, updatedBy: actor.userId }).onConflictDoNothing().returning({ id: apps.id })).map(r => r.id);
      } else {
        [id] = (await tx.update(apps).set({ credentialsCiphertext, revision: data.revision + 1, updatedAt: new Date(), updatedBy: actor.userId }).where(and(eq(apps.organizationId, actor.organizationId), eq(apps.provider, data.provider), eq(apps.revision, data.revision))).returning({ id: apps.id })).map(r => r.id);
      }
      if (!id) throw new OutreachError("draft_changed");
      await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: id, action: "outreach.provider_app_saved" });
      // Secrets and ciphertext never appear in the action response or audit payload.
      return { saved: true };
    }),
  };
}
export type ProviderAppStatus = Awaited<ReturnType<ReturnType<typeof providerAppService>["status"]>>[number];

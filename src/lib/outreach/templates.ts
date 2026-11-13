import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { auditEvents } from "../db/schema";
import { outreachBrandSettings as settings, outreachTemplates as templates } from "../db/outreach-schema";
import type { ActorScope } from "../auth/permissions";
import { outreachMember } from "./access";
import { OutreachError } from "./contracts";
import { brandingSchema, defaultBranding, templateInputSchema, starterCatalog } from "./template-contracts";
export function templateService(database: Pick<typeof db,"transaction"> = db) {
  return {
    list: (actor: ActorScope) => database.transaction(async tx => {
      await outreachMember(tx, actor);
      return tx.select().from(templates).where(eq(templates.organizationId, actor.organizationId)).orderBy(desc(templates.updatedAt),templates.id);
    }),
    branding: (actor: ActorScope) => database.transaction(async tx => {
      await outreachMember(tx, actor);
      const [row] = await tx.select().from(settings).where(eq(settings.organizationId, actor.organizationId));
      return { branding: row?.branding ?? defaultBranding, revision: row?.revision ?? 0 };
    }),
    saveBranding: (actor: ActorScope, input: unknown, revision: number) => database.transaction(async tx => {
      await outreachMember(tx, actor, true);
      const branding = brandingSchema.parse(input); z.number().int().min(0).parse(revision);
      const values = { branding, updatedAt: new Date(), updatedBy: actor.userId };
      const rows = revision === 0
        ? await tx.insert(settings).values({ ...values, organizationId: actor.organizationId, createdBy: actor.userId }).onConflictDoNothing().returning()
        : await tx.update(settings).set({ ...values, revision: revision + 1 }).where(and(eq(settings.organizationId, actor.organizationId), eq(settings.revision, revision))).returning();
      if (!rows[0]) throw new OutreachError("draft_changed");
      await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: actor.organizationId, action: "outreach.branding_saved" });
      return { branding: rows[0].branding, revision: rows[0].revision };
    }),
    save: (actor: ActorScope, input: unknown) => database.transaction(async tx => {
      await outreachMember(tx, actor, true);
      const {revision,...data} = templateInputSchema.parse(input);
      const values = { ...data, updatedAt: new Date(), updatedBy: actor.userId };
      const rows = revision === 0
        ? await tx.insert(templates).values({ ...values, organizationId: actor.organizationId, createdBy: actor.userId }).onConflictDoNothing().returning()
        : await tx.update(templates).set({ ...values, revision: revision + 1 }).where(and(eq(templates.organizationId, actor.organizationId), eq(templates.id, data.id), eq(templates.revision, revision))).returning();
      if (!rows[0]) throw new OutreachError("draft_changed");
      await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: data.id, action: "outreach.template_saved" });
      return rows[0];
    }),
    archive: (actor: ActorScope, id: string, revision: number, archived: boolean) => database.transaction(async tx => {
      await outreachMember(tx, actor, true); z.uuid().parse(id); z.number().int().positive().parse(revision); z.boolean().parse(archived);
      const [row] = await tx.update(templates).set({ archivedAt: archived ? new Date() : null, revision: revision + 1, updatedAt: new Date(), updatedBy: actor.userId }).where(and(eq(templates.organizationId, actor.organizationId), eq(templates.id, id), eq(templates.revision, revision))).returning();
      if (!row) throw new OutreachError("draft_changed");
      await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: id, action: archived ? "outreach.template_archived" : "outreach.template_restored" });
      return row;
    }),
    installDefaults: (actor: ActorScope) => database.transaction(async tx => {
      await outreachMember(tx, actor, true);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor.organizationId}),hashtext('outreach-templates'))`);
      const existing = await tx.select({name:templates.name,channel:templates.channel,language:templates.language}).from(templates).where(eq(templates.organizationId, actor.organizationId));
      const missing=starterCatalog.filter(t=>!existing.some(e=>e.name===t.name&&e.channel===t.channel&&e.language===t.language));
      if(missing.length){await tx.insert(templates).values(missing.map(t => ({ ...t, organizationId: actor.organizationId, createdBy: actor.userId, updatedBy: actor.userId })));
      await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: actor.organizationId, action: "outreach.templates_initialized" });}
      return{added:missing.length};
    }),
  };
}
export type SavedMessageTemplate = Awaited<ReturnType<ReturnType<typeof templateService>["list"]>>[number];

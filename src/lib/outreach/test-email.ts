import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { outreachConnectionTests as tests, senderAccounts } from "../db/outreach-schema";
import { auditEvents } from "../db/schema";
import type { ActorScope } from "../auth/permissions";
import { accountService } from "./accounts";
import { outreachMember } from "./access";
import { OutreachError } from "./contracts";
import { fetchIdentity } from "./providers";
import { rawEmail } from "./message";
import { testEmailBody, testEmailInput, testEmailSubject } from "./test-email-contracts";

export function connectionTestService(database: Pick<typeof db, "transaction"> = db, fetcher: typeof fetch = fetch) {
  const scope = (actor: ActorScope, id: string) => and(eq(tests.organizationId, actor.organizationId), eq(tests.id, id));
  return {
    list: (actor: ActorScope, accountId: string) => database.transaction(async tx => {
      await outreachMember(tx, actor);
      return tx.select().from(tests).where(and(eq(tests.organizationId, actor.organizationId), eq(tests.accountId, z.uuid().parse(accountId))))
        .orderBy(desc(tests.createdAt), desc(tests.id)).limit(5);
    }),
    send: async (actor: ActorScope, input: unknown) => {
      const data = testEmailInput.parse(input);
      const claim = await database.transaction(async tx => {
        await outreachMember(tx, actor, true);
        const [account] = await tx.select().from(senderAccounts).where(and(eq(senderAccounts.organizationId, actor.organizationId), eq(senderAccounts.id, data.accountId))).for("update");
        if (!account) throw new OutreachError("not_found");
        const [existing] = await tx.select().from(tests).where(scope(actor, data.id));
        if (existing) {
          if (existing.accountId !== data.accountId || existing.createdBy !== actor.userId || existing.fromAddress !== data.fromAddress || existing.toAddress !== data.toAddress) throw new OutreachError("test_changed");
          return { row: existing, fresh: false };
        }
        if (account.provider !== "google" || account.status !== "connected" || !account.addresses.some(a => a.address === data.fromAddress)) throw new OutreachError("reconnect");
        const [unresolved] = await tx.select({ id: tests.id }).from(tests).where(and(eq(tests.organizationId, actor.organizationId), eq(tests.accountId, data.accountId), inArray(tests.status, ["sending", "unknown"]))).limit(1);
        if (unresolved) throw new OutreachError("send_unknown");
        const recent = await tx.select({ id: tests.id }).from(tests).where(and(eq(tests.organizationId, actor.organizationId), eq(tests.accountId, data.accountId), sql`${tests.createdAt} > now() - interval '10 minutes'`)).limit(5);
        if (recent.length >= 5) throw new OutreachError("test_rate_limit");
        const [row] = await tx.insert(tests).values({ id: data.id, organizationId: actor.organizationId, accountId: data.accountId, fromAddress: data.fromAddress, toAddress: data.toAddress, subject: testEmailSubject, body: testEmailBody, createdBy: actor.userId }).onConflictDoNothing().returning();
        if (!row) throw new OutreachError("test_changed");
        await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: row.id, action: "outreach.connection_test_confirmed" });
        return { row, fresh: true };
      });
      // Persist before network IO. Reusing an attempt can only read its result,
      // including after an ambiguous response or a process interruption.
      if (!claim.fresh) return claim.row;
      let submitted = false;
      try {
        return await database.transaction(async tx => {
          await outreachMember(tx, actor, true);
          const { row: account, token } = await accountService(database, fetcher).credentials(tx, actor, data.accountId);
          if (account.provider !== "google") throw new OutreachError("reconnect");
          const verified = await fetchIdentity("google", token, fetcher);
          if (verified.id !== account.providerId || !verified.addresses.some(a => a.address === data.fromAddress)) throw new OutreachError("reconnect");
          const raw = rawEmail({ id: data.id, from: data.fromAddress, to: data.toAddress, subject: claim.row.subject, body: claim.row.body, template: "letter" });
          submitted = true;
          const response = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw }), redirect: "error", signal: AbortSignal.timeout(20000) });
          if (!response.ok) {
            await response.body?.cancel();
            if ([400, 401, 403, 404, 429].includes(response.status)) { submitted = false; throw new OutreachError("send_failed"); }
            throw new OutreachError("send_unknown");
          }
          const result = z.object({ id: z.string().min(1).max(200) }).parse(await response.json());
          const [saved] = await tx.update(tests).set({ status: "sent", providerMessageId: result.id, sentAt: new Date(), updatedAt: new Date() }).where(scope(actor, data.id)).returning();
          await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: data.id, action: "outreach.connection_test_sent" });
          return saved;
        });
      } catch (error) {
        const errorCode = submitted ? "send_unknown" : error instanceof OutreachError ? error.code : "provider_unavailable";
        return database.transaction(async tx => {
          await outreachMember(tx, actor, true);
          const [saved] = await tx.update(tests).set({ status: submitted ? "unknown" : "failed", errorCode, updatedAt: new Date() }).where(and(scope(actor, data.id), eq(tests.status, "sending"))).returning();
          if (!saved) throw new OutreachError("send_unknown");
          await tx.insert(auditEvents).values({ organizationId: actor.organizationId, actorId: actor.userId, entityId: data.id, action: `outreach.connection_test_${saved.status}` });
          return saved;
        });
      }
    },
  };
}

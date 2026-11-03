import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { memberships } from "../db/schema";
import type { ActorScope } from "../auth/permissions";
import { OutreachError } from "./contracts";
export type OutreachTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function outreachMember(tx: OutreachTx, actor: ActorScope, write = false, admin = false) {
  const [member] = await tx.select().from(memberships).where(and(eq(memberships.organizationId, actor.organizationId), eq(memberships.userId, actor.userId))).for("share");
  if (!member || write && member.role === "reviewer" || admin && member.role !== "admin") throw new OutreachError("forbidden");
  return member;
}

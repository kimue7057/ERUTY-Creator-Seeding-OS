import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, memberships, users, organizations } from "@/lib/db/schema";
export const SESSION_COOKIE = "eruty_session";
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export async function currentActor() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [actor] = await db.select({ userId: users.id, organizationId: organizations.id, name: users.name, organizationName: organizations.name, role: memberships.role })
    .from(sessions).innerJoin(users, eq(sessions.userId, users.id))
    .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.organizationId, sessions.organizationId)))
    .innerJoin(organizations, eq(organizations.id, sessions.organizationId))
    .where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, new Date())));
  return actor ?? null;
}
export async function requireActor() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  return actor;
}
export async function createSession(userId: string, organizationId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await db.insert(sessions).values({ tokenHash: tokenHash(token), userId, organizationId, expiresAt });
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt });
}
export type Actor = NonNullable<Awaited<ReturnType<typeof currentActor>>>;

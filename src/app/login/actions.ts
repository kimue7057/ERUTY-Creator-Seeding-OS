"use server";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { loginAttempts, memberships, sessions, users } from "@/lib/db/schema";
import { createSession, SESSION_COOKIE, tokenHash } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
const dummyHash = hashPassword("dummy-credential-timing-padding");
export type LoginState = { error: string };
export async function login(_: LoginState, form: FormData): Promise<LoginState> {
  const parsed = z.object({ email: z.email().max(254), password: z.string().min(1).max(256) }).safeParse({ email: String(form.get("email") ?? "").trim().toLowerCase(), password: form.get("password") });
  if (!parsed.success) return { error: "이메일과 비밀번호를 확인해 주세요." };
  const { email, password } = parsed.data;
  const emailKey = createHash("sha256").update(email).digest("hex");
  // Atomic account-based limiter: no credential or raw email is stored here.
  const [attempt] = await db.insert(loginAttempts).values({ emailKey, attempts: 1 }).onConflictDoUpdate({ target: loginAttempts.emailKey, set: {
    attempts: sql`case when ${loginAttempts.windowStartedAt} < now() - interval '15 minutes' then 1 else ${loginAttempts.attempts} + 1 end`,
    windowStartedAt: sql`case when ${loginAttempts.windowStartedAt} < now() - interval '15 minutes' then now() else ${loginAttempts.windowStartedAt} end`,
  } }).returning();
  if (attempt.attempts > 10) return { error: "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." };
  const [user] = await db.select().from(users).where(eq(users.email, email));
  const matches = verifyPassword(password, user?.passwordHash ?? dummyHash);
  if (!user || !matches) return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  const [membership] = await db.select().from(memberships).where(eq(memberships.userId, user.id)).orderBy(memberships.createdAt, memberships.organizationId).limit(1);
  if (!membership) return { error: "워크스페이스 접근 권한이 없습니다." };
  await db.delete(loginAttempts).where(eq(loginAttempts.emailKey, emailKey));
  await createSession(user.id, membership.organizationId);
  redirect("/");
}
export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(and(eq(sessions.tokenHash, tokenHash(token))));
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

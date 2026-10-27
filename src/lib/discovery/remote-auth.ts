import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { users, memberships, loginAttempts } from "../db/schema";
import { browserWorkerSessions } from "../db/browser-schema";
import { hashPassword, verifyPassword } from "../auth/password";
import { DiscoveryError } from "./contracts";

const loginInput = z.strictObject({ email: z.email().max(254), password: z.string().min(1).max(256), organization_id: z.uuid().optional() });
const dummy = hashPassword("browser-worker-timing-padding");
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
export function browserWorkerAuth(database: Pick<typeof db, "select" | "insert" | "delete"> = db) {
  return {
    async login(input: unknown) {
      const data = loginInput.parse(input), email = data.email.trim().toLowerCase(), emailKey = digest(email);
      // Shared account limiter also counts failed dashboard login attempts.
      const [attempt] = await database.insert(loginAttempts).values({ emailKey, attempts: 1 }).onConflictDoUpdate({ target: loginAttempts.emailKey, set: {
        attempts: sql`case when ${loginAttempts.windowStartedAt} < now() - interval '15 minutes' then 1 else ${loginAttempts.attempts} + 1 end`,
        windowStartedAt: sql`case when ${loginAttempts.windowStartedAt} < now() - interval '15 minutes' then now() else ${loginAttempts.windowStartedAt} end`,
      } }).returning();
      if (attempt.attempts > 10) throw new DiscoveryError(429, "login_rate_limited");
      const [user] = await database.select().from(users).where(eq(users.email, email));
      if (!verifyPassword(data.password, user?.passwordHash ?? dummy) || !user) throw new DiscoveryError(401, "invalid_credentials");
      const [membership] = await database.select().from(memberships).where(and(eq(memberships.userId, user.id), data.organization_id ? eq(memberships.organizationId, data.organization_id) : undefined)).orderBy(memberships.createdAt, memberships.organizationId).limit(1);
      if (!membership || membership.role === "reviewer") throw new DiscoveryError(403, "insufficient_scope");
      const token = randomBytes(32).toString("hex"), createdAt = new Date(), expiresAt = new Date(createdAt.getTime() + 8 * 3600000);
      await database.delete(browserWorkerSessions).where(and(eq(browserWorkerSessions.userId, user.id), sql`${browserWorkerSessions.expiresAt} <= now()`));
      await database.insert(browserWorkerSessions).values({ tokenHash: digest(token), userId: user.id, organizationId: membership.organizationId, createdAt, expiresAt });
      await database.delete(loginAttempts).where(eq(loginAttempts.emailKey, emailKey));
      return { token, expires_at: expiresAt.toISOString() };
    },
    async actor(token: string) {
      if (!/^[a-f0-9]{64}$/.test(token)) throw new DiscoveryError(401, "invalid_worker_session");
      const [row] = await database.select({ userId: memberships.userId, organizationId: memberships.organizationId, role: memberships.role }).from(browserWorkerSessions).innerJoin(memberships, and(eq(memberships.organizationId, browserWorkerSessions.organizationId), eq(memberships.userId, browserWorkerSessions.userId))).where(and(eq(browserWorkerSessions.tokenHash, digest(token)), gt(browserWorkerSessions.expiresAt, new Date())));
      if (!row || row.role === "reviewer") throw new DiscoveryError(401, "invalid_worker_session");
      return row;
    },
    async logout(token: string) { await database.delete(browserWorkerSessions).where(eq(browserWorkerSessions.tokenHash, digest(token))); return { revoked: true }; },
  };
}

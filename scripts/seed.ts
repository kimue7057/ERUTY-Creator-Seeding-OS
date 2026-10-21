import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/lib/db";
import { organizations, users, memberships } from "../src/lib/db/schema";
import { hashPassword } from "../src/lib/auth/password";
const email = process.env.BOOTSTRAP_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_PASSWORD;
if (!email || !password || password.length < 12 || password.includes("CHANGE_ME")) throw new Error("Set a unique BOOTSTRAP_EMAIL and BOOTSTRAP_PASSWORD (12+ characters) in .env.");
try {
  await db.transaction(async tx => {
    const [existing] = await tx.select().from(users).where(eq(users.email, email));
    if (existing) { console.log("Bootstrap user already exists; credentials were not reset."); return; }
    const [organization] = await tx.insert(organizations).values({ name: "ERUTY Workspace" }).returning();
    const [user] = await tx.insert(users).values({ email, name: "워크스페이스 관리자", passwordHash: hashPassword(password) }).returning();
    await tx.insert(memberships).values({ organizationId: organization.id, userId: user.id, role: "admin" });
    console.log("Created bootstrap workspace and admin. No brand or creator fixtures were added.");
  });
} finally { await pool.end(); }

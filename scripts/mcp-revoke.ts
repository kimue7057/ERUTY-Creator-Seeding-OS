import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "../src/lib/db";
import { discoveryProbeGrants, auditEvents, memberships, users } from "../src/lib/db/schema";
import { canWrite } from "../src/lib/auth/permissions";
try {
  const id = z.uuid().parse(process.env.MCP_PROBE_GRANT_ID); const org = z.uuid().parse(process.env.MCP_PROBE_ORGANIZATION_ID);
  await db.transaction(async tx => {
    const [operator] = await tx.select({ id: users.id, role: memberships.role }).from(users).innerJoin(memberships, eq(memberships.userId, users.id))
      .where(and(eq(users.email, process.env.MCP_PROBE_USER_EMAIL?.toLowerCase() ?? ""), eq(memberships.organizationId, org))).for("share", { of: [memberships] });
    if (!operator || !canWrite(operator)) throw new Error("Explicit sandbox operator identity required");
    const [grant] = await tx.update(discoveryProbeGrants).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(discoveryProbeGrants.id, id), eq(discoveryProbeGrants.organizationId, org), isNull(discoveryProbeGrants.revokedAt))).returning();
    if (grant) await tx.insert(auditEvents).values({ organizationId: org, actorId: operator.id, entityId: id, action: "discovery.probe_grant_revoked_by_operator_cli" });
  });
  console.log("Probe grant revoked or already inactive. Existing receipts preserved.");
} catch { console.error("Probe grant revocation failed."); process.exitCode = 1; }
finally { await pool.end(); }

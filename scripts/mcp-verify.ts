import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "../src/lib/db";
import { discoveryProbes, auditEvents } from "../src/lib/db/schema";
import { probeHash } from "../src/lib/probe/contracts";
try {
  const id = z.uuid().parse(process.env.MCP_PROBE_ID); const org = z.uuid().parse(process.env.MCP_PROBE_ORGANIZATION_ID);
  const [row] = await db.select().from(discoveryProbes).where(and(eq(discoveryProbes.id, id), eq(discoveryProbes.organizationId, org)));
  if (!row || row.payloadSha256 !== probeHash(row.nonce)) throw new Error("Receipt missing or invalid");
  const events = await db.select({ action: auditEvents.action }).from(auditEvents).where(and(eq(auditEvents.organizationId, org), eq(auditEvents.entityId, id), eq(auditEvents.actorId, row.actorId)));
  if (!events.some(e => e.action === "discovery.probe_written")) throw new Error("Write audit missing");
  console.log(JSON.stringify({ probe_id: row.id, nonce: row.nonce, payload_sha256: row.payloadSha256, request_id: row.requestId, actor_id: row.actorId, principal_id: row.principalId, recorded_at: row.createdAt.toISOString(), audit_actions: events.map(e => e.action), persisted_readback: true, work_connection: "unverified" }));
} catch { console.error("Probe DB read-back could not be verified."); process.exitCode = 1; }
finally { await pool.end(); }

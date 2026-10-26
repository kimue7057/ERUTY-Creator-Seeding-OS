import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync, realpathSync, existsSync, appendFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "../src/lib/db";
import { auditEvents, memberships } from "../src/lib/db/schema";
import { discoveryMcpGrants, discoveryCapabilities } from "../src/lib/db/discovery-schema";
import { discoveryMcpConfig, discoveryEnvironmentHash } from "../src/lib/discovery/mcp-access";
import { authorizeInitialDiscoveryRun, provisionDiscoveryGrant, rotateExpiredDiscoveryGrant } from "../src/lib/discovery/provision";
import { approveDiscoveryOperation, revokeDiscoveryOperation } from "../src/lib/discovery/operating-approval";
import { privateError, safeFailure } from "../src/lib/probe/diagnostics";
import { verifyDiscoveryProof } from "../src/lib/discovery/proof";
import { platformSchema, observedTime, privateReference } from "../src/lib/discovery/contracts";
const folder = ".local/discovery";
const read = (file: string) => { const text = readFileSync(`${folder}/${file}`, "utf8"); if (Buffer.byteLength(text) > 524288) throw new Error("Oversized local evidence"); return JSON.parse(text); };
async function operator(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], org: string) {
  const id = z.uuid().parse(process.env.MCP_DISCOVERY_OPERATOR_USER_ID);
  const [member] = await tx.select().from(memberships).where(and(eq(memberships.organizationId, org), eq(memberships.userId, id))).for("share");
  if (!member || member.role === "reviewer") throw new Error("Explicit current writer operator required");
  return id;
}
try {
  const config = discoveryMcpConfig();
  const action = process.argv[2];
  if (action === "environment") {
    console.log(JSON.stringify({ environment_sha256: discoveryEnvironmentHash(config), build: config.build, work_connection: "unverified" }));
  } else if (action === "approve-operation") {
    const input = read("operating-approval.json");
    if (input.approved_by !== z.uuid().parse(process.env.MCP_DISCOVERY_OPERATOR_USER_ID)) throw new Error("Explicit administrator operator required");
    const receipt = await approveDiscoveryOperation(input, config);
    const path = `${folder}/operating-approval-${receipt.approval_id}.json`;
    try { writeFileSync(path, JSON.stringify(receipt), { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
      const saved = JSON.parse(readFileSync(path, "utf8"));
      if (saved.approval_id !== receipt.approval_id || saved.expires_at !== receipt.expires_at) throw new Error("Preserved operating approval receipt mismatch");
    }
    console.log(JSON.stringify({ action, receipt_file: path, ...receipt, capability_attested: false }));
  } else if (action === "revoke-operation") {
    const receipt = await revokeDiscoveryOperation({ organizationId: config.organizationId, approvalId: z.uuid().parse(process.env.MCP_DISCOVERY_OPERATING_APPROVAL_ID), actorId: z.uuid().parse(process.env.MCP_DISCOVERY_OPERATOR_USER_ID) });
    console.log(JSON.stringify({ action, ...receipt }));
  } else if (action === "grant") {
    if (existsSync(`${folder}/grant-receipt.json`)) throw new Error("Preserve/archive the existing private grant receipt before provisioning another");
    const input = read("grant.json");
    if (input.organization_id !== config.organizationId || input.issuer !== config.issuer || input.environment_sha256 !== discoveryEnvironmentHash(config)) throw new Error("Configured grant environment mismatch");
    if (input.user_id !== z.uuid().parse(process.env.MCP_DISCOVERY_OPERATOR_USER_ID)) throw new Error("Explicit writer operator required");
    const receipt = await provisionDiscoveryGrant(input);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    writeFileSync(`${folder}/grant-receipt.json`, JSON.stringify(receipt), { flag: "wx", mode: 0o600 });
    console.log("Explicit campaign-scoped grant created; private receipt saved. Work connectivity remains unverified.");
  } else if (action === "rotate-expired-grant") {
    const input = read("grant-rotation.json");
    if (input.organization_id !== config.organizationId || input.issuer !== config.issuer || input.environment_sha256 !== discoveryEnvironmentHash(config) || input.user_id !== z.uuid().parse(process.env.MCP_DISCOVERY_OPERATOR_USER_ID)) throw new Error("Configured operator/environment mismatch");
    const key = z.uuid().parse(input.idempotency_key);
    const receipt = await rotateExpiredDiscoveryGrant(input);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const path = `${folder}/grant-rotation-${key}.json`;
    try { writeFileSync(path, JSON.stringify(receipt), { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
      const saved = JSON.parse(readFileSync(path, "utf8"));
      if (saved.grant_id !== receipt.grant_id || saved.request_id !== receipt.request_id || saved.expires_at !== receipt.expires_at) throw new Error("Preserved rotation receipt mismatch");
    }
    console.log(JSON.stringify({ action: "rotate-expired-grant", receipt_file: path, ...receipt }));
  } else if (action === "authorize-initial-run") {
    const input = read("initial-run-authorization.json");
    if (input.organization_id !== config.organizationId || input.environment_sha256 !== discoveryEnvironmentHash(config) || input.user_id !== z.uuid().parse(process.env.MCP_DISCOVERY_OPERATOR_USER_ID)) throw new Error("Configured operator/environment mismatch");
    const receipt = await authorizeInitialDiscoveryRun(input);
    writeFileSync(`${folder}/initial-run-receipt.json`, JSON.stringify(receipt), { flag: "wx", mode: 0o600 });
    console.log("One bounded initial Work run authorized; no verified capability was created. Private receipt saved.");
  } else if (action === "revoke") {
    const id = z.uuid().parse(process.env.MCP_DISCOVERY_GRANT_ID);
    await db.transaction(async tx => {
      const actorId = await operator(tx, config.organizationId);
      const [grant] = await tx.update(discoveryMcpGrants).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(discoveryMcpGrants.organizationId, config.organizationId), eq(discoveryMcpGrants.id, id), isNull(discoveryMcpGrants.revokedAt))).returning();
      if (grant) await tx.insert(auditEvents).values({ organizationId: config.organizationId, actorId, entityId: grant.id, action: "discovery.mcp_grant_revoked_by_operator" });
    });
    console.log("Discovery grant revoked or already inactive; evidence preserved. Re-test actual Work denial separately.");
  } else if (action === "verify") {
    const url = z.string().min(1).parse(process.env.MCP_DISCOVERY_VERIFIER_DATABASE_URL);
    const client = new Client({ connectionString: url });
    try { await client.connect(); console.log(JSON.stringify(await verifyDiscoveryProof(client, read("proof.json"), { organizationId: config.organizationId, closed: process.argv.includes("--closed") }))); }
    finally { await client.end(); }
  } else if (action === "review-capability") {
    const input = z.strictObject({ platform: platformSchema, kind: z.enum(["sns_native_search", "work_mcp_write"]), verdict: z.enum(["partial", "verified", "blocked"]), private_evidence_file: privateReference,
      observed_at: observedTime, facts: z.strictObject({ native_search: z.boolean(), direct_profiles: z.number().int().min(0).max(1000), recent_content_profiles: z.number().int().min(0).max(1000), limitations: z.array(z.string().max(2000)).max(20) }),
      confirmation: z.literal("I-reviewed-the-private-Work-trace-and-independent-DB-proof"),
    }).parse(read("capability-review.json"));
    const evidenceRoot = realpathSync(resolve(folder, "evidence"));
    const path = realpathSync(resolve(evidenceRoot, input.private_evidence_file));
    if (!path.startsWith(evidenceRoot + sep) || !/\.(json|md)$/i.test(path)) throw new Error("Use private evidence files inside the dedicated evidence folder");
    const bytes = readFileSync(path); if (bytes.length < 1 || bytes.length > 1048576) throw new Error("Evidence file missing or oversized");
    if (input.kind === "sns_native_search" && input.verdict !== "blocked" && (!input.facts.native_search || input.facts.direct_profiles < 1 || input.facts.recent_content_profiles < 1)) throw new Error("Native search and direct recent-content evidence required");
    if (input.kind === "sns_native_search" && input.verdict === "verified" && (input.facts.direct_profiles < 5 || input.facts.recent_content_profiles < 5)) throw new Error("Platform pass requires five profiles with recent content");
    await db.transaction(async tx => {
      const actorId = await operator(tx, config.organizationId);
      const [row] = await tx.insert(discoveryCapabilities).values({ organizationId: config.organizationId, platform: input.platform, kind: input.kind, verdict: input.verdict, environmentSha256: discoveryEnvironmentHash(config), privateEvidenceReference: `private-file-sha256:${createHash("sha256").update(bytes).digest("hex")}`, facts: input.facts, observedAt: new Date(input.observed_at), reviewedBy: actorId }).returning();
      await tx.insert(auditEvents).values({ organizationId: config.organizationId, actorId, entityId: row.id, action: "discovery.capability_attested_by_operator" });
    });
    console.log("Operator attestation recorded with a private evidence hash. This command does not independently establish that a Work/SNS experiment occurred.");
  } else throw new Error("Use environment, approve-operation, revoke-operation, grant, rotate-expired-grant, authorize-initial-run, revoke, verify or review-capability");
} catch (error) {
  const failure = safeFailure(error), requestId = randomUUID();
  try { mkdirSync(folder, { recursive: true, mode: 0o700 }); appendFileSync(`${folder}/operator-failures.private.jsonl`, JSON.stringify({ at: new Date().toISOString(), request_id: requestId, code: failure.code, error: privateError(error) }) + "\n", { mode: 0o600 }); } catch { /* A logging failure must not obscure the original safe result. */ }
  console.error(JSON.stringify({ error: failure.code, request_id: requestId, retryable: false, recovery: failure.recovery })); process.exitCode = 1;
}
finally { await pool.end(); }

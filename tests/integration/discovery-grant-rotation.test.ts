import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { withDiscoveryDatabase } from "../discovery-fixture";
import { provisionDiscoveryGrant, rotateExpiredDiscoveryGrant } from "../../src/lib/discovery/provision";
import { discoveryMcpGrants } from "../../src/lib/db/discovery-schema";
import { DiscoveryError } from "../../src/lib/discovery/contracts";

const code = (name: string) => (error: unknown) => error instanceof DiscoveryError && error.code === name;

test("explicit expired-grant rotation is atomic, campaign scoped, audited and idempotent without reactivating grants", async () => {
  await withDiscoveryDatabase(async ({ database, client, actor, other, reader, campaign }) => {
    const a = await campaign(), foreign = await campaign(other);
    const base = { organization_id: actor.organizationId, user_id: actor.userId, issuer: "https://synthetic-idp.example.invalid/", subject: "synthetic-rotation", environment_sha256: "a".repeat(64), execution_source: "work_manual_task", campaign_ids: [a.id], scopes: ["discovery:read"], expires_at: new Date(Date.now() + 3600000).toISOString(), confirmation: "create-explicit-discovery-campaign-grant" };
    const old = await provisionDiscoveryGrant({ ...base, expires_at: new Date(Date.now() + 1500).toISOString() }, database);
    const input = { ...base, previous_grant_id: old.grant_id, environment_sha256: "b".repeat(64), idempotency_key: randomUUID(), confirmation: "rotate-expired-discovery-campaign-grant" };
    await assert.rejects(provisionDiscoveryGrant(base, database), code("grant_already_active"));
    await assert.rejects(rotateExpiredDiscoveryGrant(input, database), code("grant_still_active"));
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(old.expires_at) - Date.now()) + 30));
    await assert.rejects(provisionDiscoveryGrant(base, database), code("grant_expired_requires_rotation"));
    for (const changed of [{ user_id: reader.userId }, { organization_id: other.organizationId, user_id: other.userId }, { subject: "different-principal" }, { execution_source: "codex_test" }]) {
      await assert.rejects(rotateExpiredDiscoveryGrant({ ...input, ...changed }, database), code("user_id" in changed && changed.user_id === reader.userId ? "operator_forbidden" : "grant_replacement_mismatch"));
    }
    // Failed allowlist/lifetime checks roll back the old grant closure and every audit/receipt.
    await assert.rejects(rotateExpiredDiscoveryGrant({ ...input, campaign_ids: [foreign.id] }, database), /Campaign allowlist mismatch/);
    await assert.rejects(rotateExpiredDiscoveryGrant({ ...input, expires_at: new Date(Date.now() + 25 * 3600000).toISOString() }, database), /Invalid grant source\/lifetime/);
    assert.equal((await database.select().from(discoveryMcpGrants).where(eq(discoveryMcpGrants.id, old.grant_id)))[0].revokedAt, null);
    assert.equal((await client.query("select count(*)::int n from discovery_requests")).rows[0].n, 0);
    assert.equal((await client.query("select count(*)::int n from audit_events where action='discovery.mcp_grant_revoked_by_operator'")).rows[0].n, 0);
    const [created, replay] = await Promise.all([rotateExpiredDiscoveryGrant(input, database), rotateExpiredDiscoveryGrant(input, database)]);
    assert.equal(created.grant_id, replay.grant_id); assert.notEqual(created.replayed, replay.replayed);
    assert.equal(created.expires_at, base.expires_at);
    await assert.rejects(rotateExpiredDiscoveryGrant({ ...input, scopes: ["discovery:read", "discovery:observe"] }, database), code("idempotency_conflict"));
    await assert.rejects(rotateExpiredDiscoveryGrant({ ...input, idempotency_key: randomUUID() }, database), code("grant_already_revoked"));
    const rows = await database.select().from(discoveryMcpGrants);
    assert.equal(rows.length, 2); assert.ok(rows.find(r => r.id === old.grant_id)?.revokedAt);
    const next = rows.find(r => r.id === created.grant_id)!;
    assert.equal(next.environmentSha256, "b".repeat(64)); assert.deepEqual(next.scopes, ["discovery:read"]);
    assert.equal((await client.query("select count(*)::int n from discovery_requests where tool='operator.rotate_expired_grant'")).rows[0].n, 1);
    assert.equal((await client.query("select count(*)::int n from audit_events where action='discovery.mcp_grant_rotated_by_operator'")).rows[0].n, 1);
    assert.equal((await client.query("select count(*)::int n from discovery_capability_receipts")).rows[0].n, 0);
    assert.equal((await client.query("select campaign_id from discovery_grant_campaigns where grant_id=$1", [created.grant_id])).rows[0].campaign_id, a.id);
    // Replaying a receipt never extends expiry or reactivates a later revoked replacement.
    await database.update(discoveryMcpGrants).set({ revokedAt: new Date() }).where(eq(discoveryMcpGrants.id, created.grant_id as string));
    assert.equal((await rotateExpiredDiscoveryGrant(input, database)).replayed, true);
    assert.ok((await database.select().from(discoveryMcpGrants).where(eq(discoveryMcpGrants.id, created.grant_id as string)))[0].revokedAt);
  });
});

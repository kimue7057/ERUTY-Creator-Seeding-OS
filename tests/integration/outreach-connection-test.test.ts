import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { withDiscoveryDatabase } from "../discovery-fixture";
import { accountService } from "../../src/lib/outreach/accounts";
import { connectionTestService } from "../../src/lib/outreach/test-email";
import { outreachConnectionTests, outreachDrafts, senderAccounts } from "../../src/lib/db/outreach-schema";
import { seal } from "../../src/lib/outreach/crypto";
import { GOOGLE_SEND_SCOPE } from "../../src/lib/outreach/providers";
import { OutreachError } from "../../src/lib/outreach/contracts";
import { testEmailBody, testEmailSubject } from "../../src/lib/outreach/test-email-contracts";
process.env.OUTREACH_ENCRYPTION_KEY = "a".repeat(64);
process.env.OUTREACH_GOOGLE_CLIENT_ID = "synthetic-client";
process.env.OUTREACH_GOOGLE_CLIENT_SECRET = "synthetic-secret";
process.env.APP_ORIGIN = "http://127.0.0.1:3000";
const code = (expected: string) => (e: unknown) => e instanceof OutreachError && e.code === expected;
async function fixture(f: Parameters<Parameters<typeof withDiscoveryDatabase>[0]>[0]) {
  const account = await accountService(f.database).register(f.actor, { provider: "google", label: "Synthetic test sender", identity: "sender@example.invalid" });
  await f.database.update(senderAccounts).set({ status: "connected", providerId: "synthetic", identity: "sender@example.invalid", addresses: [{ address: "sender@example.invalid", primary: true, label: "Primary" }], tokenCiphertext: seal(JSON.stringify({ accessToken: "synthetic", expiresAt: Date.now() + 3600000, scopes: [GOOGLE_SEND_SCOPE] }), `${f.actor.organizationId}:${account.id}:sender-token`), verifiedAt: new Date() }).where(eq(senderAccounts.id, account.id));
  return { id: randomUUID(), accountId: account.id, fromAddress: "sender@example.invalid", toAddress: "recipient@example.invalid", confirmed: true };
}
const identity = () => Response.json({ sub: "synthetic", email: "sender@example.invalid", email_verified: true });
test("connection test sends approved content once, enforces scope and sender, and leaves creator drafts untouched", async () => {
  await withDiscoveryDatabase(async f => {
    const input = await fixture(f); let sends = 0;
    const svc = connectionTestService(f.database, async (url, init) => {
      if (String(url).includes("userinfo")) return identity();
      sends++;
      const raw = Buffer.from(JSON.parse(String(init?.body)).raw, "base64url").toString();
      assert.match(raw, /From: sender@example.invalid/); assert.match(raw, /To: recipient@example.invalid/);
      assert.ok(raw.includes(Buffer.from(testEmailSubject).toString("base64")));
      const encodedBody = raw.split("Content-Transfer-Encoding: base64\r\n\r\n")[1].split("\r\n--")[0];
      assert.ok(Buffer.from(encodedBody.replaceAll("\r\n", ""), "base64").toString().startsWith(testEmailBody));
      return Response.json({ id: "synthetic-test-message" });
    });
    await assert.rejects(svc.send(f.reader, input), code("forbidden"));
    await assert.rejects(svc.send(f.other, input), code("not_found"));
    await assert.rejects(svc.send(f.actor, { ...input, confirmed: false }));
    await assert.rejects(svc.send(f.actor, { ...input, fromAddress: "spoof@example.invalid" }), code("reconnect"));
    const results = await Promise.all([svc.send(f.actor, input), svc.send(f.actor, input)]);
    assert.equal(sends, 1); assert.ok(results.some(r => r.status === "sent"));
    assert.equal((await svc.send(f.actor, input)).providerMessageId, "synthetic-test-message"); assert.equal(sends, 1);
    await assert.rejects(svc.send(f.actor, { ...input, toAddress: "other@example.invalid" }), code("test_changed"));
    assert.equal((await svc.list(f.other, input.accountId)).length, 0);
    assert.equal((await f.database.select().from(outreachDrafts)).length, 0);
    await assert.rejects(f.database.update(outreachConnectionTests).set({ toAddress: "changed@example.invalid" }).where(eq(outreachConnectionTests.id, input.id)));
  });
});
test("unknown connection delivery cannot retry, including with a new request ID", async () => {
  await withDiscoveryDatabase(async f => {
    const input = await fixture(f); let sends = 0;
    const svc = connectionTestService(f.database, async url => { if (String(url).includes("userinfo")) return identity(); sends++; throw new Error("Synthetic disconnect"); });
    assert.equal((await svc.send(f.actor, input)).status, "unknown");
    assert.equal((await svc.send(f.actor, input)).status, "unknown");
    await assert.rejects(svc.send(f.actor, { ...input, id: randomUUID() }), code("send_unknown"));
    assert.equal(sends, 1);
  });
});
test("known provider refusal is recorded and test volume is bounded per account", async () => {
  await withDiscoveryDatabase(async f => {
    const input = await fixture(f); let sends = 0;
    const svc = connectionTestService(f.database, async url => { if (String(url).includes("userinfo")) return identity(); sends++; return new Response("", { status: 403 }); });
    for (let i = 0; i < 5; i++) assert.equal((await svc.send(f.actor, { ...input, id: randomUUID() })).status, "failed");
    await assert.rejects(svc.send(f.actor, { ...input, id: randomUUID() }), code("test_rate_limit"));
    assert.equal(sends, 5);
  });
});

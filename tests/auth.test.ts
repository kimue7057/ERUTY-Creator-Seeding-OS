import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/lib/auth/password";
import { canWrite, assertWriter } from "../src/lib/auth/permissions";
test("passwords have unique salts and reject wrong credentials", () => {
  const hash = hashPassword("synthetic-only-test-password");
  assert.notEqual(hash, hashPassword("synthetic-only-test-password"));
  assert.equal(verifyPassword("synthetic-only-test-password", hash), true);
  assert.equal(verifyPassword("incorrect", hash), false);
  assert.equal(verifyPassword("anything", "malformed"), false);
});
test("reviewers cannot mutate workspace data", () => {
  assert.equal(canWrite({ role: "manager" }), true);
  assert.equal(canWrite({ role: "admin" }), true);
  assert.throws(() => assertWriter({ userId: "u", organizationId: "o", role: "reviewer" }));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { cliFailureCode, interruptionManifest } from "../src/lib/discovery/cli-interruption";

test("provider spend-cap errors are identified without trusting browser/tool text", () => {
  const message = "You hit your spend cap set by the owner of your workspace. Ask an owner to increase your spend cap to continue.";
  assert.equal(cliFailureCode({ type: "error", message }), "workspace_spend_cap");
  assert.equal(cliFailureCode({ type: "turn.failed", error: { message } }), "workspace_spend_cap");
  assert.equal(cliFailureCode({ type: "item.completed", item: { result: message } }), null);
  assert.equal(cliFailureCode({ type: "error", message: "Connection closed" }), "cli_failed");
});

test("interruption submits only actual saved collecting results using their current lock", () => {
  const current = { status: "collecting", lock_version: 33, counts: { discovered: 8 } };
  const partial = interruptionManifest(current, "request", "stable-submit", "workspace_spend_cap");
  assert.equal(partial?.expected_lock_version, 33);
  assert.equal(partial?.outcome, "partial");
  assert.match(partial!.limitations[0], /8 saved accounts/);
  for (const status of ["prepared", "awaiting_review", "cancelled", "failed"]) assert.equal(interruptionManifest({ ...current, status }, "request", "stable-submit", "cli_failed"), null);
  assert.equal(interruptionManifest({ ...current, counts: { discovered: 0 } }, "request", "stable-submit", "cli_failed"), null);
});

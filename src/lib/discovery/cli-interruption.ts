import { z } from "zod";

// Only top-level provider events qualify; webpage/tool text is untrusted.
export function cliFailureCode(event: Record<string, unknown>) {
  const message = event.type === "error" ? event.message : event.type === "turn.failed" && event.error && typeof event.error === "object" ? (event.error as Record<string, unknown>).message : null;
  if (typeof message !== "string") return null;
  return /hit your spend cap set by the owner of your workspace/i.test(message) ? "workspace_spend_cap" as const : "cli_failed" as const;
}

export function interruptionManifest(input: unknown, requestId: string, submitKey: string, reason: string) {
  const status = z.object({ status: z.string(), lock_version: z.number().int().nonnegative(), counts: z.object({ discovered: z.number().int().nonnegative() }) }).parse(input);
  if (status.status !== "collecting" || status.counts.discovered === 0) return null;
  return { prepare_key: requestId, submit_key: submitKey, expected_lock_version: status.lock_version, outcome: "partial" as const, limitations: [`Automatic executor stopped before final submission (${reason}). Preserved ${status.counts.discovered} saved accounts and their original evidence. Human review is pending.`] };
}

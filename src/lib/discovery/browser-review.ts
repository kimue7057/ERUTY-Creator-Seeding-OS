import type { discoveryRuns } from "../db/discovery-schema";
import type { browserRunReviews } from "../db/browser-schema";

export function browserExecutionAccepted(run: Pick<typeof discoveryRuns.$inferSelect, "id" | "executionSource" | "contextSha256" | "environmentSnapshot">, rows: typeof browserRunReviews.$inferSelect[]) {
  const relevant = rows.filter(row => row.runId === run.id);
  if (run.executionSource !== "codex_browser" || !relevant.length) return false;
  const latest = Math.max(...relevant.map(row => row.createdAt.getTime()));
  return relevant.filter(row => row.createdAt.getTime() === latest).every(row => row.verdict === "accepted" && row.contextSha256 === run.contextSha256 && row.environmentSha256 === run.environmentSnapshot.environment_sha256);
}

import type { ActorScope } from "../auth/permissions";
import { shortlistService } from "./shortlist";
import { shortlistCounts } from "./presentation";

// One scoped batch shares the same freshness and adverse-source rules as the
// campaign workspace. Do not count superseded evaluations as actionable work.
export async function workspaceBoards(actor: ActorScope, campaignIds: string[]) {
  return process.env.EVALUATION_ENABLED === "true" && campaignIds.length ? shortlistService().boards(actor, campaignIds) : [];
}
export async function workspaceSummaries(actor: ActorScope, campaignIds: string[]) {
  return new Map((await workspaceBoards(actor, campaignIds)).map(board => [board.campaign_id, shortlistCounts(board.candidates)]));
}

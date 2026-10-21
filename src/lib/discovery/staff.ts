import type { ActorScope } from "../auth/permissions";
import type { DiscoveryActor } from "./service";
// A session actor can read/review. This never grants Work provenance or starts a run.
export const discoveryStaff = (actor: ActorScope): DiscoveryActor => ({ ...actor, principalId: actor.userId, executionSource: "manual_import", environmentSha256: "0".repeat(64) });

import { createHash } from "node:crypto";
import { z } from "zod";
export const PROBE_SCOPES = ["discovery:read", "discovery:probe"] as const;
export type ProbeScope = typeof PROBE_SCOPES[number];
export type ProbeIdentity = { issuer: string; subject: string; scopes: string[]; expiresAt: number };
export const capabilitiesInput = z.strictObject({ contract_version: z.literal(1) });
export const writeProbeInput = z.strictObject({ contract_version: z.literal(1), nonce: z.uuid(), idempotency_key: z.uuid() });
export const readProbeInput = z.strictObject({ contract_version: z.literal(1), probe_id: z.uuid() });
export function probeHash(nonce: string) { return createHash("sha256").update(JSON.stringify({ contract_version: 1, nonce: nonce.toLowerCase() })).digest("hex"); }
export class ProbeError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

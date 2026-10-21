import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "../db";
import { assetUploads, projectAssetVersions } from "../db/schema";
import type { AssetStorage } from "../storage/contracts";
import { uploadTmpDir } from "./receive";
const managedKey = /^eruty\/([a-f0-9-]{36})\/([a-f0-9-]{36})\/([a-f0-9-]{36})\/([a-f0-9-]{36})$/;
export async function cleanupUploads(storage: AssetStorage, now = new Date(), organizationId?: string) {
  const expired = await db.update(assetUploads).set({ state: "failed", failureCode: "expired", updatedAt: now }).where(and(inArray(assetUploads.state, ["pending", "receiving"]), lt(assetUploads.expiresAt, now), organizationId ? eq(assetUploads.organizationId, organizationId) : undefined)).returning({ id: assetUploads.id });
  let removedObjects = 0; let removedTemporaryFiles = 0;
  for (const object of await storage.list(organizationId ? `eruty/${organizationId}/` : "eruty/")) {
    const match = managedKey.exec(object.key); if (!match) continue;
    const [version] = await db.select().from(projectAssetVersions).where(eq(projectAssetVersions.objectPath, object.key));
    if (version && (!version.storageVersionId || version.storageVersionId === object.versionId)) continue;
    const [intent] = await db.select().from(assetUploads).where(eq(assetUploads.id, match[4]));
    if (intent && ["pending", "receiving"].includes(intent.state) && intent.expiresAt > now) continue;
    // Do not touch unknown recent writes, and never follow an arbitrary DB key.
    if ((!intent || intent.state === "completed") && object.modifiedAt.getTime() > now.getTime() - 24 * 60 * 60_000) continue;
    await storage.remove(object); removedObjects++;
  }
  for (const name of await readdir(uploadTmpDir()).catch(() => [] as string[])) {
    if (!/^[a-f0-9-]{36}\.tmp$/.test(name)) continue;
    const path = join(uploadTmpDir(), name); const info = await stat(path);
    if (info.isFile() && info.mtimeMs < now.getTime() - 60 * 60_000) { await unlink(path); removedTemporaryFiles++; }
  }
  return { expiredIntents: expired.length, removedObjects, removedTemporaryFiles };
}

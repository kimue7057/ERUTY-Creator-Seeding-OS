export type StoredObject = { key: string; versionId?: string };
export interface AssetStorage {
  putFile(key: string, path: string, mime: string, size: number, sha256: string, signal?: AbortSignal): Promise<StoredObject>;
  verify(object: StoredObject, size: number, sha256: string, signal?: AbortSignal): Promise<void>;
  remove(object: StoredObject): Promise<void>;
  signedRead(object: StoredObject, mime: string, name: string, inline: boolean, expiresIn: number): Promise<string>;
  list(prefix: string): Promise<{ key: string; versionId?: string; modifiedAt: Date }[]>;
}

import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { finished } from "node:stream/promises";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectVersionsCommand, GetBucketAclCommand, GetBucketPolicyCommand, GetBucketVersioningCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AssetStorage } from "./contracts";
export function storageConfigured() { return !!(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY); }
export function s3Settings() {
  if (!storageConfigured()) throw new Error("S3 storage is not configured");
  const endpoint = process.env.S3_ENDPOINT;
  if (endpoint && process.env.NODE_ENV === "production" && new URL(endpoint).protocol !== "https:") throw new Error("Production S3 endpoint requires HTTPS");
  return { bucket: process.env.S3_BUCKET!, client: new S3Client({ endpoint, region: process.env.S3_REGION ?? "us-east-1", forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true", credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" }) };
}
export function createS3Storage(): AssetStorage {
  const { bucket: Bucket, client } = s3Settings();
  async function privateBucket() {
    const [acl, versioning] = await Promise.all([client.send(new GetBucketAclCommand({ Bucket })), client.send(new GetBucketVersioningCommand({ Bucket }))]);
    if (acl.Grants?.some(g => g.Grantee?.URI) || versioning.Status !== "Enabled") throw new Error("Private ACL and bucket versioning are required");
    try { await client.send(new GetBucketPolicyCommand({ Bucket })); }
    catch (error) { if ((error as Error).name === "NoSuchBucketPolicy") return; throw error; }
    // Dedicated app buckets use credential/IAM permissions, never a bucket policy.
    throw new Error("Bucket policies are not permitted on this dedicated private asset bucket");
  }
  return {
    async putFile(Key, path, ContentType, ContentLength, sha256, signal) {
      await privateBucket();
      const body = createReadStream(path);
      try {
        const result = await client.send(new PutObjectCommand({ Bucket, Key, Body: body, ContentType, ContentLength, ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"), IfNoneMatch: "*" }), { abortSignal: signal });
        if (!result.VersionId) throw new Error("Storage did not return an immutable version ID");
        return { key: Key, versionId: result.VersionId };
      } finally { body.destroy(); await finished(body).catch(() => {}); }
    },
    async verify(object, size, sha256, signal) {
      const response = await client.send(new GetObjectCommand({ Bucket, Key: object.key, VersionId: object.versionId }), { abortSignal: signal });
      if (!response.Body || response.ContentLength !== size) throw new Error("Stored size mismatch");
      const hash = createHash("sha256"); let count = 0;
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) { count += chunk.length; if (count > size) throw new Error("Stored size exceeded"); hash.update(chunk); }
      if (count !== size || hash.digest("hex") !== sha256) throw new Error("Stored checksum mismatch");
    },
    async remove(object) { await client.send(new DeleteObjectCommand({ Bucket, Key: object.key, VersionId: object.versionId })); },
    async signedRead(object, mime, name, inline, expiresIn) {
      await privateBucket();
      const disposition = `${inline ? "inline" : "attachment"}; filename="download"; filename*=UTF-8''${encodeURIComponent(name).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`;
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: object.key, VersionId: object.versionId, ResponseContentType: mime, ResponseContentDisposition: disposition, ResponseCacheControl: "private, no-store, max-age=0" }), { expiresIn });
    },
    async list(Prefix) {
      const objects: { key: string; versionId?: string; modifiedAt: Date }[] = [];
      let KeyMarker: string | undefined; let VersionIdMarker: string | undefined;
      do {
        const page = await client.send(new ListObjectVersionsCommand({ Bucket, Prefix, KeyMarker, VersionIdMarker }));
        for (const item of [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]) if (item.Key && item.LastModified) objects.push({ key: item.Key, versionId: item.VersionId, modifiedAt: item.LastModified });
        KeyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
        VersionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
      } while (KeyMarker);
      return objects;
    },
  };
}

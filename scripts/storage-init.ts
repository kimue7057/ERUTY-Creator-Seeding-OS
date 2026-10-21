import "dotenv/config";
import { CreateBucketCommand, HeadBucketCommand, PutBucketVersioningCommand, GetBucketPolicyCommand, GetBucketAclCommand, PutPublicAccessBlockCommand } from "@aws-sdk/client-s3";
import { s3Settings } from "../src/lib/storage/s3";
const { bucket: Bucket, client } = s3Settings();
// Initialization is explicit and never runs while handling user requests.
try { await client.send(new HeadBucketCommand({ Bucket })); }
catch (error) {
  if ((error as { $metadata?: { httpStatusCode: number } }).$metadata?.httpStatusCode !== 404) throw error;
  await client.send(new CreateBucketCommand({ Bucket }));
}
// Refuse any existing policy instead of silently altering a possibly public bucket.
try { await client.send(new GetBucketPolicyCommand({ Bucket })); throw new Error("Use a dedicated private bucket without a bucket policy."); }
catch (error) { if (!["NoSuchBucketPolicy", "NotImplemented"].includes((error as Error).name)) throw error; }
const acl = await client.send(new GetBucketAclCommand({ Bucket }));
if (acl.Grants?.some(g => g.Grantee?.URI)) throw new Error("Bucket has a public/group ACL; use a private dedicated bucket.");
await client.send(new PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: "Enabled" } }));
try { await client.send(new PutPublicAccessBlockCommand({ Bucket, PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true } })); }
catch (error) { if ((error as Error).name !== "NotImplemented") throw error; console.log("Provider does not implement PublicAccessBlock; verifying anonymous bucket access below."); }
const endpoint = process.env.S3_ENDPOINT;
if (endpoint) {
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/${Bucket}`);
  if (response.status !== 403) throw new Error(`Anonymous bucket access must return 403; got ${response.status}`);
}
client.destroy();
console.log("Private bucket ready; versioning enabled and anonymous access denied.");

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { OutreachError } from "./contracts";
export const hashSecret = (value: string) => createHash("sha256").update(value).digest("hex");
function key(value = process.env.OUTREACH_ENCRYPTION_KEY) {
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) throw new OutreachError("not_configured");
  return Buffer.from(value, "hex");
}
export function seal(value: string, context: string, secret?: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
export function unseal(value: string, context: string, secret?: string) {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new OutreachError("reconnect");
  try {
    const cipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
    cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([cipher.update(Buffer.from(data, "base64url")), cipher.final()]).toString("utf8");
  } catch { throw new OutreachError("reconnect"); }
}

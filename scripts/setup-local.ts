import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
if (existsSync(".env")) throw new Error(".env already exists; it was not overwritten.");
mkdirSync(".local", { recursive: true });
const dbPassword = randomBytes(24).toString("hex");
const password = randomBytes(18).toString("base64url");
writeFileSync(".env", `DATABASE_URL=postgresql://eruty:${dbPassword}@127.0.0.1:55432/eruty\nAPP_ORIGIN=http://127.0.0.1:3000\nBOOTSTRAP_EMAIL=operator@example.invalid\nBOOTSTRAP_PASSWORD=${password}\n`, { mode: 0o600 });
console.log("Created ignored .env with random local credentials. Read BOOTSTRAP_PASSWORD locally to sign in.");

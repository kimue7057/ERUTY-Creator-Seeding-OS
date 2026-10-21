import "dotenv/config";
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
if (process.env.NODE_ENV === "production") throw new Error("Local storage helper is development only.");
const defaults: Record<string, string> = { S3_ENDPOINT: "http://127.0.0.1:9000", S3_REGION: "us-east-1", S3_BUCKET: "eruty-private-dev", S3_FORCE_PATH_STYLE: "true", S3_ACCESS_KEY_ID: randomBytes(12).toString("hex"), S3_SECRET_ACCESS_KEY: randomBytes(32).toString("hex") };
const missing = Object.entries(defaults).filter(([key]) => !process.env[key]);
if (missing.length) {
  if (process.env.CI) throw new Error("CI must supply explicit test storage settings.");
  await appendFile(".env", `\n${missing.map(([k, v]) => `${k}=${v}`).join("\n")}\n`, { mode: 0o600 });
  for (const [key, value] of missing) process.env[key] = value;
}
const endpoint = new URL(process.env.S3_ENDPOINT!);
if (endpoint.hostname !== "127.0.0.1") throw new Error("Local helper only binds a loopback S3 endpoint.");
const binary = resolve(`.local/bin/seaweedfs-4.48/${process.platform === "win32" ? "weed.exe" : "weed"}`);
if (!existsSync(binary)) throw new Error("Run storage:install first.");
await mkdir(".local/storage", { recursive: true });
const config = resolve(".local/storage/s3.json");
await writeFile(config, JSON.stringify({ identities: [{ name: "eruty-local", credentials: [{ accessKey: process.env.S3_ACCESS_KEY_ID, secretKey: process.env.S3_SECRET_ACCESS_KEY }], actions: ["Admin", "Read", "Write", "List", "Tagging"] }] }), { mode: 0o600 });
const child = spawn(binary, ["mini", `-dir=${resolve(".local/storage/data")}`, "-ip=127.0.0.1", "-ip.bind=127.0.0.1", `-s3.port=${endpoint.port}`, `-s3.config=${config}`, "-admin.ui=false", "-webdav=false", "-master.telemetry=false", "-s3.port.iceberg=0", "-s3.port.lance=0", "-volume.max=4", "-master.volumeSizeLimitMB=64"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
// Do not relay server startup logs: some storage servers print credential hints.
child.stdout?.on("data", () => {}); child.stderr?.on("data", () => {});
child.on("error", () => { console.error("Local S3 process failed to start."); process.exitCode = 1; });
child.on("exit", code => { console.log(`Local S3 stopped (${code ?? "signal"}).`); process.exitCode = code ?? 0; });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill("SIGTERM"));
process.on("exit", () => child.kill("SIGTERM"));
console.log(`Authenticated local S3 starting on ${endpoint.origin}. Keep this terminal open; run storage:init in another terminal.`);

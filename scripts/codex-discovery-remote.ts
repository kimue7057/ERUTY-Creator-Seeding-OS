// Portable worker: deliberately imports neither the database nor dotenv.
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { z } from "zod";
import { originalCapture, remoteCollection, submissionManifest, verifyRemoteCollection } from "../src/lib/discovery/browser-captures";
import { localBrowserAuthorization } from "../src/lib/discovery/local-browser";

const root = resolve(".local/discovery/codex-browser");
mkdirSync(root, { recursive: true });
const connectionFile = resolve(root, "remote-connection.private.json");
function privateFile(path: string) {
  const actual = realpathSync(resolve(path)), rel = relative(realpathSync(root), actual);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel) || !statSync(actual).isFile() || statSync(actual).size > 524288) throw new Error("Expected a bounded private capture file");
  return actual;
}
const read = (path: string): unknown => JSON.parse(readFileSync(privateFile(path), "utf8").replace(/^\uFEFF/, ""));
function origin(input: string) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Use the HTTPS dashboard origin");
  return url.origin;
}
const connectionSchema = z.strictObject({ origin: z.string(), token: z.string().regex(/^[a-f0-9]{64}$/), expires_at: z.iso.datetime() });
function save(path: string, value: unknown, immutable = true) {
  const text = JSON.stringify(value, null, 2);
  if (immutable && existsSync(path)) { if (readFileSync(path, "utf8") !== text) throw new Error("Private receipt already exists with different contents"); return; }
  writeFileSync(path, text, { flag: immutable ? "wx" : "w", mode: 0o600 });
}
async function call(base: string, action: string, input: unknown, token?: string) {
  const response = await fetch(`${origin(base)}/api/discovery/browser/${action}`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(60000), headers: { "content-type": "application/json", "x-eruty-discovery": "1", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
  const result = await response.json();
  if (!response.ok) throw new Error(`Remote worker failed (${response.status}): ${String(result.error ?? "unknown_error")}`);
  return result;
}

try {
  const [action, first, second, third] = process.argv.slice(2);
  if (action === "login") {
    const credentials = z.strictObject({ email: z.email(), password: z.string().min(1), organization_id: z.uuid().optional() }).parse(read(second));
    const base = origin(first), session = connectionSchema.parse({ origin: base, ...await call(base, "login", credentials) });
    save(connectionFile, session, false);
    console.log(JSON.stringify({ connected: true, origin: base, expires_at: session.expires_at, connection_file: relative(process.cwd(), connectionFile), browser_launched: false }));
  } else {
    const connection = connectionSchema.parse(read(connectionFile));
    if (Date.parse(connection.expires_at) <= Date.now()) throw new Error("Worker session expired; login again");
    let result: unknown;
    if (action === "requests" || action === "logout") result = await call(connection.origin, action, {}, connection.token);
    else if (action === "claim") {
      const id = z.uuid().parse(first), auth = await call(connection.origin, "claim", { request_id: id, browser_surface: second, execution_reference: third }, connection.token);
      const directory = resolve(root, "requests", id); mkdirSync(directory, { recursive: true });
      const rel = relative(realpathSync(root), realpathSync(directory)); if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Request directory escaped private root");
      const file = resolve(directory, "authorization.json"); save(file, localBrowserAuthorization.parse(auth));
      result = { request_id: id, authorization_file: relative(process.cwd(), file), max_creators: auth.max_creators, browser_launched: false };
    } else {
      const authorization = localBrowserAuthorization.parse(read(first));
      if (!("request_id" in authorization)) throw new Error("Remote workers require a dashboard request");
      let payload: unknown;
      if (action === "collect") {
        const input = z.strictObject({ prepare_key: z.uuid(), logs: z.array(z.record(z.string(), z.unknown())), observation: z.record(z.string(), z.unknown()).optional(), artifacts: z.array(z.strictObject({ kind: originalCapture.shape.kind, file: z.string(), sha256: originalCapture.shape.sha256 })).max(10).default([]) }).parse(read(second));
        const captures = input.artifacts.map(item => ({ kind: item.kind, sha256: item.sha256, content: readFileSync(privateFile(item.file), "utf8") }));
        const { artifacts: _artifacts, ...batch } = input; void _artifacts;
        payload = verifyRemoteCollection(remoteCollection.parse({ batch, captures }), authorization.platform, authorization.issued_at, authorization.expires_at);
      } else if (action === "submit") payload = submissionManifest.parse(read(second));
      else if (action !== "context") throw new Error("Use login, requests, claim, context, collect, submit or logout");
      result = await call(connection.origin, action, { authorization, ...(payload ? { payload } : {}) }, connection.token);
      if (action === "collect" || action === "submit") {
        const path = privateFile(second), data = read(second) as Record<string, unknown>;
        const key = action === "submit" ? data.submit_key : (data.observation as Record<string, unknown> | undefined)?.idempotency_key ?? (data.logs as Record<string, unknown>[])[0].idempotency_key;
        // A replay can include a later lock version; the first acknowledgement remains intact.
        const receipt = resolve(path, "..", `remote-${action}-receipt-${z.uuid().parse(key)}.json`);
        if (!existsSync(receipt)) save(receipt, { saved_at: new Date().toISOString(), read: result, hosted_work_called: false });
      }
    }
    console.log(JSON.stringify(result));
  }
} catch (error) {
  console.error(JSON.stringify({ failed: true, error: error instanceof Error && error.message.startsWith("Remote worker failed") ? error.message : "remote_worker_input_or_connection_error" }));
  process.exitCode = 1;
}

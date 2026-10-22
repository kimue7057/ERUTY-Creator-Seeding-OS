import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { parse } from "dotenv";
// Next forwards Node exec arguments to workers; --env-file is not supported in
// their NODE_OPTIONS. Load the private values into the child environment instead.
const values = parse(readFileSync(".local/discovery/dashboard.env", "utf8"));
const url = new URL(values.DATABASE_URL);
if (url.hostname !== "127.0.0.1" || url.port !== "55434" || url.pathname !== "/eruty_discovery_local" || url.username !== "eruty_discovery_dashboard" || values.APP_ORIGIN !== "http://127.0.0.1:3001") throw new Error("Dedicated loopback discovery dashboard configuration required");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3001"], { env: { ...process.env, ...values }, stdio: "inherit", windowsHide: true });
child.on("error", () => { console.error("Discovery dashboard failed to start"); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));

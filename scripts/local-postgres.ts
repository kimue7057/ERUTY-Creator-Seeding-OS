import "dotenv/config";
import { existsSync } from "node:fs";
import EmbeddedPostgres from "embedded-postgres";
const url = new URL(process.env.DATABASE_URL!);
if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Local helper requires a loopback DATABASE_URL.");
const pg = new EmbeddedPostgres({
  databaseDir: ".local/postgres", user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
  port: Number(url.port), persistent: true, authMethod: "scram-sha-256",
  initdbFlags: ["--encoding=UTF8", "--locale=C"], postgresFlags: ["-h", "127.0.0.1"],
});
if (!existsSync(".local/postgres/PG_VERSION")) await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
const name = url.pathname.slice(1);
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error("Unsafe database name");
const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
if (!rowCount) await pg.createDatabase(name);
await client.end();
console.log(`Local PostgreSQL ready on 127.0.0.1:${url.port}. Keep this terminal running; Ctrl+C stops it.`);
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await pg.stop(); process.exit(0); }
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await new Promise(() => {});

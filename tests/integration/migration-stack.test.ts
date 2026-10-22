import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migratePreservingHistory } from "../../src/lib/db/migrate";
import * as schema from "../../src/lib/db/schema";

test("stack migrations preserve both PR7 probe history and the older discovery branch history", async () => {
  const base = new URL(process.env.DATABASE_URL!);
  const admin = new Client({ connectionString: base.href }); await admin.connect();
  const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
  try {
    for (const baseline of ["empty", "probe", "discovery", "unknown"] as const) {
      const name = `eruty_stack_test_${randomUUID().replaceAll("-", "")}`;
      await admin.query(`CREATE DATABASE "${name}"`);
      const url = new URL(base); url.pathname = `/${name}`;
      const client = new Client({ connectionString: url.href }); await client.connect();
      try {
        await client.query("create schema drizzle; create table drizzle.__drizzle_migrations(id serial primary key, hash text not null, created_at bigint)");
        const indices = baseline === "empty" ? [] : baseline === "discovery" ? [0, 1, 2, 3, 5] : [0, 1, 2, 3, 4];
        for (const index of indices) {
          const migration = migrations[index];
          for (const statement of migration.sql) if (statement.trim()) await client.query(statement);
          await client.query("insert into drizzle.__drizzle_migrations(hash,created_at) values($1,$2)", [migration.hash, baseline === "discovery" && index === 5 ? 1792572345619 : migration.folderMillis]);
        }
        if (indices.length) await client.query("insert into organizations(name) values('SYNTHETIC migration preservation')");
        if (baseline === "unknown") await client.query("insert into drizzle.__drizzle_migrations(hash,created_at) values('unknown',1)");
        const before = (await client.query("select * from drizzle.__drizzle_migrations order by id")).rows;
        const database = drizzle(client, { schema });
        if (baseline === "unknown") {
          await assert.rejects(migratePreservingHistory(database), /Unknown migration hash/);
          assert.equal((await client.query("select to_regclass('public.discovery_runs') as name")).rows[0].name, null);
          continue;
        }
        await migratePreservingHistory(database);
        const after = (await client.query("select * from drizzle.__drizzle_migrations order by id")).rows;
        assert.deepEqual(after.slice(0, before.length), before);
        assert.equal((await client.query("select count(*)::int n from discovery_runs")).rows[0].n, 0);
        assert.equal((await client.query("select count(*)::int n from organizations")).rows[0].n, indices.length ? 1 : 0);
        assert.equal((await client.query("select count(*)::int n from pg_indexes where indexname='probe_principal_identity' and indexdef like '%WHERE%revoked_at%'")).rows[0].n, 1);
        await migratePreservingHistory(database);
        assert.deepEqual((await client.query("select * from drizzle.__drizzle_migrations order by id")).rows, after);
      } finally {
        await client.end();
        assert.match(name, /^eruty_stack_test_[a-f0-9]{32}$/);
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      }
    }
  } finally { await admin.end(); }
});

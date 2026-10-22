import { readMigrationFiles } from "drizzle-orm/migrator";
import { sql } from "drizzle-orm";
import type { db } from ".";

// Stacked pre-merge branches may already have applied the same SQL under an
// earlier timestamp. Match immutable SQL hashes, preserve every old history row,
// and append a journal marker instead of replaying DDL or rewriting history.
export async function migratePreservingHistory(database: Pick<typeof db, "transaction">) {
  const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
  await database.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(418704, 2)`);
    await tx.execute(sql`create schema if not exists drizzle`);
    await tx.execute(sql`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`);
    const history = await tx.execute<{ hash: string; created_at: string }>(sql`select hash, created_at from drizzle.__drizzle_migrations`);
    const known = new Set(migrations.map(m => m.hash));
    if (history.rows.some(row => !known.has(row.hash))) throw new Error("Unknown migration hash: preserve the database and reconcile the reviewed migration source first");
    const applied = new Set(history.rows.map(row => row.hash));
    const markers = new Set(history.rows.map(row => `${row.hash}:${row.created_at}`));
    for (const migration of migrations) {
      if (!applied.has(migration.hash)) {
        for (const statement of migration.sql) if (statement.trim()) await tx.execute(sql.raw(statement));
        applied.add(migration.hash);
      }
      if (!markers.has(`${migration.hash}:${migration.folderMillis}`)) {
        await tx.execute(sql`insert into drizzle.__drizzle_migrations(hash, created_at) values (${migration.hash}, ${migration.folderMillis})`);
      }
    }
  });
}

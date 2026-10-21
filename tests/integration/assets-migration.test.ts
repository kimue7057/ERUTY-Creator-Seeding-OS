import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
test("0002/0003 preserve legacy asset IDs/versions and frozen brief JSON without inventing file verification or probe enrollment", async () => {
  const originalUrl = new URL(process.env.DATABASE_URL!);
  const database = `eruty_migration_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: originalUrl.href }); await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  const testUrl = new URL(originalUrl); testUrl.pathname = `/${database}`;
  const client = new Client({ connectionString: testUrl.href });
  try {
    await client.connect();
    for (const path of ["drizzle/0000_slow_ravenous.sql", "drizzle/0001_dapper_bloodstrike.sql"]) await client.query(await readFile(path, "utf8"));
    const user = randomUUID(), org = randomUUID(), project = randomUUID(), asset = randomUUID(), secondAsset = randomUUID(), campaign = randomUUID();
    await client.query("BEGIN");
    await client.query("INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'synthetic','no-login')", [user, `${user}@example.invalid`]);
    await client.query("INSERT INTO organizations(id,name) VALUES($1,'synthetic migration')", [org]);
    await client.query("INSERT INTO projects(id,organization_id,name,created_by,updated_by) VALUES($1,$2,'synthetic',$3,$3)", [project, org, user]);
    for (const [id, version] of [[asset, 7], [secondAsset, 1]]) await client.query("INSERT INTO project_assets(id,organization_id,project_id,name,kind,object_path,version,provenance,created_by,updated_by) VALUES($1,$2,$3,'legacy.pdf','pdf','legacy/shared.pdf',$4,'{\"source\":\"legacy\",\"verificationStatus\":\"unverified\"}',$5,$5)", [id, org, project, version, user]);
    const snapshot = { version: 1, capturedAt: new Date().toISOString(), project: { id: project, name: "synthetic", website: "", summary: "", usp: "", brandStyle: "", referenceUrls: [] }, products: [], assets: [{ id: asset, name: "legacy.pdf", kind: "pdf", version: 7, objectPath: "legacy/shared.pdf" }, { id: secondAsset, name: "legacy.pdf", kind: "pdf", version: 1, objectPath: "legacy/shared.pdf" }] };
    await client.query("INSERT INTO campaigns(id,organization_id,project_id,title,country_codes,platforms,categories,follower_min,follower_max,goal_count,brief_snapshot,created_by,updated_by) VALUES($1,$2,$3,'synthetic',ARRAY['JP'],ARRAY['tiktok'],ARRAY['test'],1,10,1,$4,$5,$5)", [campaign, org, project, snapshot, user]);
    await client.query("INSERT INTO campaign_brief_revisions(organization_id,project_id,campaign_id,version,snapshot,created_by) VALUES($1,$2,$3,1,$4,$5)", [org, project, campaign, snapshot, user]);
    await client.query("COMMIT");
    await client.query(await readFile("drizzle/0002_dashing_bullseye.sql", "utf8"));
    const versions = await client.query("SELECT * FROM project_asset_versions ORDER BY version DESC");
    assert.equal(versions.rows.length, 2); assert.equal(versions.rows[0].asset_id, asset); assert.equal(versions.rows[0].version, 7);
    assert.ok(versions.rows.every(v => v.verification_status === "legacy_unverified" && v.sha256 === null && v.byte_size === null));
    assert.deepEqual((await client.query("SELECT brief_snapshot FROM campaigns WHERE id=$1", [campaign])).rows[0].brief_snapshot, snapshot);
    assert.deepEqual((await client.query("SELECT snapshot FROM campaign_brief_revisions WHERE campaign_id=$1", [campaign])).rows[0].snapshot, snapshot);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM campaign_asset_references")).rows[0].count, 2);
    await client.query(await readFile("drizzle/0003_short_lucky_pierre.sql", "utf8"));
    assert.equal((await client.query("SELECT count(*)::int AS count FROM discovery_probe_workspaces")).rows[0].count, 0);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM discovery_probes")).rows[0].count, 0);
    assert.deepEqual((await client.query("SELECT brief_snapshot FROM campaigns WHERE id=$1", [campaign])).rows[0].brief_snapshot, snapshot);
    assert.deepEqual((await client.query("SELECT snapshot FROM campaign_brief_revisions WHERE campaign_id=$1", [campaign])).rows[0].snapshot, snapshot);
    assert.equal((await client.query("SELECT version FROM project_asset_versions WHERE asset_id=$1", [asset])).rows[0].version, 7);
  } finally {
    await client.end();
    // The generated database name is fixed-prefix UUID data, never a supplied DB name.
    assert.match(database, /^eruty_migration_[a-f0-9]{32}$/);
    await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`); await admin.end();
  }
});

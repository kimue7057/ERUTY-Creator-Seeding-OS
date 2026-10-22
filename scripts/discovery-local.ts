import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parse } from "dotenv";
import { Client } from "pg";
const folder = ".local/discovery";
const save = (name: string, value: unknown) => writeFileSync(`${folder}/${name}`, typeof value === "string" ? value : JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
try {
  const action = process.argv[2];
  if (action === "prepare") {
    if (existsSync(`${folder}/operator.env`)) throw new Error("Existing environment must be preserved");
    const tunnel = readFileSync(`${folder}/tunnel-id.txt`, "utf8").trim();
    if (!/^tunnel_[A-Za-z0-9_-]{8,128}$/.test(tunnel)) throw new Error("Provide the actual separate Discovery tunnel ID");
    const probe = parse(readFileSync(".local/mcp-staging/.env", "utf8"));
    const user = JSON.parse(readFileSync(".local/mcp-local-e2e/oauth-user.json", "utf8"));
    const build = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (!/^[a-f0-9]{40}$/.test(build) || execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim()) throw new Error("Commit and review the execution code before preparing its environment hash");
    const organization = randomUUID(), operator = randomUUID();
    const passwords = Object.fromEntries(["owner", "runtime", "verifier", "dashboard"].map(name => [name, randomBytes(32).toString("hex")]));
    const resource = new URL(probe.MCP_RESOURCE_URL); resource.pathname = `/v1/mcp/${tunnel}`;
    const config = { MCP_SERVER_MODE: "discovery", MCP_RESOURCE_URL: resource.href, MCP_RESOURCE_HOST: resource.host, MCP_OAUTH_ISSUER: probe.MCP_OAUTH_ISSUER, MCP_OAUTH_JWKS_URL: probe.MCP_OAUTH_JWKS_URL, MCP_BUILD_SHA: build, MCP_DISCOVERY_ORGANIZATION_ID: organization, MCP_DISCOVERY_OPERATOR_USER_ID: operator, MCP_DISCOVERY_SUBJECT: user.subject, MCP_DISCOVERY_CLIENT_ID: "eruty-work-discovery" };
    const lines = (values: Record<string, string>) => Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    save("compose.env", lines({ ...config, POSTGRES_PASSWORD: passwords.owner, MCP_RUNTIME_PASSWORD: passwords.runtime }));
    save("operator.env", lines({ ...config, DATABASE_URL: `postgresql://discovery_owner:${passwords.owner}@127.0.0.1:55434/eruty_discovery_local`, MCP_DISCOVERY_VERIFIER_DATABASE_URL: `postgresql://eruty_discovery_verifier:${passwords.verifier}@127.0.0.1:55434/eruty_discovery_local` }));
    save("dashboard.env", lines({ DATABASE_URL: `postgresql://eruty_discovery_dashboard:${passwords.dashboard}@127.0.0.1:55434/eruty_discovery_local`, APP_ORIGIN: "http://127.0.0.1:3001" }));
    save("passwords.json", passwords);
    save("connection.json", { tunnel_id: tunnel, profile: "eruty-discovery-local", target: "http://127.0.0.1:3311/mcp" });
    save("dashboard-user.json", { email: `discovery-${operator}@example.invalid`, password: randomBytes(24).toString("base64url"), user_id: operator });
    console.log("Private Discovery environment created; existing Probe files unchanged. No credentials printed.");
  } else if (action === "init") {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "127.0.0.1" || url.port !== "55434" || url.pathname !== "/eruty_discovery_local" || url.username !== "discovery_owner" || existsSync(`${folder}/setup-receipt.json`)) throw new Error("Fresh dedicated Discovery database required; never reinitialize an existing setup");
    const client = new Client({ connectionString: url.href }); await client.connect();
    try {
      const tables = await client.query("select tablename from pg_tables where schemaname='public'");
      if (tables.rowCount) throw new Error("Refusing existing public tables");
      const { db, pool } = await import("../src/lib/db");
      try {
        const { migratePreservingHistory } = await import("../src/lib/db/migrate");
        const schema = await import("../src/lib/db/schema");
        const { hashPassword } = await import("../src/lib/auth/password");
        const { saveProject, saveProduct } = await import("../src/lib/projects/service");
        const { saveCampaign } = await import("../src/lib/campaigns/service");
        await migratePreservingHistory(db);
        const user = JSON.parse(readFileSync(`${folder}/dashboard-user.json`, "utf8"));
        const organization = process.env.MCP_DISCOVERY_ORGANIZATION_ID!;
        await db.transaction(async tx => {
          await tx.insert(schema.organizations).values({ id: organization, name: "ERUTY Discovery Local Validation" });
          await tx.insert(schema.users).values({ id: user.user_id, email: user.email, name: "Local discovery operator", passwordHash: hashPassword(user.password) });
          await tx.insert(schema.memberships).values({ organizationId: organization, userId: user.user_id, role: "admin" });
        });
        const actor = { organizationId: organization, userId: user.user_id, role: "admin" as const };
        const project = await saveProject(actor, { name: "YouTube 일본 직접 발굴 실증", website: "", summary: "Isolated local test project. No operational brand assets. Work evidence awaits operator review.", usp: "", brandStyle: "", referenceUrls: [] });
        const product = await saveProduct(actor, project.id, { name: "실증용 가상 인테리어 제품", features: "Synthetic test campaign context only", url: "" });
        const campaign = await saveCampaign(actor, { projectId: project.id, productIds: [product.id], title: "일본 YouTube 라이프스타일·인테리어 실증", countryCodes: ["JP"], platforms: ["youtube"], categories: ["라이프스타일", "인테리어"], followerMin: 10000, followerMax: 100000, goalCount: 5, notes: "Use existing private Work search evidence. Do not invent observations or repeat SNS discovery. Rounded counts remain rounded; video-page visits not proven in the Work trace remain unconfirmed.", exclusions: "No operational data, email/DM, or synthetic Probe writes", budget: null, currency: "JPY", startsOn: null, endsOn: null, status: "ready" });
        const passwords = JSON.parse(readFileSync(`${folder}/passwords.json`, "utf8"));
        await client.query("BEGIN");
        try {
          for (const name of ["runtime", "verifier", "dashboard"]) {
            const role = `eruty_discovery_${name}`;
            if (!/^[a-f0-9]{64}$/.test(passwords[name])) throw new Error("Invalid generated password");
            await client.query(`CREATE ROLE ${role} LOGIN PASSWORD '${passwords[name]}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 12`);
            await client.query(`GRANT CONNECT ON DATABASE eruty_discovery_local TO ${role}; GRANT USAGE ON SCHEMA public TO ${role}; ALTER ROLE ${role} SET statement_timeout='8s'; ALTER ROLE ${role} SET lock_timeout='5s'`);
          }
          await client.query("REVOKE ALL ON DATABASE eruty_discovery_local FROM PUBLIC; REVOKE ALL ON SCHEMA public FROM PUBLIC; REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC");
          await client.query(readFileSync("staging/discovery/runtime-grants.sql", "utf8"));
          await client.query("GRANT SELECT ON discovery_runs,discovery_requests,discovery_evidence,discovery_logs,creator_accounts,campaign_creators,discovery_mcp_grants,discovery_grant_campaigns,discovery_capability_receipts,audit_events TO eruty_discovery_verifier; GRANT SELECT ON ALL TABLES IN SCHEMA public TO eruty_discovery_dashboard; GRANT INSERT,UPDATE,DELETE ON sessions,login_attempts TO eruty_discovery_dashboard; GRANT INSERT ON audit_events,discovery_evidence_reviews,discovery_logs TO eruty_discovery_dashboard; GRANT UPDATE(status,reviewed_at,ended_at,outcome_summary,lock_version,updated_by,updated_at) ON discovery_runs TO eruty_discovery_dashboard; GRANT UPDATE(discovery_state,updated_by,updated_at) ON campaign_creators TO eruty_discovery_dashboard; GRANT UPDATE(updated_at) ON organization_memberships,campaigns TO eruty_discovery_dashboard");
          await client.query("COMMIT");
        } catch (error) { await client.query("ROLLBACK"); throw error; }
        save("setup-receipt.json", { organization_id: organization, operator_user_id: user.user_id, project_id: project.id, campaign_id: campaign.id, platform: "youtube", dashboard_url: `http://127.0.0.1:3001/campaigns/${campaign.id}/discovery`, creator_observations: 0, work_connection: "unverified" });
        console.log("Isolated project/campaign and restricted runtime/verifier/dashboard roles created. No creator observations inserted.");
      } finally { await pool.end(); }
    } finally { await client.end(); }
  } else throw new Error("Use prepare or init");
} catch { console.error("Discovery local setup failed; preserve existing files/database and inspect the failed stage privately. No credentials or provider bodies printed."); process.exitCode = 1; }

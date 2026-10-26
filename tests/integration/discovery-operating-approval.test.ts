import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { withDiscoveryDatabase, sqlFailure } from "../discovery-fixture";
import { memberships } from "../../src/lib/db/schema";
import { discoveryOperatingApprovals as approvals, discoveryOperatingCampaigns as allowed, discoveryMcpGrants } from "../../src/lib/db/discovery-schema";
import { approveDiscoveryOperation, revokeDiscoveryOperation } from "../../src/lib/discovery/operating-approval";
import { discoveryAccess } from "../../src/lib/discovery/mcp-access";
import { discoveryEnvironmentHash, discoveryMcpConfig, DISCOVERY_SCOPES } from "../../src/lib/discovery/mcp-config";
import { provisionDiscoveryGrant } from "../../src/lib/discovery/provision";
import { discoveryService } from "../../src/lib/discovery/service";
import { prepareSample } from "../discovery-samples";
import { DiscoveryError } from "../../src/lib/discovery/contracts";
import { assertDiscoveryRuntimeRole } from "../../src/lib/discovery/runtime-role";
import { safeFailure } from "../../src/lib/probe/diagnostics";
import * as baseSchema from "../../src/lib/db/schema";
import { createServer } from "node:http";
import { once } from "node:events";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createDiscoveryHttpServer } from "../../src/lib/discovery/mcp";
const code = (name: string) => (error: unknown) => error instanceof DiscoveryError && error.code === name;
const configFor = (organizationId: string) => discoveryMcpConfig({ NODE_ENV: "test", MCP_RESOURCE_URL: "https://synthetic.example.invalid/mcp", MCP_OAUTH_ISSUER: "https://synthetic-idp.example.invalid/", MCP_OAUTH_JWKS_URL: "https://synthetic-idp.example.invalid/jwks", MCP_DISCOVERY_ORGANIZATION_ID: organizationId, MCP_BUILD_SHA: "d15c0a1", MCP_DISCOVERY_OPERATING_APPROVALS: "true" });
const inputFor = (organizationId: string, userId: string, campaignId: string) => {
  const config = configFor(organizationId);
  return { organization_id: organizationId, user_id: userId, approved_by: userId, issuer: config.issuer, subject: "synthetic-operating-user", resource: config.resource,
    environment_sha256: discoveryEnvironmentHash(config), campaign_ids: [campaignId], scopes: [...DISCOVERY_SCOPES], expires_at: new Date(Date.now() + 6 * 86400000).toISOString(),
    reason: "SYNTHETIC isolated authorization regression; no hosted Work or SNS", idempotency_key: randomUUID(), confirmation: "approve-bounded-discovery-operation" };
};
const identityFor = (organizationId: string) => ({ issuer: configFor(organizationId).issuer, subject: "synthetic-operating-user", scopes: [...DISCOVERY_SCOPES], expiresAt: Date.now() / 1000 + 300 });

test("operating approval is explicit, admin/campaign scoped, bounded and concurrently idempotent; history cannot be extended or deleted", async () => {
  await withDiscoveryDatabase(async ({ database, client, actor, other, reader, campaign }) => {
    const a = await campaign(), foreign = await campaign(other), config = configFor(actor.organizationId), input = inputFor(actor.organizationId, actor.userId, a.id);
    await assert.rejects(approveDiscoveryOperation(input, { ...config, operatingApprovalsEnabled: false }, database), code("approval_environment_mismatch"));
    await assert.rejects(approveDiscoveryOperation({ ...input, approved_by: reader.userId }, config, database), code("approval_admin_required"));
    await assert.rejects(approveDiscoveryOperation({ ...input, campaign_ids: [foreign.id] }, config, database), code("not_found_or_forbidden"));
    await assert.rejects(approveDiscoveryOperation({ ...input, expires_at: new Date(Date.now() + 8 * 86400000).toISOString() }, config, database), code("approval_invalid_lifetime"));
    await assert.rejects(approveDiscoveryOperation({ ...input, resource: "https://other.invalid/mcp" }, config, database), code("approval_environment_mismatch"));
    await assert.rejects(approveDiscoveryOperation({ ...input, user_id: reader.userId }, config, database), code("role_forbidden"));
    const [created, replay] = await Promise.all([approveDiscoveryOperation(input, config, database), approveDiscoveryOperation(input, config, database)]);
    assert.equal(created.approval_id, replay.approval_id); assert.notEqual(created.replayed, replay.replayed);
    assert.equal((await client.query("select count(*)::int n from audit_events where action='discovery.operating_approval_created'")).rows[0].n, 1);
    assert.equal((await client.query("select count(*)::int n from discovery_mcp_grants")).rows[0].n, 0);
    assert.equal((await client.query("select count(*)::int n from discovery_capability_receipts")).rows[0].n, 0);
    await assert.rejects(approveDiscoveryOperation({ ...input, scopes: ["discovery:read"] }, config, database), code("idempotency_conflict"));
    await assert.rejects(approveDiscoveryOperation({ ...input, idempotency_key: randomUUID() }, config, database), code("approval_already_active"));
    await assert.rejects(database.update(approvals).set({ expiresAt: new Date(Date.now() + 9 * 86400000) }).where(eq(approvals.id, created.approval_id)), sqlFailure("23514"));
    await assert.rejects(database.update(approvals).set({ scopes: ["discovery:read"] }).where(eq(approvals.id, created.approval_id)), sqlFailure("23514"));
    await assert.rejects(database.delete(allowed).where(eq(allowed.approvalId, created.approval_id)), sqlFailure("23514"));
    await assert.rejects(database.delete(approvals).where(eq(approvals.id, created.approval_id)), sqlFailure("23514"));
    await revokeDiscoveryOperation({ organizationId: actor.organizationId, actorId: actor.userId, approvalId: created.approval_id }, database);
    await revokeDiscoveryOperation({ organizationId: actor.organizationId, actorId: actor.userId, approvalId: created.approval_id }, database);
    assert.equal((await approveDiscoveryOperation(input, config, database)).revoked, true);
    await assert.rejects(database.update(approvals).set({ revokedAt: null }).where(eq(approvals.id, created.approval_id)), sqlFailure("23514"));
    assert.equal((await client.query("select count(*)::int n from audit_events where action='discovery.operating_approval_revoked'")).rows[0].n, 1);
  });
});

test("concurrent reuse of one approval key with different principals returns an idempotency conflict and one audited approval", async () => {
  await withDiscoveryDatabase(async ({ database, client, actor, campaign }) => {
    const a = await campaign(), config = configFor(actor.organizationId), input = inputFor(actor.organizationId, actor.userId, a.id);
    const outcomes = await Promise.allSettled([approveDiscoveryOperation(input, config, database), approveDiscoveryOperation({ ...input, subject: "different-synthetic-principal" }, config, database)]);
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
    const failure = outcomes.find(result => result.status === "rejected") as PromiseRejectedResult;
    assert.ok(code("idempotency_conflict")(failure.reason));
    assert.equal((await client.query("select count(*)::int n from discovery_operating_approvals")).rows[0].n, 1);
    assert.equal((await client.query("select count(*)::int n from audit_events where action='discovery.operating_approval_created'")).rows[0].n, 1);
  });
});

test("each operating call rechecks OAuth expiry/scope, membership, campaign, environment and pinned revocation; capability gates remain", async () => {
  await withDiscoveryDatabase(async ({ database, actor, campaign }) => {
    const a = await campaign(), b = await campaign(), config = configFor(actor.organizationId), input = inputFor(actor.organizationId, actor.userId, a.id), identity = identityFor(actor.organizationId);
    const approved = await approveDiscoveryOperation(input, config, database), access = discoveryAccess(config, database), who = await access.actor(identity);
    const service = discoveryService(database);
    assert.equal((await service.getContext(who, { contract_version: 1, campaign_id: a.id })).campaign_id, a.id);
    await assert.rejects(service.getContext(who, { contract_version: 1, campaign_id: b.id }), code("not_found_or_forbidden"));
    await assert.rejects(access.actor({ ...identity, expiresAt: 1 }), code("invalid_token"));
    await assert.rejects(access.actor({ ...identity, scopes: [] }), code("insufficient_scope"));
    await assert.rejects(discoveryAccess({ ...config, build: "d15c0a2" }, database).actor(identity), code("approval_environment_mismatch"));
    await assert.rejects(discoveryAccess({ ...config, resource: "https://other.invalid/mcp" }, database).actor(identity), code("approval_environment_mismatch"));
    await assert.rejects(service.prepare(who, { ...prepareSample(a.id), execution_source: "work_manual_task", work_task_reference: "SYNTHETIC; no Work trace" }), code("unverified_capability"));
    await database.update(memberships).set({ role: "reviewer" }).where(eq(memberships.userId, actor.userId));
    await assert.rejects(database.transaction(tx => who.reauthorize!(tx, a.id, "discovery:observe")), code("role_forbidden"));
    await database.update(memberships).set({ role: "admin" }).where(eq(memberships.userId, actor.userId));
    await revokeDiscoveryOperation({ organizationId: actor.organizationId, actorId: actor.userId, approvalId: approved.approval_id }, database);
    await assert.rejects(service.getContext(who, { contract_version: 1, campaign_id: a.id }), code("approval_revoked"));
    const replacement = await approveDiscoveryOperation({ ...input, idempotency_key: randomUUID() }, config, database);
    assert.notEqual(replacement.approval_id, approved.approval_id);
    await assert.rejects(service.getContext(who, { contract_version: 1, campaign_id: a.id }), code("approval_revoked"));
    assert.equal((await access.actor(identity)).principalId, replacement.approval_id);
  });
});

test("expired approvals require new admin approval and never fall back to a legacy grant or request OAuth login", async () => {
  await withDiscoveryDatabase(async ({ database, client, actor, campaign }) => {
    const a = await campaign(), config = configFor(actor.organizationId), input = inputFor(actor.organizationId, actor.userId, a.id), identity = identityFor(actor.organizationId);
    await client.query("insert into discovery_operating_approvals(organization_id,user_id,approved_by,issuer,subject,resource,environment_sha256,scopes,reason,idempotency_key,payload_sha256,created_at,expires_at) values($1,$2,$2,$3,$4,$5,$6,$7,'Synthetic historical approval',$8,$9,now()-interval '2 days',now()-interval '1 day')",[actor.organizationId,actor.userId,config.issuer,identity.subject,config.resource,discoveryEnvironmentHash(config),[...DISCOVERY_SCOPES],randomUUID(),"a".repeat(64)]);
    const grant = await provisionDiscoveryGrant({ organization_id: actor.organizationId, user_id: actor.userId, issuer: config.issuer, subject: identity.subject, environment_sha256: discoveryEnvironmentHash(config), execution_source: "work_manual_task", campaign_ids: [a.id], scopes: [...DISCOVERY_SCOPES], expires_at: new Date(Date.now()+3600000).toISOString(), confirmation: "create-explicit-discovery-campaign-grant" }, database);
    await assert.rejects(discoveryAccess(config,database).actor(identity), code("approval_expired"));
    const failure=safeFailure(new DiscoveryError(403,"approval_expired"));assert.equal(failure.retryable,false);assert.equal(failure.reauthenticate,false);
    assert.match(failure.recovery,/administrator/);
    const next=await approveDiscoveryOperation(input,config,database);assert.ok(next.approval_id);
    assert.equal((await database.select().from(discoveryMcpGrants))[0].id,grant.grant_id);
    assert.equal((await database.select().from(approvals)).length,2);
  });
});

test("restricted MCP runtime can read an approval but cannot issue, widen, revoke or renew it", async () => {
  await withDiscoveryDatabase(async ({ database, client, actor, campaign }) => {
    const a=await campaign(), config=configFor(actor.organizationId), input=inputFor(actor.organizationId,actor.userId,a.id);
    await approveDiscoveryOperation(input,config,database);
    const role=`operating_test_${randomUUID().replaceAll('-','')}`, password=randomBytes(32).toString('hex');
    await client.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    let pool:pg.Pool|undefined;
    try {
      await client.query((await readFile('staging/discovery/runtime-grants.sql','utf8')).replaceAll('eruty_discovery_runtime',role));
      const url=new URL(process.env.DATABASE_URL!);url.pathname=`/${(await client.query('select current_database() name')).rows[0].name}`;url.username=role;url.password=password;
      pool=new pg.Pool({connectionString:url.href,max:2});await assertDiscoveryRuntimeRole(pool,true);
      const runtime=drizzle(pool,{schema:baseSchema}), who=await discoveryAccess(config,runtime).actor(identityFor(actor.organizationId));
      assert.equal((await discoveryService(runtime).getContext(who,{contract_version:1,campaign_id:a.id})).campaign_id,a.id);
      await assert.rejects(pool.query("update discovery_operating_approvals set revoked_at=now()"),(e:unknown)=>(e as {code:string}).code==='42501');
      await assert.rejects(pool.query("update discovery_operating_approvals set expires_at=now()+interval '7 days'"),(e:unknown)=>(e as {code:string}).code==='42501');
      await assert.rejects(approveDiscoveryOperation({...input,idempotency_key:randomUUID(),subject:'runtime-cannot-self-enroll'},config,runtime));
      await client.query(`GRANT UPDATE(revoked_at) ON discovery_operating_approvals TO "${role}"`);
      await assert.rejects(assertDiscoveryRuntimeRole(pool,true),/administrator-managed/);
    } finally {await pool?.end();await client.query(`REASSIGN OWNED BY "${role}" TO CURRENT_USER; DROP OWNED BY "${role}"; DROP ROLE "${role}"`);}
  });
});

test("operating read approval returns real SDK structuredContent; missing scope and revocation stay safe errors, JWT validation remains", async () => {
  await withDiscoveryDatabase(async ({ database, actor, campaign }) => {
    const keys=await generateKeyPair("ES256"), jwk={...await exportJWK(keys.publicKey),kid:"synthetic-operating",alg:"ES256",use:"sig"};
    const idp=createServer((_req,res)=>{res.setHeader("Content-Type","application/json");res.end(JSON.stringify({keys:[jwk]}));});
    idp.listen(0,"127.0.0.1");await once(idp,"listening");
    const issuer=`http://127.0.0.1:${(idp.address() as {port:number}).port}/`;
    const config=discoveryMcpConfig({NODE_ENV:"test",MCP_RESOURCE_URL:"http://127.0.0.1:3100/mcp",MCP_OAUTH_ISSUER:issuer,MCP_OAUTH_JWKS_URL:`${issuer}jwks`,MCP_DISCOVERY_ORGANIZATION_ID:actor.organizationId,MCP_DISCOVERY_OPERATING_APPROVALS:"true",MCP_BUILD_SHA:"d15c0a1"});
    const server=createDiscoveryHttpServer(config,()=>{},database);server.listen(0,"127.0.0.1");await once(server,"listening");
    const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    config.resource=`${origin}/mcp`;config.allowedHost=new URL(origin).host;config.metadataUrl=`${origin}/.well-known/oauth-protected-resource/mcp`;config.allowedOrigins.clear();config.allowedOrigins.add(origin);
    const sdk=new Client({name:"synthetic-operating-regression-not-hosted-work",version:"1.0.0"});
    const structured=(result:Awaited<ReturnType<Client["callTool"]>>)=>result.structuredContent as Record<string,unknown>;
    const token=async (audience=config.resource,expiry=Math.floor(Date.now()/1000)+300)=>new SignJWT({scope:DISCOVERY_SCOPES.join(" ")}).setProtectedHeader({alg:"ES256",kid:jwk.kid}).setIssuer(issuer).setSubject("synthetic-operating-user").setAudience(audience).setIssuedAt().setExpirationTime(expiry).sign(keys.privateKey);
    try {
      const a=await campaign(), b=await campaign();
      const input={...inputFor(actor.organizationId,actor.userId,a.id),issuer,resource:config.resource,environment_sha256:discoveryEnvironmentHash(config),scopes:["discovery:read"]};
      const approved=await approveDiscoveryOperation(input,config,database);
      for(const jwt of [await token("https://wrong.invalid/mcp"),await token(config.resource,1)]) {
        const denied=await fetch(config.resource,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${jwt}`},body:"{}"});assert.equal(denied.status,401);
      }
      await sdk.connect(new StreamableHTTPClientTransport(new URL(config.resource),{requestInit:{headers:{Authorization:`Bearer ${await token()}`}}}));
      assert.equal((await sdk.listTools()).tools.length,6);
      const result=await sdk.callTool({name:"get_campaign_discovery_context",arguments:{contract_version:1,campaign_id:a.id}});
      assert.equal(result.isError,undefined);assert.equal(structured(result).campaign_id,a.id);assert.equal(structured(result).work_connection,"unverified");
      const denied=await sdk.callTool({name:"prepare_discovery_run",arguments:{...prepareSample(a.id),execution_source:"work_manual_task",work_task_reference:"SYNTHETIC no Work trace"}});
      assert.equal(denied.isError,true);assert.equal(structured(denied).error,"approval_scope_denied");
      assert.equal((await sdk.callTool({name:"get_campaign_discovery_context",arguments:{contract_version:1,campaign_id:b.id}})).isError,true);
      await revokeDiscoveryOperation({organizationId:actor.organizationId,actorId:actor.userId,approvalId:approved.approval_id},database);
      const revoked=await sdk.callTool({name:"get_campaign_discovery_context",arguments:{contract_version:1,campaign_id:a.id}});
      assert.equal(revoked.isError,true);assert.equal(structured(revoked).error,"approval_revoked");assert.equal(structured(revoked).retryable,false);assert.equal(revoked._meta?.["mcp/www_authenticate"],undefined);assert.ok(structured(revoked).request_id);
    } finally {
      await sdk.close().catch(()=>{});server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));idp.closeAllConnections();await new Promise<void>(resolve=>idp.close(()=>resolve()));
    }
  });
});

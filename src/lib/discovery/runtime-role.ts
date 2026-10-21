import type { Pool } from "pg";
export async function assertDiscoveryRuntimeRole(database: Pick<Pool, "query">) {
  const { rows: [permissions] } = await database.query(`select
    (select rolsuper or rolcreatedb or rolcreaterole or rolbypassrls from pg_roles where rolname=current_user) as elevated,
    has_schema_privilege(current_user,'public','CREATE') as can_create,
    has_any_column_privilege(current_user,'users','SELECT') or has_any_column_privilege(current_user,'sessions','SELECT') or has_any_column_privilege(current_user,'project_asset_versions','SELECT') as can_read_unrelated_data,
    has_table_privilege(current_user,'discovery_capability_receipts','INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege(current_user,'discovery_evidence_reviews','INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege(current_user,'discovery_mcp_grants','INSERT,DELETE,TRUNCATE') or has_table_privilege(current_user,'discovery_grant_campaigns','INSERT,UPDATE,DELETE,TRUNCATE')
    or exists(select 1 from unnest(array['issuer','subject','user_id','organization_id','scopes','environment_sha256','execution_source','expires_at','revoked_at']) name where has_column_privilege(current_user,'discovery_mcp_grants',name,'UPDATE')) as can_authorize,
    has_column_privilege(current_user,'discovery_runs','reviewed_at','UPDATE') or has_column_privilege(current_user,'discovery_runs','ended_at','UPDATE') as can_review_run,
    has_table_privilege(current_user,'discovery_evidence','UPDATE,DELETE,TRUNCATE') or has_table_privilege(current_user,'discovery_requests','UPDATE,DELETE,TRUNCATE') as can_overwrite_history,
    has_table_privilege(current_user,'discovery_runs','INSERT') and has_table_privilege(current_user,'discovery_evidence','INSERT') and has_table_privilege(current_user,'discovery_requests','INSERT') and has_table_privilege(current_user,'audit_events','INSERT') as can_record`);
  if (!permissions?.can_record || Object.entries(permissions).some(([key, value]) => key !== "can_record" && value === true)) throw new Error("Dedicated least-privilege discovery runtime role required");
}

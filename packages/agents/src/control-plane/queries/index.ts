/**
 * Barrel of typed Reylo SQL queries for `control-plane`.
 *
 * @module
 */
import getAgentById from './get_agent_by_id.sql'
import getAgentByObjectName from './get_agent_by_object_name.sql'
import getAgentBySlug from './get_agent_by_slug.sql'
import getAuditByOpId from './get_audit_by_op_id.sql'
import getConfigVersion from './get_config_version.sql'
import getSetting from './get_setting.sql'
import getUsageFreshness from './get_usage_freshness.sql'
import getUsageIngestion from './get_usage_ingestion.sql'
import insertAgent from './insert_agent.sql'
import insertAudit from './insert_audit.sql'
import insertAuditIgnore from './insert_audit_ignore.sql'
import insertCommitMcpFenceAgentAssignment from './insert_commit_mcp_fence_agent_assignment.sql'
import insertConfigVersion from './insert_config_version.sql'
import insertSettingIgnore from './insert_setting_ignore.sql'
import insertSettingUpsert from './insert_setting_upsert.sql'
import insertUsageDailyUpsert from './insert_usage_daily_upsert.sql'
import insertUsageIngestionIgnore from './insert_usage_ingestion_ignore.sql'
import listAgents from './list_agents.sql'
import listAgentsAfterCursor from './list_agents_after_cursor.sql'
import listAgentsByPrefix from './list_agents_by_prefix.sql'
import listAgentsForReconcile from './list_agents_for_reconcile.sql'
import listAgentsForReconcileWrap from './list_agents_for_reconcile_wrap.sql'
import listAgentsWrap from './list_agents_wrap.sql'
import listAudit from './list_audit.sql'
import listConfigVersions from './list_config_versions.sql'
import listDiscoverAgents from './list_discover_agents.sql'
import listUsageByAgent from './list_usage_by_agent.sql'
import listUsageByCredential from './list_usage_by_credential.sql'
import listUsageByDay from './list_usage_by_day.sql'
import listUsageByModel from './list_usage_by_model.sql'
import updateActivateAgent from './update_activate_agent.sql'
import updateAdvanceDesiredVersion from './update_advance_desired_version.sql'
import updateRenameAgent from './update_rename_agent.sql'
import updateReportAppliedVersion from './update_report_applied_version.sql'
import updateUsageIngestion from './update_usage_ingestion.sql'

/** Typed SQL queries owned by `control-plane`. */
export const queries = {
  getAgentById,
  getAgentByObjectName,
  getAgentBySlug,
  getAuditByOpId,
  getConfigVersion,
  getSetting,
  getUsageFreshness,
  getUsageIngestion,
  insertAgent,
  insertAudit,
  insertAuditIgnore,
  insertCommitMcpFenceAgentAssignment,
  insertConfigVersion,
  insertSettingIgnore,
  insertSettingUpsert,
  insertUsageDailyUpsert,
  insertUsageIngestionIgnore,
  listAgents,
  listAgentsAfterCursor,
  listAgentsByPrefix,
  listAgentsForReconcile,
  listAgentsForReconcileWrap,
  listAgentsWrap,
  listAudit,
  listConfigVersions,
  listDiscoverAgents,
  listUsageByAgent,
  listUsageByCredential,
  listUsageByDay,
  listUsageByModel,
  updateActivateAgent,
  updateAdvanceDesiredVersion,
  updateRenameAgent,
  updateReportAppliedVersion,
  updateUsageIngestion,
} as const

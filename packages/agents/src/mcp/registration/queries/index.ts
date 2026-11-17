/**
 * Barrel of typed Reylo SQL queries for `mcp/registration`.
 *
 * @module
 */
import deleteMcpAssignmentsByServer from './delete_mcp_assignments_by_server.sql'
import getActiveWorkingAgent from './get_active_working_agent.sql'
import getMcpAssignment from './get_mcp_assignment.sql'
import getMcpCompletedOauthForRequest from './get_mcp_completed_oauth_for_request.sql'
import getMcpCredentialNotice from './get_mcp_credential_notice.sql'
import getMcpDefinition from './get_mcp_definition.sql'
import getMcpGrantedCredential from './get_mcp_granted_credential.sql'
import getMcpIntent from './get_mcp_intent.sql'
import getMcpProposal from './get_mcp_proposal.sql'
import getMcpRequestById from './get_mcp_request_by_id.sql'
import getMcpRequestBySourceId from './get_mcp_request_by_source_id.sql'
import getMcpRequestLatestCreated from './get_mcp_request_latest_created.sql'
import getMcpRequestLatestEntry from './get_mcp_request_latest_entry.sql'
import getMcpServerByEndpoint from './get_mcp_server_by_endpoint.sql'
import getMcpServerById from './get_mcp_server_by_id.sql'
import getMcpToolById from './get_mcp_tool_by_id.sql'
import getWorkingAgent from './get_working_agent.sql'
import insertCommitMcpAgentVersion from './insert_commit_mcp_agent_version.sql'
import insertCommitMcpAssign from './insert_commit_mcp_assign.sql'
import insertCommitMcpIntent from './insert_commit_mcp_intent.sql'
import insertCommitMcpProposal from './insert_commit_mcp_proposal.sql'
import insertCommitMcpServerRevision from './insert_commit_mcp_server_revision.sql'
import insertCommitMcpServerState from './insert_commit_mcp_server_state.sql'
import insertMcpAssignment from './insert_mcp_assignment.sql'
import insertMcpCommit from './insert_mcp_commit.sql'
import insertMcpDefinitionIgnore from './insert_mcp_definition_ignore.sql'
import insertMcpIntentIgnore from './insert_mcp_intent_ignore.sql'
import insertMcpProposal from './insert_mcp_proposal.sql'
import insertMcpRequest from './insert_mcp_request.sql'
import insertMcpServer from './insert_mcp_server.sql'
import insertMcpToolUpsert from './insert_mcp_tool_upsert.sql'
import listMcpAssignmentAgentIds from './list_mcp_assignment_agent_ids.sql'
import listMcpCatalogNotices from './list_mcp_catalog_notices.sql'
import listMcpNoticeRecipients from './list_mcp_notice_recipients.sql'
import listMcpRevocationRecipients from './list_mcp_revocation_recipients.sql'
import listMcpServers from './list_mcp_servers.sql'
import listMcpServersByName from './list_mcp_servers_by_name.sql'
import listMcpToolsByServer from './list_mcp_tools_by_server.sql'
import listMcpToolsPresent from './list_mcp_tools_present.sql'
import listTerminalMcpRequests from './list_terminal_mcp_requests.sql'
import listUnnotifiedMcpRequests from './list_unnotified_mcp_requests.sql'
import updateConsumeMcpIntent from './update_consume_mcp_intent.sql'
import updateDisableMcpServer from './update_disable_mcp_server.sql'
import updateFailExpiredMcpRequests from './update_fail_expired_mcp_requests.sql'
import updateMarkMcpRequestNotified from './update_mark_mcp_request_notified.sql'
import updateMarkMcpServerStale from './update_mark_mcp_server_stale.sql'
import updateMarkMcpToolsAbsent from './update_mark_mcp_tools_absent.sql'
import updateMcpRequestAwaitingOwnerAuth from './update_mcp_request_awaiting_owner_auth.sql'
import updateMcpRequestDiscovered from './update_mcp_request_discovered.sql'
import updateMcpRequestReady from './update_mcp_request_ready.sql'
import updateMcpRequestRecoverFailed from './update_mcp_request_recover_failed.sql'
import updateMcpRequestRecoverReady from './update_mcp_request_recover_ready.sql'
import updateMcpServer from './update_mcp_server.sql'
import updatePublishMcpServer from './update_publish_mcp_server.sql'
import updateRecordMcpInspectionError from './update_record_mcp_inspection_error.sql'

/** Typed SQL queries owned by `mcp/registration`. */
export const queries = {
  deleteMcpAssignmentsByServer,
  getActiveWorkingAgent,
  getMcpAssignment,
  getMcpCompletedOauthForRequest,
  getMcpCredentialNotice,
  getMcpDefinition,
  getMcpGrantedCredential,
  getMcpIntent,
  getMcpProposal,
  getMcpRequestById,
  getMcpRequestBySourceId,
  getMcpRequestLatestCreated,
  getMcpRequestLatestEntry,
  getMcpServerByEndpoint,
  getMcpServerById,
  getMcpToolById,
  getWorkingAgent,
  insertCommitMcpAgentVersion,
  insertCommitMcpAssign,
  insertCommitMcpIntent,
  insertCommitMcpProposal,
  insertCommitMcpServerRevision,
  insertCommitMcpServerState,
  insertMcpAssignment,
  insertMcpCommit,
  insertMcpDefinitionIgnore,
  insertMcpIntentIgnore,
  insertMcpProposal,
  insertMcpRequest,
  insertMcpServer,
  insertMcpToolUpsert,
  listMcpAssignmentAgentIds,
  listMcpCatalogNotices,
  listMcpNoticeRecipients,
  listMcpRevocationRecipients,
  listMcpServers,
  listMcpServersByName,
  listMcpToolsByServer,
  listMcpToolsPresent,
  listTerminalMcpRequests,
  listUnnotifiedMcpRequests,
  updateConsumeMcpIntent,
  updateDisableMcpServer,
  updateFailExpiredMcpRequests,
  updateMarkMcpRequestNotified,
  updateMarkMcpServerStale,
  updateMarkMcpToolsAbsent,
  updateMcpRequestAwaitingOwnerAuth,
  updateMcpRequestDiscovered,
  updateMcpRequestReady,
  updateMcpRequestRecoverFailed,
  updateMcpRequestRecoverReady,
  updateMcpServer,
  updatePublishMcpServer,
  updateRecordMcpInspectionError,
} as const

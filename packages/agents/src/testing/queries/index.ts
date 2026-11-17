/**
 * Barrel of typed Reylo SQL queries for `testing`.
 *
 * @module
 */
import deleteAllContactRequests from './delete_all_contact_requests.sql'
import deleteAllNotifications from './delete_all_notifications.sql'
import deleteAllUsage from './delete_all_usage.sql'
import deleteAlwaysLoaded from './delete_always_loaded.sql'
import deleteCredentialGrantsByAgent from './delete_credential_grants_by_agent.sql'
import deleteCredentialGrantsReturning from './delete_credential_grants_returning.sql'
import deleteMemoryLedgerByRun from './delete_memory_ledger_by_run.sql'
import deleteNotificationBySeq from './delete_notification_by_seq.sql'
import getMcpOauthTransactionById from './get_mcp_oauth_transaction_by_id.sql'
import getUsageIngestionByAgent from './get_usage_ingestion_by_agent.sql'
import insertContactRequestRaw from './insert_contact_request_raw.sql'
import insertDeferredCallRaw from './insert_deferred_call_raw.sql'
import insertFullUsage from './insert_full_usage.sql'
import insertLeasedCredential from './insert_leased_credential.sql'
import insertMcpOauthTransactionWithStatus from './insert_mcp_oauth_transaction_with_status.sql'
import insertMcpRequestWithStatus from './insert_mcp_request_with_status.sql'
import listActiveRecordsByScope from './list_active_records_by_scope.sql'
import listAllAgentCredentialRefs from './list_all_agent_credential_refs.sql'
import listAllAgents from './list_all_agents.sql'
import listAllArtifacts from './list_all_artifacts.sql'
import listAllAuditLog from './list_all_audit_log.sql'
import listAllConfigVersions from './list_all_config_versions.sql'
import listAllContactReceipts from './list_all_contact_receipts.sql'
import listAllContactRequests from './list_all_contact_requests.sql'
import listAllCredentialGrants from './list_all_credential_grants.sql'
import listAllCredentials from './list_all_credentials.sql'
import listAllDeferredCalls from './list_all_deferred_calls.sql'
import listAllEventInbox from './list_all_event_inbox.sql'
import listAllKnownUrls from './list_all_known_urls.sql'
import listAllMemoryJobs from './list_all_memory_jobs.sql'
import listAllNotifications from './list_all_notifications.sql'
import listAllPruneRuns from './list_all_prune_runs.sql'
import listAllRevisionClaims from './list_all_revision_claims.sql'
import listAllScheduledOccurrences from './list_all_scheduled_occurrences.sql'
import listAllScheduledTasks from './list_all_scheduled_tasks.sql'
import listAllSystemSettings from './list_all_system_settings.sql'
import listAllUsage from './list_all_usage.sql'
import listArchiveSegmentsByAgent from './list_archive_segments_by_agent.sql'
import listAuditByAction from './list_audit_by_action.sql'
import listAuditByTarget from './list_audit_by_target.sql'
import listMcpAssignmentsByAgent from './list_mcp_assignments_by_agent.sql'
import listMcpAssignmentsByAgentServer from './list_mcp_assignments_by_agent_server.sql'
import listMcpProposalsByRequest from './list_mcp_proposals_by_request.sql'
import listMcpRequestsBySourceAgent from './list_mcp_requests_by_source_agent.sql'
import listMemoryLedgerByAction from './list_memory_ledger_by_action.sql'
import listMemoryLedgerByOp from './list_memory_ledger_by_op.sql'
import listMemoryLedgerByRun from './list_memory_ledger_by_run.sql'
import listMemoryOpsByIds from './list_memory_ops_by_ids.sql'
import listMemoryRecordsByContent from './list_memory_records_by_content.sql'
import listMemoryRecordsByScopeUseCount from './list_memory_records_by_scope_use_count.sql'
import listMemoryTermsByRecord from './list_memory_terms_by_record.sql'
import listPiEntryHeads from './list_pi_entry_heads.sql'
import listPiEntryIds from './list_pi_entry_ids.sql'
import listPiEntryRecords from './list_pi_entry_records.sql'
import listScheduledOccurrencesByTask from './list_scheduled_occurrences_by_task.sql'
import listUsageDailyByAgent from './list_usage_daily_by_agent.sql'
import updateAgentSlug from './update_agent_slug.sql'
import updateAgentStatus from './update_agent_status.sql'
import updateAgentStatusReturning from './update_agent_status_returning.sql'
import updateAgentVersions from './update_agent_versions.sql'
import updateAllContactRequestsRetryAt from './update_all_contact_requests_retry_at.sql'
import updateAllScheduledTasksState from './update_all_scheduled_tasks_state.sql'
import updateArtifactExpiresAt from './update_artifact_expires_at.sql'
import updateArtifactStorageKey from './update_artifact_storage_key.sql'
import updateClearCredentialEnvelope from './update_clear_credential_envelope.sql'
import updateConfigVersionSettings from './update_config_version_settings.sql'
import updateContactRequestFailed from './update_contact_request_failed.sql'
import updateContactRequestsRetryAtDue from './update_contact_requests_retry_at_due.sql'
import updateCredentialCiphertext from './update_credential_ciphertext.sql'
import updateCredentialHealthFields from './update_credential_health_fields.sql'
import updateCredentialLease from './update_credential_lease.sql'
import updateCredentialStatus from './update_credential_status.sql'
import updateLeasedCredentialFields from './update_leased_credential_fields.sql'
import updateMcpOauthTransactionStatus from './update_mcp_oauth_transaction_status.sql'
import updateMcpRequestExpiresAt from './update_mcp_request_expires_at.sql'
import updateMcpServerEnabled from './update_mcp_server_enabled.sql'
import updateMcpServerRevision from './update_mcp_server_revision.sql'
import updateMemoryJobCreatedAt from './update_memory_job_created_at.sql'
import updateMemoryJobNotBefore from './update_memory_job_not_before.sql'
import updateMemoryJobSettled from './update_memory_job_settled.sql'
import updateMemoryJobStartedAt from './update_memory_job_started_at.sql'
import updateMemoryRecordStatus from './update_memory_record_status.sql'
import updateNotificationsExpiresAt from './update_notifications_expires_at.sql'
import updateNotificationsReadAt from './update_notifications_read_at.sql'
import updateReopenRunningMemoryJobRaw from './update_reopen_running_memory_job_raw.sql'
import updateResetContactReceipts from './update_reset_contact_receipts.sql'
import updateResetScheduledOccurrencesDispatching from './update_reset_scheduled_occurrences_dispatching.sql'
import updateScheduledOccurrencesAdmissionAttempts from './update_scheduled_occurrences_admission_attempts.sql'
import updateScheduledOccurrencesAttemptsRetry from './update_scheduled_occurrences_attempts_retry.sql'
import updateScheduledOccurrencesRetryAt from './update_scheduled_occurrences_retry_at.sql'
import updateScheduledOccurrencesState from './update_scheduled_occurrences_state.sql'
import updateScheduledTaskHop from './update_scheduled_task_hop.sql'
import updateScheduledTaskHopAndRule from './update_scheduled_task_hop_and_rule.sql'
import updateScheduledTaskRule from './update_scheduled_task_rule.sql'
import updateSkillLastUsedAt from './update_skill_last_used_at.sql'

/** Typed SQL queries owned by `testing`. */
export const queries = {
  deleteAllContactRequests,
  deleteAllNotifications,
  deleteAllUsage,
  deleteAlwaysLoaded,
  deleteCredentialGrantsByAgent,
  deleteCredentialGrantsReturning,
  deleteMemoryLedgerByRun,
  deleteNotificationBySeq,
  getMcpOauthTransactionById,
  getUsageIngestionByAgent,
  insertContactRequestRaw,
  insertDeferredCallRaw,
  insertFullUsage,
  insertLeasedCredential,
  insertMcpOauthTransactionWithStatus,
  insertMcpRequestWithStatus,
  listActiveRecordsByScope,
  listAllAgentCredentialRefs,
  listAllAgents,
  listAllArtifacts,
  listAllAuditLog,
  listAllConfigVersions,
  listAllContactReceipts,
  listAllContactRequests,
  listAllCredentialGrants,
  listAllCredentials,
  listAllDeferredCalls,
  listAllEventInbox,
  listAllKnownUrls,
  listAllMemoryJobs,
  listAllNotifications,
  listAllPruneRuns,
  listAllRevisionClaims,
  listAllScheduledOccurrences,
  listAllScheduledTasks,
  listAllSystemSettings,
  listAllUsage,
  listArchiveSegmentsByAgent,
  listAuditByAction,
  listAuditByTarget,
  listMcpAssignmentsByAgent,
  listMcpAssignmentsByAgentServer,
  listMcpProposalsByRequest,
  listMcpRequestsBySourceAgent,
  listMemoryLedgerByAction,
  listMemoryLedgerByOp,
  listMemoryLedgerByRun,
  listMemoryOpsByIds,
  listMemoryRecordsByContent,
  listMemoryRecordsByScopeUseCount,
  listMemoryTermsByRecord,
  listPiEntryHeads,
  listPiEntryIds,
  listPiEntryRecords,
  listScheduledOccurrencesByTask,
  listUsageDailyByAgent,
  updateAgentSlug,
  updateAgentStatus,
  updateAgentStatusReturning,
  updateAgentVersions,
  updateAllContactRequestsRetryAt,
  updateAllScheduledTasksState,
  updateArtifactExpiresAt,
  updateArtifactStorageKey,
  updateClearCredentialEnvelope,
  updateConfigVersionSettings,
  updateContactRequestFailed,
  updateContactRequestsRetryAtDue,
  updateCredentialCiphertext,
  updateCredentialHealthFields,
  updateCredentialLease,
  updateCredentialStatus,
  updateLeasedCredentialFields,
  updateMcpOauthTransactionStatus,
  updateMcpRequestExpiresAt,
  updateMcpServerEnabled,
  updateMcpServerRevision,
  updateMemoryJobCreatedAt,
  updateMemoryJobNotBefore,
  updateMemoryJobSettled,
  updateMemoryJobStartedAt,
  updateMemoryRecordStatus,
  updateNotificationsExpiresAt,
  updateNotificationsReadAt,
  updateReopenRunningMemoryJobRaw,
  updateResetContactReceipts,
  updateResetScheduledOccurrencesDispatching,
  updateScheduledOccurrencesAdmissionAttempts,
  updateScheduledOccurrencesAttemptsRetry,
  updateScheduledOccurrencesRetryAt,
  updateScheduledOccurrencesState,
  updateScheduledTaskHop,
  updateScheduledTaskHopAndRule,
  updateScheduledTaskRule,
  updateSkillLastUsedAt,
} as const

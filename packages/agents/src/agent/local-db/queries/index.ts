/**
 * Barrel of typed Reylo SQL queries for `agent/local-db`.
 *
 * @module
 */
import deleteArtifact from './delete_artifact.sql'
import deleteExpiredUsage from './delete_expired_usage.sql'
import deleteMemoryJobsByIds from './delete_memory_jobs_by_ids.sql'
import deleteOrphanPiRecordIdsDocuments from './delete_orphan_pi_record_ids_documents.sql'
import deleteOrphanPiRecordIdsTasks from './delete_orphan_pi_record_ids_tasks.sql'
import deletePiEntriesBetween from './delete_pi_entries_between.sql'
import deletePiRecordIdsEntries from './delete_pi_record_ids_entries.sql'
import deletePrunedPiDocumentRevisions from './delete_pruned_pi_document_revisions.sql'
import deletePrunedPiDocuments from './delete_pruned_pi_documents.sql'
import deletePrunedPiTasks from './delete_pruned_pi_tasks.sql'
import deleteRetainInbox from './delete_retain_inbox.sql'
import deleteRetainNotifications from './delete_retain_notifications.sql'
import deleteRetainScheduledOccurrences from './delete_retain_scheduled_occurrences.sql'
import deleteTrimKnownUrls from './delete_trim_known_urls.sql'
import getActiveFollowupTasksCount from './get_active_followup_tasks_count.sql'
import getAlwaysLoaded from './get_always_loaded.sql'
import getApprovedCallNullDigest from './get_approved_call_null_digest.sql'
import getApprovedCallWithDigest from './get_approved_call_with_digest.sql'
import getArtifactById from './get_artifact_by_id.sql'
import getArtifactCleanupBounds from './get_artifact_cleanup_bounds.sql'
import getContactReceipt from './get_contact_receipt.sql'
import getContactRequestById from './get_contact_request_by_id.sql'
import getContactRequestBySourceTask from './get_contact_request_by_source_task.sql'
import getDeferredCallById from './get_deferred_call_by_id.sql'
import getDeferredCallBySourceTask from './get_deferred_call_by_source_task.sql'
import getDueMemoryJob from './get_due_memory_job.sql'
import getExternalData from './get_external_data.sql'
import getInboxByRequestId from './get_inbox_by_request_id.sql'
import getKnownUrl from './get_known_url.sql'
import getLatestOccurrenceByTask from './get_latest_occurrence_by_task.sql'
import getLatestOutboxNotification from './get_latest_outbox_notification.sql'
import getLatestPiHead from './get_latest_pi_head.sql'
import getLiveNotificationSeq from './get_live_notification_seq.sql'
import getMemoryJobById from './get_memory_job_by_id.sql'
import getNextActiveTaskDue from './get_next_active_task_due.sql'
import getNextMemoryJobDue from './get_next_memory_job_due.sql'
import getNextNotificationExpiry from './get_next_notification_expiry.sql'
import getNextOutboxWake from './get_next_outbox_wake.sql'
import getNextPendingOccurrenceRetry from './get_next_pending_occurrence_retry.sql'
import getNextQueuedInbox from './get_next_queued_inbox.sql'
import getNextReceiverContactExpiry from './get_next_receiver_contact_expiry.sql'
import getNextSenderContactExpiry from './get_next_sender_contact_expiry.sql'
import getNextSettledInbox from './get_next_settled_inbox.sql'
import getNotificationBySource from './get_notification_by_source.sql'
import getOpenScheduledTasksCount from './get_open_scheduled_tasks_count.sql'
import getPendingContactsCount from './get_pending_contacts_count.sql'
import getPiConversationsCount from './get_pi_conversations_count.sql'
import getPrunablePiEntry from './get_prunable_pi_entry.sql'
import getPrunedThrough from './get_pruned_through.sql'
import getRememberTurn from './get_remember_turn.sql'
import getReservedInboxMarker from './get_reserved_inbox_marker.sql'
import getRunningMemoryJob from './get_running_memory_job.sql'
import getScheduledTaskById from './get_scheduled_task_by_id.sql'
import getScheduledTaskBySourceTask from './get_scheduled_task_by_source_task.sql'
import getStarvedMemoryJob from './get_starved_memory_job.sql'
import getUnfinishedOccurrenceIdByTask from './get_unfinished_occurrence_id_by_task.sql'
import getUnfinishedPruneRun from './get_unfinished_prune_run.sql'
import getUnfinishedUsageThrough from './get_unfinished_usage_through.sql'
import getUsageBySeq from './get_usage_by_seq.sql'
import insertAlwaysLoadedUpsert from './insert_always_loaded_upsert.sql'
import insertArtifact from './insert_artifact.sql'
import insertContactReceipt from './insert_contact_receipt.sql'
import insertContactRequest from './insert_contact_request.sql'
import insertDeferredCall from './insert_deferred_call.sql'
import insertExternalData from './insert_external_data.sql'
import insertInboxEvent from './insert_inbox_event.sql'
import insertKnownUrlUpsert from './insert_known_url_upsert.sql'
import insertLocalTasksUpsert from './insert_local_tasks_upsert.sql'
import insertMemoryJob from './insert_memory_job.sql'
import insertNotification from './insert_notification.sql'
import insertPruneRun from './insert_prune_run.sql'
import insertRememberTurnUpsert from './insert_remember_turn_upsert.sql'
import insertScheduledOccurrence from './insert_scheduled_occurrence.sql'
import insertScheduledTask from './insert_scheduled_task.sql'
import insertUsage from './insert_usage.sql'
import listActionableContacts from './list_actionable_contacts.sql'
import listArtifactCleanupRows from './list_artifact_cleanup_rows.sql'
import listContactRequests from './list_contact_requests.sql'
import listDeferredCalls from './list_deferred_calls.sql'
import listDuePendingOutbox from './list_due_pending_outbox.sql'
import listDueScheduledTasks from './list_due_scheduled_tasks.sql'
import listMcpDeferredCandidates from './list_mcp_deferred_candidates.sql'
import listNotifications from './list_notifications.sql'
import listPendingContactReceipts from './list_pending_contact_receipts.sql'
import listPendingContacts from './list_pending_contacts.sql'
import listPendingDeferredCalls from './list_pending_deferred_calls.sql'
import listPendingInboxEvents from './list_pending_inbox_events.sql'
import listPendingOccurrences from './list_pending_occurrences.sql'
import listPiEntriesBetween from './list_pi_entries_between.sql'
import listPiEntriesRange from './list_pi_entries_range.sql'
import listReadyArtifacts from './list_ready_artifacts.sql'
import listRecentOutboxSummaries from './list_recent_outbox_summaries.sql'
import listReservedInboxRows from './list_reserved_inbox_rows.sql'
import listScheduledTasks from './list_scheduled_tasks.sql'
import listSettledMemoryJobsBefore from './list_settled_memory_jobs_before.sql'
import listUsageSince from './list_usage_since.sql'
import updateAcceptContact from './update_accept_contact.sql'
import updateAcceptOccurrence from './update_accept_occurrence.sql'
import updateAcknowledgeContactReceipt from './update_acknowledge_contact_receipt.sql'
import updateAcknowledgeUsage from './update_acknowledge_usage.sql'
import updateAdvanceScheduledTaskCursor from './update_advance_scheduled_task_cursor.sql'
import updateCancelScheduledTask from './update_cancel_scheduled_task.sql'
import updateClearInboxBatchReservation from './update_clear_inbox_batch_reservation.sql'
import updateConsumeDeferredCall from './update_consume_deferred_call.sql'
import updateContactReceiptSubmission from './update_contact_receipt_submission.sql'
import updateDecideDeferredCall from './update_decide_deferred_call.sql'
import updateDeferContact from './update_defer_contact.sql'
import updateDeferOccurrence from './update_defer_occurrence.sql'
import updateDeletingArtifact from './update_deleting_artifact.sql'
import updateDispatchCoalescedOutbox from './update_dispatch_coalesced_outbox.sql'
import updateDispatchSingleOutbox from './update_dispatch_single_outbox.sql'
import updateExpireContactReceipts from './update_expire_contact_receipts.sql'
import updateExpireContactRequests from './update_expire_contact_requests.sql'
import updateExpireDeferredCalls from './update_expire_deferred_calls.sql'
import updateExpireDeferredCallsByIds from './update_expire_deferred_calls_by_ids.sql'
import updateFailInboxEvent from './update_fail_inbox_event.sql'
import updateFinishContactAck from './update_finish_contact_ack.sql'
import updateFinishScheduledTask from './update_finish_scheduled_task.sql'
import updateFinishUsage from './update_finish_usage.sql'
import updateFlushPendingOutbox from './update_flush_pending_outbox.sql'
import updateInterruptUsage from './update_interrupt_usage.sql'
import updateMarkInboxAdmitted from './update_mark_inbox_admitted.sql'
import updateMarkMemoryChecked from './update_mark_memory_checked.sql'
import updateMarkNotificationRead from './update_mark_notification_read.sql'
import updateMarkOccurrenceAdmissionStarted from './update_mark_occurrence_admission_started.sql'
import updatePruneRun from './update_prune_run.sql'
import updateReadyArtifact from './update_ready_artifact.sql'
import updateReopenMemoryJob from './update_reopen_memory_job.sql'
import updateReserveInboxBatch from './update_reserve_inbox_batch.sql'
import updateRetryContact from './update_retry_contact.sql'
import updateRetryInboxEvent from './update_retry_inbox_event.sql'
import updateRetryMemoryJob from './update_retry_memory_job.sql'
import updateRetryOccurrence from './update_retry_occurrence.sql'
import updateScheduledTask from './update_scheduled_task.sql'
import updateSettleContact from './update_settle_contact.sql'
import updateSettleContactReceipt from './update_settle_contact_receipt.sql'
import updateSettleInboxEvents from './update_settle_inbox_events.sql'
import updateSettleMemoryJob from './update_settle_memory_job.sql'
import updateSettleOccurrence from './update_settle_occurrence.sql'
import updateStartMemoryJob from './update_start_memory_job.sql'
import updateSuppressOutboxBySeqs from './update_suppress_outbox_by_seqs.sql'
import updateUsageCredential from './update_usage_credential.sql'

/** Typed SQL queries owned by `agent/local-db`. */
export const queries = {
  deleteArtifact,
  deleteExpiredUsage,
  deleteMemoryJobsByIds,
  deleteOrphanPiRecordIdsDocuments,
  deleteOrphanPiRecordIdsTasks,
  deletePiEntriesBetween,
  deletePiRecordIdsEntries,
  deletePrunedPiDocumentRevisions,
  deletePrunedPiDocuments,
  deletePrunedPiTasks,
  deleteRetainInbox,
  deleteRetainNotifications,
  deleteRetainScheduledOccurrences,
  deleteTrimKnownUrls,
  getActiveFollowupTasksCount,
  getAlwaysLoaded,
  getApprovedCallNullDigest,
  getApprovedCallWithDigest,
  getArtifactById,
  getArtifactCleanupBounds,
  getContactReceipt,
  getContactRequestById,
  getContactRequestBySourceTask,
  getDeferredCallById,
  getDeferredCallBySourceTask,
  getDueMemoryJob,
  getExternalData,
  getInboxByRequestId,
  getKnownUrl,
  getLatestOccurrenceByTask,
  getLatestOutboxNotification,
  getLatestPiHead,
  getLiveNotificationSeq,
  getMemoryJobById,
  getNextActiveTaskDue,
  getNextMemoryJobDue,
  getNextNotificationExpiry,
  getNextOutboxWake,
  getNextPendingOccurrenceRetry,
  getNextQueuedInbox,
  getNextReceiverContactExpiry,
  getNextSenderContactExpiry,
  getNextSettledInbox,
  getNotificationBySource,
  getOpenScheduledTasksCount,
  getPendingContactsCount,
  getPiConversationsCount,
  getPrunablePiEntry,
  getPrunedThrough,
  getRememberTurn,
  getReservedInboxMarker,
  getRunningMemoryJob,
  getScheduledTaskById,
  getScheduledTaskBySourceTask,
  getStarvedMemoryJob,
  getUnfinishedOccurrenceIdByTask,
  getUnfinishedPruneRun,
  getUnfinishedUsageThrough,
  getUsageBySeq,
  insertAlwaysLoadedUpsert,
  insertArtifact,
  insertContactReceipt,
  insertContactRequest,
  insertDeferredCall,
  insertExternalData,
  insertInboxEvent,
  insertKnownUrlUpsert,
  insertLocalTasksUpsert,
  insertMemoryJob,
  insertNotification,
  insertPruneRun,
  insertRememberTurnUpsert,
  insertScheduledOccurrence,
  insertScheduledTask,
  insertUsage,
  listActionableContacts,
  listArtifactCleanupRows,
  listContactRequests,
  listDeferredCalls,
  listDuePendingOutbox,
  listDueScheduledTasks,
  listMcpDeferredCandidates,
  listNotifications,
  listPendingContactReceipts,
  listPendingContacts,
  listPendingDeferredCalls,
  listPendingInboxEvents,
  listPendingOccurrences,
  listPiEntriesBetween,
  listPiEntriesRange,
  listReadyArtifacts,
  listRecentOutboxSummaries,
  listReservedInboxRows,
  listScheduledTasks,
  listSettledMemoryJobsBefore,
  listUsageSince,
  updateAcceptContact,
  updateAcceptOccurrence,
  updateAcknowledgeContactReceipt,
  updateAcknowledgeUsage,
  updateAdvanceScheduledTaskCursor,
  updateCancelScheduledTask,
  updateClearInboxBatchReservation,
  updateConsumeDeferredCall,
  updateContactReceiptSubmission,
  updateDecideDeferredCall,
  updateDeferContact,
  updateDeferOccurrence,
  updateDeletingArtifact,
  updateDispatchCoalescedOutbox,
  updateDispatchSingleOutbox,
  updateExpireContactReceipts,
  updateExpireContactRequests,
  updateExpireDeferredCalls,
  updateExpireDeferredCallsByIds,
  updateFailInboxEvent,
  updateFinishContactAck,
  updateFinishScheduledTask,
  updateFinishUsage,
  updateFlushPendingOutbox,
  updateInterruptUsage,
  updateMarkInboxAdmitted,
  updateMarkMemoryChecked,
  updateMarkNotificationRead,
  updateMarkOccurrenceAdmissionStarted,
  updatePruneRun,
  updateReadyArtifact,
  updateReopenMemoryJob,
  updateReserveInboxBatch,
  updateRetryContact,
  updateRetryInboxEvent,
  updateRetryMemoryJob,
  updateRetryOccurrence,
  updateScheduledTask,
  updateSettleContact,
  updateSettleContactReceipt,
  updateSettleInboxEvents,
  updateSettleMemoryJob,
  updateSettleOccurrence,
  updateStartMemoryJob,
  updateSuppressOutboxBySeqs,
  updateUsageCredential,
} as const

/**
 * Barrel of typed Reylo SQL queries for `memory/store`.
 *
 * @module
 */
import deleteMemoryTermsByRecord from './delete_memory_terms_by_record.sql'
import deleteOldMemoryLedger from './delete_old_memory_ledger.sql'
import deleteOldRevisionClaims from './delete_old_revision_claims.sql'
import getActiveRecordRevision from './get_active_record_revision.sql'
import getArchiveSegmentById from './get_archive_segment_by_id.sql'
import getExtractionCheckpoint from './get_extraction_checkpoint.sql'
import getExtractionCheckpointRow from './get_extraction_checkpoint_row.sql'
import getMemoryLedger from './get_memory_ledger.sql'
import getMemoryOp from './get_memory_op.sql'
import getMemoryRecordById from './get_memory_record_by_id.sql'
import getNextArchiveSegment from './get_next_archive_segment.sql'
import getSkill from './get_skill.sql'
import getTaskProgress from './get_task_progress.sql'
import insertArchiveSegment from './insert_archive_segment.sql'
import insertExtractionCheckpoint from './insert_extraction_checkpoint.sql'
import insertMemoryLedger from './insert_memory_ledger.sql'
import insertMemoryOp from './insert_memory_op.sql'
import insertMemoryRecord from './insert_memory_record.sql'
import insertMemoryTerms from './insert_memory_terms.sql'
import insertRevisionClaim from './insert_revision_claim.sql'
import insertScopeRevisionUpsert from './insert_scope_revision_upsert.sql'
import insertSkill from './insert_skill.sql'
import insertTaskProgress from './insert_task_progress.sql'
import listActiveRecordContents from './list_active_record_contents.sql'
import listActiveRecordsById from './list_active_records_by_id.sql'
import listChangedScopesAfter from './list_changed_scopes_after.sql'
import listChangedScopesAll from './list_changed_scopes_all.sql'
import listChangedScopesWrap from './list_changed_scopes_wrap.sql'
import listCompletedTasksBefore from './list_completed_tasks_before.sql'
import listConsolidationRecords from './list_consolidation_records.sql'
import listCountActiveRecordsByScope from './list_count_active_records_by_scope.sql'
import listHistorySegments from './list_history_segments.sql'
import listJobOpsResults from './list_job_ops_results.sql'
import listMemoryRecordsByIds from './list_memory_records_by_ids.sql'
import listOverridesOfRequired from './list_overrides_of_required.sql'
import listPromptRecords from './list_prompt_records.sql'
import listRecordsWithTermExact from './list_records_with_term_exact.sql'
import listRecordsWithTermPrefix from './list_records_with_term_prefix.sql'
import listResegmentRecords from './list_resegment_records.sql'
import listScopeRevisions from './list_scope_revisions.sql'
import listSkills from './list_skills.sql'
import listStaleSkills from './list_stale_skills.sql'
import listTaskProgressActive from './list_task_progress_active.sql'
import listTaskProgressAll from './list_task_progress_all.sql'
import listVisibleSkills from './list_visible_skills.sql'
import listVisibleTasks from './list_visible_tasks.sql'
import updateArchiveTaskProgress from './update_archive_task_progress.sql'
import updateExtractionCheckpoint from './update_extraction_checkpoint.sql'
import updateIncrementMemoryRecordUse from './update_increment_memory_record_use.sql'
import updateIncrementSkillUse from './update_increment_skill_use.sql'
import updateMemoryRecordInvalid from './update_memory_record_invalid.sql'
import updateMemoryRecordSuperseded from './update_memory_record_superseded.sql'
import updateRecordSearchVersion from './update_record_search_version.sql'
import updateSkill from './update_skill.sql'
import updateSkillStatus from './update_skill_status.sql'
import updateTaskProgress from './update_task_progress.sql'

/** Typed SQL queries owned by `memory/store`. */
export const queries = {
  deleteMemoryTermsByRecord,
  deleteOldMemoryLedger,
  deleteOldRevisionClaims,
  getActiveRecordRevision,
  getArchiveSegmentById,
  getExtractionCheckpoint,
  getExtractionCheckpointRow,
  getMemoryLedger,
  getMemoryOp,
  getMemoryRecordById,
  getNextArchiveSegment,
  getSkill,
  getTaskProgress,
  insertArchiveSegment,
  insertExtractionCheckpoint,
  insertMemoryLedger,
  insertMemoryOp,
  insertMemoryRecord,
  insertMemoryTerms,
  insertRevisionClaim,
  insertScopeRevisionUpsert,
  insertSkill,
  insertTaskProgress,
  listActiveRecordContents,
  listActiveRecordsById,
  listChangedScopesAfter,
  listChangedScopesAll,
  listChangedScopesWrap,
  listCompletedTasksBefore,
  listConsolidationRecords,
  listCountActiveRecordsByScope,
  listHistorySegments,
  listJobOpsResults,
  listMemoryRecordsByIds,
  listOverridesOfRequired,
  listPromptRecords,
  listRecordsWithTermExact,
  listRecordsWithTermPrefix,
  listResegmentRecords,
  listScopeRevisions,
  listSkills,
  listStaleSkills,
  listTaskProgressActive,
  listTaskProgressAll,
  listVisibleSkills,
  listVisibleTasks,
  updateArchiveTaskProgress,
  updateExtractionCheckpoint,
  updateIncrementMemoryRecordUse,
  updateIncrementSkillUse,
  updateMemoryRecordInvalid,
  updateMemoryRecordSuperseded,
  updateRecordSearchVersion,
  updateSkill,
  updateSkillStatus,
  updateTaskProgress,
} as const

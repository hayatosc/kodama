/**
 * Test-only data-access repository wrapping `src/testing/queries/` for fixtures and assertions.
 *
 * @module
 */
import type { ManagementDb } from '../control-plane/db.ts'
import { prepareQuery } from '../lib/reylo.ts'
import type { MemoryDb } from '../memory/store/db.ts'
import { queries } from './queries/index.ts'

/** Execute test helper query `deleteAllContactRequests`. */
export function deleteAllContactRequests(sql: SqlStorage) {
  return queries.deleteAllContactRequests.runSync(sql)
}

/** Execute test helper query `deleteAllNotifications`. */
export function deleteAllNotifications(sql: SqlStorage) {
  return queries.deleteAllNotifications.runSync(sql)
}

/** Execute test helper query `deleteAllUsage`. */
export function deleteAllUsage(sql: SqlStorage) {
  return queries.deleteAllUsage.runSync(sql)
}

/** Execute test helper query `deleteAlwaysLoaded`. */
export function deleteAlwaysLoaded(sql: SqlStorage) {
  return queries.deleteAlwaysLoaded.runSync(sql)
}

/** Execute test helper query `deleteCredentialGrantsByAgent`. */
export function deleteCredentialGrantsByAgent(db: ManagementDb, params: { agentId: string }) {
  return queries.deleteCredentialGrantsByAgent.run(db, params)
}

/** Execute test helper query `deleteCredentialGrantsReturning`. */
export function deleteCredentialGrantsReturning(
  db: ManagementDb,
  params: { credentialId: string },
) {
  return queries.deleteCredentialGrantsReturning.run(db, params)
}

/** Execute test helper query `deleteMemoryLedgerByRun`. */
export function deleteMemoryLedgerByRun(db: MemoryDb, params: { runId: string }) {
  return queries.deleteMemoryLedgerByRun.run(db, params)
}

/** Execute test helper query `deleteNotificationBySeq`. */
export function deleteNotificationBySeq(sql: SqlStorage, params: { seq: number }) {
  return queries.deleteNotificationBySeq.runSync(sql, params)
}

/** Execute test helper query `getMcpOauthTransactionById`. */
export function getMcpOauthTransactionById(db: ManagementDb, params: { transactionId: string }) {
  return queries.getMcpOauthTransactionById.run(db, params)
}

/** Execute test helper query `getUsageIngestionByAgent`. */
export function getUsageIngestionByAgent(db: ManagementDb, params: { agentId: string }) {
  return queries.getUsageIngestionByAgent.run(db, params)
}

/** Execute test helper query `insertContactRequestRaw`. */
export function insertContactRequestRaw(
  sql: SqlStorage,
  params: {
    id: string
    sourceTask: string
    sourceEntry: number
    arguments: string
    targetAgentId: string
    requestId: string
    content: string
    hop: number
    state: string
    retryAt: number
    result?: string | null
    createdAt: number
    settledAt?: number | null
    expiresAt?: number | null
  },
) {
  return queries.insertContactRequestRaw.runSync(sql, params)
}

/** Execute test helper query `insertDeferredCallRaw`. */
export function insertDeferredCallRaw(
  sql: SqlStorage,
  params: {
    approvalId: string
    toolName: string
    toolDigest?: string | null
    argumentsJson: string
    reason: string
    sourceTask: string
    state: string
    createdAt: number
    expiresAt: number
    decidedAt?: number | null
  },
) {
  return queries.insertDeferredCallRaw.runSync(sql, params)
}

/** Execute test helper query `insertFullUsage`. */
export function insertFullUsage(
  sql: SqlStorage,
  params: {
    seq: number
    startedAt: number
    finishedAt?: number | null
    chargedAgentId: string
    actorKind: string
    jobId?: string | null
    credentialId?: string | null
    credentialKind?: string | null
    provider: string
    model: string
    responseModel?: string | null
    status: string
    rateLimited: number
    usageState: string
    input?: number | null
    output?: number | null
    cacheRead?: number | null
    cacheWrite?: number | null
    totalTokens?: number | null
    reasoning?: number | null
    cacheWrite1h?: number | null
    inputCost?: number | null
    outputCost?: number | null
    cacheReadCost?: number | null
    cacheWriteCost?: number | null
    totalCost?: number | null
    aggregatedAt?: number | null
  },
) {
  return queries.insertFullUsage.runSync(sql, params)
}

/** Execute test helper query `insertLeasedCredential`. */
export function insertLeasedCredential(
  db: ManagementDb,
  params: {
    credentialId: string
    kind: string
    provider: string
    status: string
    ciphertext?: string | null
    wrappedDek?: string | null
    revision: number
    fingerprint: string
    last4: string
    createdAt: number
    leaseId?: string | null
    leaseExpiresAt?: number | null
  },
) {
  return queries.insertLeasedCredential.run(db, params)
}

/** Execute test helper query `insertMcpOauthTransactionWithStatus`. */
export function insertMcpOauthTransactionWithStatus(
  db: ManagementDb,
  params: {
    requestId?: string | null
    transactionId: string
    serverId: string
    serverRevision: number
    stateDigest: string
    browserDigest: string
    bindingJson: string
    verifierId: string
    status: string
    credentialId?: string | null
    expiresAt: number
    createdAt: number
  },
) {
  return queries.insertMcpOauthTransactionWithStatus.run(db, params)
}

/** Prepare test helper statement `insertMcpOauthTransactionWithStatus` for a D1 batch. */
export function insertMcpOauthTransactionWithStatusStatement(
  db: ManagementDb,
  params: {
    requestId?: string | null
    transactionId: string
    serverId: string
    serverRevision: number
    stateDigest: string
    browserDigest: string
    bindingJson: string
    verifierId: string
    status: string
    credentialId?: string | null
    expiresAt: number
    createdAt: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertMcpOauthTransactionWithStatus, params)
}

/** Execute test helper query `insertMcpRequestWithStatus`. */
export function insertMcpRequestWithStatus(
  db: ManagementDb,
  params: {
    requestId: string
    sourceAgentId: string
    conversationId: string
    entryId: number
    submissionId: string
    serverId?: string | null
    serverRevision?: number | null
    credentialId?: string | null
    status: string
    name: string
    notifiedAt?: number | null
    expiresAt: number
    createdAt: number
  },
) {
  return queries.insertMcpRequestWithStatus.run(db, params)
}

/** Prepare test helper statement `insertMcpRequestWithStatus` for a D1 batch. */
export function insertMcpRequestWithStatusStatement(
  db: ManagementDb,
  params: {
    requestId: string
    sourceAgentId: string
    conversationId: string
    entryId: number
    submissionId: string
    serverId?: string | null
    serverRevision?: number | null
    credentialId?: string | null
    status: string
    name: string
    notifiedAt?: number | null
    expiresAt: number
    createdAt: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertMcpRequestWithStatus, params)
}

/** Execute test helper query `listActiveRecordsByScope`. */
export function listActiveRecordsByScope(db: MemoryDb, params: { scope: string }) {
  return queries.listActiveRecordsByScope.run(db, params)
}

/** Execute test helper query `listAllAgentCredentialRefs`. */
export function listAllAgentCredentialRefs(db: ManagementDb) {
  return queries.listAllAgentCredentialRefs.run(db)
}

/** Execute test helper query `listAllAgents`. */
export function listAllAgents(db: ManagementDb) {
  return queries.listAllAgents.run(db)
}

/** Execute test helper query `listAllArtifacts`. */
export function listAllArtifacts(sql: SqlStorage) {
  return queries.listAllArtifacts.runSync(sql)
}

/** Execute test helper query `listAllAuditLog`. */
export function listAllAuditLog(db: ManagementDb) {
  return queries.listAllAuditLog.run(db)
}

/** Execute test helper query `listAllConfigVersions`. */
export function listAllConfigVersions(db: ManagementDb) {
  return queries.listAllConfigVersions.run(db)
}

/** Execute test helper query `listAllContactReceipts`. */
export function listAllContactReceipts(sql: SqlStorage) {
  return queries.listAllContactReceipts.runSync(sql)
}

/** Execute test helper query `listAllContactRequests`. */
export function listAllContactRequests(sql: SqlStorage) {
  return queries.listAllContactRequests.runSync(sql)
}

/** Execute test helper query `listAllCredentialGrants`. */
export function listAllCredentialGrants(db: ManagementDb) {
  return queries.listAllCredentialGrants.run(db)
}

/** Execute test helper query `listAllCredentials`. */
export function listAllCredentials(db: ManagementDb) {
  return queries.listAllCredentials.run(db)
}

/** Execute test helper query `listAllDeferredCalls`. */
export function listAllDeferredCalls(sql: SqlStorage) {
  return queries.listAllDeferredCalls.runSync(sql)
}

/** Execute test helper query `listAllEventInbox`. */
export function listAllEventInbox(sql: SqlStorage) {
  return queries.listAllEventInbox.runSync(sql)
}

/** Execute test helper query `listAllKnownUrls`. */
export function listAllKnownUrls(sql: SqlStorage) {
  return queries.listAllKnownUrls.runSync(sql)
}

/** Execute test helper query `listAllMemoryJobs`. */
export function listAllMemoryJobs(sql: SqlStorage) {
  return queries.listAllMemoryJobs.runSync(sql)
}

/** Execute test helper query `listAllNotifications`. */
export function listAllNotifications(sql: SqlStorage) {
  return queries.listAllNotifications.runSync(sql)
}

/** Execute test helper query `listAllPruneRuns`. */
export function listAllPruneRuns(sql: SqlStorage) {
  return queries.listAllPruneRuns.runSync(sql)
}

/** Execute test helper query `listAllRevisionClaims`. */
export function listAllRevisionClaims(db: MemoryDb) {
  return queries.listAllRevisionClaims.run(db)
}

/** Execute test helper query `listAllScheduledOccurrences`. */
export function listAllScheduledOccurrences(sql: SqlStorage) {
  return queries.listAllScheduledOccurrences.runSync(sql)
}

/** Execute test helper query `listAllScheduledTasks`. */
export function listAllScheduledTasks(sql: SqlStorage) {
  return queries.listAllScheduledTasks.runSync(sql)
}

/** Execute test helper query `listAllSystemSettings`. */
export function listAllSystemSettings(db: ManagementDb) {
  return queries.listAllSystemSettings.run(db)
}

/** Execute test helper query `listAllUsage`. */
export function listAllUsage(sql: SqlStorage) {
  return queries.listAllUsage.runSync(sql)
}

/** Execute test helper query `listArchiveSegmentsByAgent`. */
export function listArchiveSegmentsByAgent(db: MemoryDb, params: { agentId: string }) {
  return queries.listArchiveSegmentsByAgent.run(db, params)
}

/** Execute test helper query `listAuditByAction`. */
export function listAuditByAction(db: ManagementDb, params: { action: string }) {
  return queries.listAuditByAction.run(db, params)
}

/** Execute test helper query `listAuditByTarget`. */
export function listAuditByTarget(db: ManagementDb, params: { targetId: string }) {
  return queries.listAuditByTarget.run(db, params)
}

/** Execute test helper query `listMcpAssignmentsByAgent`. */
export function listMcpAssignmentsByAgent(db: ManagementDb, params: { agentId: string }) {
  return queries.listMcpAssignmentsByAgent.run(db, params)
}

/** Execute test helper query `listMcpAssignmentsByAgentServer`. */
export function listMcpAssignmentsByAgentServer(
  db: ManagementDb,
  params: { agentId: string; serverId: string },
) {
  return queries.listMcpAssignmentsByAgentServer.run(db, params)
}

/** Execute test helper query `listMcpProposalsByRequest`. */
export function listMcpProposalsByRequest(db: ManagementDb, params: { requestId: string }) {
  return queries.listMcpProposalsByRequest.run(db, params)
}

/** Execute test helper query `listMcpRequestsBySourceAgent`. */
export function listMcpRequestsBySourceAgent(db: ManagementDb, params: { sourceAgentId: string }) {
  return queries.listMcpRequestsBySourceAgent.run(db, params)
}

/** Execute test helper query `listMemoryLedgerByAction`. */
export function listMemoryLedgerByAction(db: MemoryDb, params: { action: string }) {
  return queries.listMemoryLedgerByAction.run(db, params)
}

/** Execute test helper query `listMemoryLedgerByOp`. */
export function listMemoryLedgerByOp(db: MemoryDb, params: { opId: string }) {
  return queries.listMemoryLedgerByOp.run(db, params)
}

/** Execute test helper query `listMemoryLedgerByRun`. */
export function listMemoryLedgerByRun(db: MemoryDb, params: { runId: string }) {
  return queries.listMemoryLedgerByRun.run(db, params)
}

/** Execute test helper query `listMemoryOpsByIds`. */
export function listMemoryOpsByIds(db: MemoryDb, params: { opIdsJson: string }) {
  return queries.listMemoryOpsByIds.run(db, params)
}

/** Execute test helper query `listMemoryRecordsByContent`. */
export function listMemoryRecordsByContent(db: MemoryDb, params: { content: string }) {
  return queries.listMemoryRecordsByContent.run(db, params)
}

/** Execute test helper query `listMemoryRecordsByScopeUseCount`. */
export function listMemoryRecordsByScopeUseCount(
  db: MemoryDb,
  params: { scope: string; useCount: number },
) {
  return queries.listMemoryRecordsByScopeUseCount.run(db, params)
}

/** Execute test helper query `listMemoryTermsByRecord`. */
export function listMemoryTermsByRecord(db: MemoryDb, params: { recordId: string }) {
  return queries.listMemoryTermsByRecord.run(db, params)
}

/** Execute test helper query `listPiEntryHeads`. */
export function listPiEntryHeads(sql: SqlStorage) {
  return queries.listPiEntryHeads.runSync(sql)
}

/** Execute test helper query `listPiEntryIds`. */
export function listPiEntryIds(sql: SqlStorage) {
  return queries.listPiEntryIds.runSync(sql)
}

/** Execute test helper query `listPiEntryRecords`. */
export function listPiEntryRecords(sql: SqlStorage) {
  return queries.listPiEntryRecords.runSync(sql)
}

/** Execute test helper query `listScheduledOccurrencesByTask`. */
export function listScheduledOccurrencesByTask(sql: SqlStorage, params: { taskId: string }) {
  return queries.listScheduledOccurrencesByTask.runSync(sql, params)
}

/** Execute test helper query `listUsageDailyByAgent`. */
export function listUsageDailyByAgent(db: ManagementDb, params: { chargedAgentId: string }) {
  return queries.listUsageDailyByAgent.run(db, params)
}

/** Execute test helper query `updateAgentSlug`. */
export function updateAgentSlug(
  db: ManagementDb,
  params: { slug?: string | null; agentId: string },
) {
  return queries.updateAgentSlug.run(db, params)
}

/** Execute test helper query `updateAgentStatus`. */
export function updateAgentStatus(db: ManagementDb, params: { status: string; agentId: string }) {
  return queries.updateAgentStatus.run(db, params)
}

/** Execute test helper query `updateAgentStatusReturning`. */
export function updateAgentStatusReturning(
  db: ManagementDb,
  params: { status: string; agentId: string },
) {
  return queries.updateAgentStatusReturning.run(db, params)
}

/** Execute test helper query `updateAgentVersions`. */
export function updateAgentVersions(
  db: ManagementDb,
  params: { currentVersion: number; appliedVersion: number; agentId: string },
) {
  return queries.updateAgentVersions.run(db, params)
}

/** Prepare test helper statement `updateAgentVersions` for a D1 batch. */
export function updateAgentVersionsStatement(
  db: ManagementDb,
  params: { currentVersion: number; appliedVersion: number; agentId: string },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateAgentVersions, params)
}

/** Execute test helper query `updateAllContactRequestsRetryAt`. */
export function updateAllContactRequestsRetryAt(sql: SqlStorage, params: { retryAt: number }) {
  return queries.updateAllContactRequestsRetryAt.runSync(sql, params)
}

/** Execute test helper query `updateAllScheduledTasksState`. */
export function updateAllScheduledTasksState(sql: SqlStorage, params: { state: string }) {
  return queries.updateAllScheduledTasksState.runSync(sql, params)
}

/** Execute test helper query `updateArtifactExpiresAt`. */
export function updateArtifactExpiresAt(
  sql: SqlStorage,
  params: { expiresAt: number; id: string },
) {
  return queries.updateArtifactExpiresAt.runSync(sql, params)
}

/** Execute test helper query `updateArtifactStorageKey`. */
export function updateArtifactStorageKey(
  sql: SqlStorage,
  params: { storageKey: string; expiresAt: number; id: string },
) {
  return queries.updateArtifactStorageKey.runSync(sql, params)
}

/** Execute test helper query `updateClearCredentialEnvelope`. */
export function updateClearCredentialEnvelope(
  db: ManagementDb,
  params: { status: string; credentialId: string },
) {
  return queries.updateClearCredentialEnvelope.run(db, params)
}

/** Execute test helper query `updateConfigVersionSettings`. */
export function updateConfigVersionSettings(
  db: ManagementDb,
  params: { settingsJson: string; agentId: string },
) {
  return queries.updateConfigVersionSettings.run(db, params)
}

/** Execute test helper query `updateContactRequestFailed`. */
export function updateContactRequestFailed(
  sql: SqlStorage,
  params: { settledAt?: number | null; id: string },
) {
  return queries.updateContactRequestFailed.runSync(sql, params)
}

/** Execute test helper query `updateContactRequestsRetryAtDue`. */
export function updateContactRequestsRetryAtDue(
  sql: SqlStorage,
  params: { retryAt: number; id?: string | null },
) {
  return queries.updateContactRequestsRetryAtDue.runSync(sql, params)
}

/** Execute test helper query `updateCredentialCiphertext`. */
export function updateCredentialCiphertext(
  db: ManagementDb,
  params: { ciphertext?: string | null; credentialId: string },
) {
  return queries.updateCredentialCiphertext.run(db, params)
}

/** Execute test helper query `updateCredentialHealthFields`. */
export function updateCredentialHealthFields(
  db: ManagementDb,
  params: {
    ciphertext?: string | null
    wrappedDek?: string | null
    lastUsedAt?: number | null
    lastRefreshedAt?: number | null
    refreshFailures: number
    lastRefreshFailureAt?: number | null
    lastRefreshFailureCategory?: string | null
    credentialId: string
  },
) {
  return queries.updateCredentialHealthFields.run(db, params)
}

/** Execute test helper query `updateCredentialLease`. */
export function updateCredentialLease(
  db: ManagementDb,
  params: { leaseId?: string | null; leaseExpiresAt?: number | null; credentialId: string },
) {
  return queries.updateCredentialLease.run(db, params)
}

/** Execute test helper query `updateCredentialStatus`. */
export function updateCredentialStatus(
  db: ManagementDb,
  params: { status: string; credentialId: string },
) {
  return queries.updateCredentialStatus.run(db, params)
}

/** Execute test helper query `updateLeasedCredentialFields`. */
export function updateLeasedCredentialFields(
  db: ManagementDb,
  params: {
    leaseExpiresAt?: number | null
    revision: number
    status: string
    leaseId?: string | null
    credentialId: string
  },
) {
  return queries.updateLeasedCredentialFields.run(db, params)
}

/** Execute test helper query `updateMcpOauthTransactionStatus`. */
export function updateMcpOauthTransactionStatus(
  db: ManagementDb,
  params: { status: string; credentialId?: string | null; transactionId: string },
) {
  return queries.updateMcpOauthTransactionStatus.run(db, params)
}

/** Execute test helper query `updateMcpRequestExpiresAt`. */
export function updateMcpRequestExpiresAt(
  db: ManagementDb,
  params: { expiresAt: number; requestId: string },
) {
  return queries.updateMcpRequestExpiresAt.run(db, params)
}

/** Prepare test helper statement `updateMcpRequestExpiresAt` for a D1 batch. */
export function updateMcpRequestExpiresAtStatement(
  db: ManagementDb,
  params: { expiresAt: number; requestId: string },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateMcpRequestExpiresAt, params)
}

/** Execute test helper query `updateMcpServerEnabled`. */
export function updateMcpServerEnabled(
  db: ManagementDb,
  params: { enabled: number; serverId: string },
) {
  return queries.updateMcpServerEnabled.run(db, params)
}

/** Prepare test helper statement `updateMcpServerEnabled` for a D1 batch. */
export function updateMcpServerEnabledStatement(
  db: ManagementDb,
  params: { enabled: number; serverId: string },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateMcpServerEnabled, params)
}

/** Execute test helper query `updateMcpServerRevision`. */
export function updateMcpServerRevision(
  db: ManagementDb,
  params: { revision: number; serverId: string },
) {
  return queries.updateMcpServerRevision.run(db, params)
}

/** Execute test helper query `updateMemoryJobCreatedAt`. */
export function updateMemoryJobCreatedAt(
  sql: SqlStorage,
  params: { createdAt: number; jobId: string },
) {
  return queries.updateMemoryJobCreatedAt.runSync(sql, params)
}

/** Execute test helper query `updateMemoryJobNotBefore`. */
export function updateMemoryJobNotBefore(
  sql: SqlStorage,
  params: { notBefore: number; jobId: string },
) {
  return queries.updateMemoryJobNotBefore.runSync(sql, params)
}

/** Execute test helper query `updateMemoryJobSettled`. */
export function updateMemoryJobSettled(
  sql: SqlStorage,
  params: { outcome?: string | null; jobId: string },
) {
  return queries.updateMemoryJobSettled.runSync(sql, params)
}

/** Execute test helper query `updateMemoryJobStartedAt`. */
export function updateMemoryJobStartedAt(
  sql: SqlStorage,
  params: { startedAt?: number | null; jobId: string },
) {
  return queries.updateMemoryJobStartedAt.runSync(sql, params)
}

/** Execute test helper query `updateMemoryRecordStatus`. */
export function updateMemoryRecordStatus(db: MemoryDb, params: { status: string; id: string }) {
  return queries.updateMemoryRecordStatus.run(db, params)
}

/** Execute test helper query `updateNotificationsExpiresAt`. */
export function updateNotificationsExpiresAt(sql: SqlStorage, params: { expiresAt: number }) {
  return queries.updateNotificationsExpiresAt.runSync(sql, params)
}

/** Execute test helper query `updateNotificationsReadAt`. */
export function updateNotificationsReadAt(sql: SqlStorage, params: { readAt?: number | null }) {
  return queries.updateNotificationsReadAt.runSync(sql, params)
}

/** Execute test helper query `updateReopenRunningMemoryJobRaw`. */
export function updateReopenRunningMemoryJobRaw(sql: SqlStorage, params: { jobId: string }) {
  return queries.updateReopenRunningMemoryJobRaw.runSync(sql, params)
}

/** Execute test helper query `updateResetContactReceipts`. */
export function updateResetContactReceipts(sql: SqlStorage) {
  return queries.updateResetContactReceipts.runSync(sql)
}

/** Execute test helper query `updateResetScheduledOccurrencesDispatching`. */
export function updateResetScheduledOccurrencesDispatching(
  sql: SqlStorage,
  params: { retryAt: number },
) {
  return queries.updateResetScheduledOccurrencesDispatching.runSync(sql, params)
}

/** Execute test helper query `updateScheduledOccurrencesAdmissionAttempts`. */
export function updateScheduledOccurrencesAdmissionAttempts(
  sql: SqlStorage,
  params: { admissionStarted: number | string | boolean; attempts: number },
) {
  return queries.updateScheduledOccurrencesAdmissionAttempts.runSync(sql, params)
}

/** Execute test helper query `updateScheduledOccurrencesAttemptsRetry`. */
export function updateScheduledOccurrencesAttemptsRetry(
  sql: SqlStorage,
  params: { attempts: number; retryAt: number },
) {
  return queries.updateScheduledOccurrencesAttemptsRetry.runSync(sql, params)
}

/** Execute test helper query `updateScheduledOccurrencesRetryAt`. */
export function updateScheduledOccurrencesRetryAt(sql: SqlStorage, params: { retryAt: number }) {
  return queries.updateScheduledOccurrencesRetryAt.runSync(sql, params)
}

/** Execute test helper query `updateScheduledOccurrencesState`. */
export function updateScheduledOccurrencesState(
  sql: SqlStorage,
  params: { state: string; admissionStarted: number | string | boolean },
) {
  return queries.updateScheduledOccurrencesState.runSync(sql, params)
}

/** Execute test helper query `updateScheduledTaskHop`. */
export function updateScheduledTaskHop(
  sql: SqlStorage,
  params: { followupHop: number; id: string },
) {
  return queries.updateScheduledTaskHop.runSync(sql, params)
}

/** Execute test helper query `updateScheduledTaskHopAndRule`. */
export function updateScheduledTaskHopAndRule(
  sql: SqlStorage,
  params: { followupHop: number; rule: string; nextDue?: number | null; id: string },
) {
  return queries.updateScheduledTaskHopAndRule.runSync(sql, params)
}

/** Execute test helper query `updateScheduledTaskRule`. */
export function updateScheduledTaskRule(
  sql: SqlStorage,
  params: { rule: string; nextDue?: number | null; id: string },
) {
  return queries.updateScheduledTaskRule.runSync(sql, params)
}

/** Execute test helper query `updateSkillLastUsedAt`. */
export function updateSkillLastUsedAt(
  db: MemoryDb,
  params: { lastUsedAt?: number | null; agentId: string; name: string },
) {
  return queries.updateSkillLastUsedAt.run(db, params)
}

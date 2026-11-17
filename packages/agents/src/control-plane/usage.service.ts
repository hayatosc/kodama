/** Atomic daily ingestion and usage query service in the management database. @module */
import type { UsagePage, UsageRow } from '../agent/local-db/usage.repository.ts'
import { lastUsedStatement } from '../credentials/health.repository.ts'
import { runBatch } from '../lib/reylo.ts'
import type { UsageQuery } from '../protocol.ts'
import type { ManagementDb } from './db.ts'
import {
  findUsageIngestion,
  getUsageFreshnessRow,
  insertUsageIngestionIgnoreStatement,
  listUsageGroupRows,
  updateUsageIngestionStatement,
  upsertUsageDailyStatement,
} from './usage.repository.ts'
import type { UsageRowFlat } from './usage.repository.ts'

function toUsageGroup(row: UsageRowFlat) {
  return {
    key: row.key,
    attempts: row.attempts,
    failed: row.failed,
    rateLimited: row.rateLimited,
    unknown: row.unknown,
    notApplicable: row.notApplicable,
    reported: {
      attempts: row.reportedAttempts,
      input: row.reportedInput,
      output: row.reportedOutput,
      cacheRead: row.reportedCacheRead,
      cacheWrite: row.reportedCacheWrite,
      totalTokens: row.reportedTotalTokens,
      reasoning: row.reportedReasoning,
      cacheWrite1h: row.reportedCacheWrite1h,
      reasoningReported: row.reportedReasoningReported,
      cacheWrite1hReported: row.reportedCacheWrite1hReported,
      payAsYouGoCatalogCostUsd: row.reportedPayAsYouGoCatalogCostUsd,
      subscriptionApiEquivalentUsd: row.reportedSubscriptionApiEquivalentUsd,
      unattributedCatalogCostUsd: row.reportedUnattributedCatalogCostUsd,
    },
    partial: {
      attempts: row.partialAttempts,
      input: row.partialInput,
      output: row.partialOutput,
      cacheRead: row.partialCacheRead,
      cacheWrite: row.partialCacheWrite,
      totalTokens: row.partialTotalTokens,
      reasoning: row.partialReasoning,
      cacheWrite1h: row.partialCacheWrite1h,
      reasoningReported: row.partialReasoningReported,
      cacheWrite1hReported: row.partialCacheWrite1hReported,
      payAsYouGoCatalogCostUsd: row.partialPayAsYouGoCatalogCostUsd,
      subscriptionApiEquivalentUsd: row.partialSubscriptionApiEquivalentUsd,
      unattributedCatalogCostUsd: row.partialUnattributedCatalogCostUsd,
    },
  }
}

/** Stable group-key pagination; incomplete data never appears as a current measured zero. */
export async function readUsage(
  db: ManagementDb,
  query: UsageQuery & { limit: number },
  now: number,
) {
  const rows = await listUsageGroupRows(db, query)
  const freshness = await getUsageFreshnessRow(db, now - 26 * 3_600_000)
  const groups = rows.slice(0, query.limit).map(toUsageGroup)
  return {
    groups,
    nextCursor: rows.length > query.limit ? (groups.at(-1)?.key ?? null) : null,
    freshness: {
      ...freshness,
      checkedAt: now,
      incomplete:
        freshness.pendingSources > 0 ||
        groups.some((row) => row.unknown > 0 || row.partial.attempts > 0),
    },
  }
}

/** Read the durable cursor, including after an uncertain commit or lost acknowledgment. */
export async function usageCheckpoint(db: ManagementDb, agentId: string) {
  return findUsageIngestion(db, agentId)
}

function bucketStatement(db: ManagementDb, row: UsageRow, agentId: string, after: number) {
  const day = new Date(row.startedAt).toISOString().slice(0, 10)
  const bucket = JSON.stringify([
    day,
    row.chargedAgentId,
    row.credentialId,
    row.credentialKind,
    row.provider,
    row.model,
    row.actorKind,
    row.usageState,
  ])
  return upsertUsageDailyStatement(db, {
    bucket,
    day,
    chargedAgentId: row.chargedAgentId,
    credentialId: row.credentialId,
    credentialKind: row.credentialKind,
    provider: row.provider,
    model: row.model,
    actorKind: row.actorKind,
    usageState: row.usageState,
    failed:
      row.status === 'failed' || row.status === 'aborted' || row.status === 'interrupted' ? 1 : 0,
    rateLimited: row.rateLimited ? 1 : 0,
    input: row.input ?? 0,
    output: row.output ?? 0,
    cacheRead: row.cacheRead ?? 0,
    cacheWrite: row.cacheWrite ?? 0,
    totalTokens: row.totalTokens ?? 0,
    reasoning: row.reasoning ?? 0,
    cacheWrite1h: row.cacheWrite1h ?? 0,
    reasoningReported: row.reasoning === null ? 0 : 1,
    cacheWrite1hReported: row.cacheWrite1h === null ? 0 : 1,
    costUsd: row.totalCost ?? 0,
    agentId,
    after,
  })
}

/** A bounded atomic batch: additions are guarded by the old cursor, which advances last. */
export async function ingestUsage(
  db: ManagementDb,
  agentId: string,
  after: number,
  page: UsagePage,
  now: number,
): Promise<void> {
  if (
    page.rows.length > 20 ||
    page.through < after ||
    page.through !== (page.rows.at(-1)?.seq ?? after)
  )
    throw new TypeError('Invalid usage ingestion page')
  let previous = after
  for (const row of page.rows) {
    if (row.seq <= previous || row.status === 'in_flight')
      throw new TypeError('Invalid terminal usage prefix')
    previous = row.seq
  }
  await runBatch(db, [
    insertUsageIngestionIgnoreStatement(db, agentId),
    ...page.rows.map((row) => bucketStatement(db, row, agentId, after)),
    ...page.rows.flatMap((row) =>
      row.credentialId === null
        ? []
        : [lastUsedStatement(db, row.credentialId, row.startedAt, agentId, after)],
    ),
    updateUsageIngestionStatement(db, {
      through: page.through,
      updatedAt: now,
      caughtUp: !page.more,
      agentId,
      after,
    }),
  ])
}

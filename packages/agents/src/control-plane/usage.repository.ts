/**
 * Data-access repository for daily usage ingestion and aggregated rollups in management D1.
 *
 * @module
 */
import { prepareQuery } from '../lib/reylo.ts'
import type { UsageQuery } from '../protocol.ts'
import type { ManagementDb } from './db.ts'
import { queries } from './queries/index.ts'

/** One flat aggregated usage row returned by a grouped rollup query. */
export type UsageRowFlat = (typeof queries.listUsageByDay)['~reylo']['element']

/** List aggregated usage rows grouped by day, agent, credential, or model. */
export async function listUsageGroupRows(
  db: ManagementDb,
  query: UsageQuery & { limit: number },
): Promise<UsageRowFlat[]> {
  const groupQuery =
    query.groupBy === 'day'
      ? queries.listUsageByDay
      : query.groupBy === 'agent'
        ? queries.listUsageByAgent
        : query.groupBy === 'credential'
          ? queries.listUsageByCredential
          : queries.listUsageByModel
  return groupQuery.run(db, {
    fromDay: query.from,
    toDay: query.to,
    agentId: query.agentId ?? null,
    cursor: query.cursor ?? null,
    limit: query.limit + 1,
  })
}

/** Read overall usage ingestion freshness metadata. */
export async function getUsageFreshnessRow(db: ManagementDb, staleBefore: number) {
  return queries.getUsageFreshness.run(db, { staleBefore })
}

/** Read the ingestion checkpoint row for `agentId`, if present. */
export async function findUsageIngestion(db: ManagementDb, agentId: string) {
  return (await queries.getUsageIngestion.run(db, { agentId })) ?? undefined
}

/** Prepare an idempotent insert initializing a usage ingestion row for `agentId`. */
export function insertUsageIngestionIgnoreStatement(
  db: ManagementDb,
  agentId: string,
): D1PreparedStatement {
  return prepareQuery(db, queries.insertUsageIngestionIgnore, { agentId })
}

/** Parameters for upserting one usage daily bucket. */
export interface UpsertUsageDailyParams {
  bucket: string
  day: string
  chargedAgentId: string
  credentialId: string | null
  credentialKind: string | null
  provider: string
  model: string
  actorKind: string
  usageState: string
  failed: number
  rateLimited: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  reasoning: number
  cacheWrite1h: number
  reasoningReported: number
  cacheWrite1hReported: number
  costUsd: number
  agentId: string
  after: number
}

/** Prepare a statement upserting one daily usage bucket guarded by the agent's cursor. */
export function upsertUsageDailyStatement(
  db: ManagementDb,
  params: UpsertUsageDailyParams,
): D1PreparedStatement {
  return prepareQuery(db, queries.insertUsageDailyUpsert, params)
}

/** Prepare a statement advancing the agent's usage ingestion cursor. */
export function updateUsageIngestionStatement(
  db: ManagementDb,
  params: {
    through: number
    updatedAt: number
    caughtUp: boolean
    agentId: string
    after: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateUsageIngestion, params)
}

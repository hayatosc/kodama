/**
 * Data-access repository for extraction checkpoints in memory D1.
 *
 * @module
 */
import { prepareQuery } from '../../lib/reylo.ts'
import type { MemoryDb } from './db.ts'
import { queries } from './queries/index.ts'

/** The last entry of an agent that extraction has covered, or 0. */
export async function extractionCheckpoint(db: MemoryDb, agentId: string): Promise<number> {
  const row = await queries.getExtractionCheckpoint.run(db, { agentId })
  return row?.lastEntryId ?? 0
}

/** Fetch the current checkpoint row with its revision for compare-and-swap advances. */
export async function findExtractionCheckpointRow(db: MemoryDb, agentId: string) {
  return (await queries.getExtractionCheckpointRow.run(db, { agentId })) ?? undefined
}

/** Prepare a statement inserting an initial extraction checkpoint row. */
export function insertExtractionCheckpointStatement(
  db: MemoryDb,
  agentId: string,
  lastEntryId: number,
  updatedAt: number,
): D1PreparedStatement {
  return prepareQuery(db, queries.insertExtractionCheckpoint, {
    agentId,
    lastEntryId,
    updatedAt,
  })
}

/** Prepare a revision-guarded statement advancing an extraction checkpoint row. */
export function updateExtractionCheckpointStatement(
  db: MemoryDb,
  params: {
    agentId: string
    lastEntryId: number
    nextRevision: number
    revision: number
    updatedAt: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateExtractionCheckpoint, params)
}

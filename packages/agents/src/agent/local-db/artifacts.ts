/** Object-owned artifact metadata and recoverable R2 operation states.
 * @see docs/extensions.md — A: artifacts
 * @module
 */
import type { ArtifactMetadata } from '../../extensions.ts'
import { parseEnum } from '../../lib/reylo.ts'
import type { LocalDb } from './local.ts'
import deleteArtifact from './sql/delete-artifact.sql'
import deletingArtifactQuery from './sql/deleting-artifact.sql'
import insertArtifact from './sql/insert-artifact.sql'
import readyArtifactQuery from './sql/ready-artifact.sql'
import selectArtifactById from './sql/select-artifact-by-id.sql'
import selectArtifactCleanupBounds from './sql/select-artifact-cleanup-bounds.sql'
import selectArtifactCleanupRows from './sql/select-artifact-cleanup-rows.sql'
import selectReadyArtifacts from './sql/select-ready-artifacts.sql'

const ARTIFACT_STATES = ['uploading', 'ready', 'deleting'] as const

/** Permitted lifecycle state of a stored artifact reservation. */
export type ArtifactState = (typeof ARTIFACT_STATES)[number]

/** Internal reservation, including the key that must never be returned as public metadata. */
export interface ArtifactRow {
  id: string
  filename: string
  mediaType: string
  size: number
  storageKey: string
  state: ArtifactState
  sourceTask: string | null
  createdAt: number
  expiresAt: number
}

/** Interrupted uploads are collected after this grace period. */
export const ARTIFACT_UPLOAD_GRACE_MS = 60_000

function parseArtifactRow(row: {
  id: string
  filename: string
  mediaType: string
  size: number
  storageKey: string
  state: string
  sourceTask: string | null
  createdAt: number
  expiresAt: number
}): ArtifactRow {
  return {
    ...row,
    state: parseEnum(ARTIFACT_STATES, row.state, 'artifact state'),
  }
}

/** Reserve before starting R2 IO. */
export function reserveArtifact(db: LocalDb, row: ArtifactRow): void {
  insertArtifact.runSync(db.sql, row)
}

/** A local ID lookup is the ownership check, not an R2 key supplied by a caller. */
export function artifactRow(db: LocalDb, id: string): ArtifactRow | undefined {
  const row = selectArtifactById.runSync(db.sql, { id })
  return row === null ? undefined : parseArtifactRow(row)
}

/** Publish only a reservation that has not been withdrawn. */
export function readyArtifact(db: LocalDb, id: string): void {
  readyArtifactQuery.runSync(db.sql, { id })
}

/** Hide metadata before attempting deletion; the retained row is the retry record. */
export function deletingArtifact(db: LocalDb, id: string): void {
  deletingArtifactQuery.runSync(db.sql, { id })
}

/** Forget only after R2 deletion succeeds. */
export function forgetArtifact(db: LocalDb, id: string): void {
  deleteArtifact.runSync(db.sql, { id })
}

/** Public metadata deliberately excludes state, source identity and storage key. */
export function artifactMetadata(row: ArtifactRow): ArtifactMetadata {
  return {
    artifactId: row.id,
    filename: row.filename,
    mediaType: row.mediaType,
    size: row.size,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }
}

/** Stable ascending ID pagination over unexpired, ready artifacts only. */
export function listArtifacts(db: LocalDb, page: { cursor?: string; limit: number }, now: number) {
  return selectReadyArtifacts
    .runSync(db.sql, {
      cursor: page.cursor ? page.cursor : null,
      now,
      limit: page.limit,
    })
    .map((row) => artifactMetadata(parseArtifactRow(row)))
}

/** Bound each cleanup pass, leaving the remaining rows for another wake. */
export function artifactCleanupRows(db: LocalDb, now: number): ArtifactRow[] {
  return selectArtifactCleanupRows
    .runSync(db.sql, {
      now,
      uploadBefore: now - ARTIFACT_UPLOAD_GRACE_MS,
    })
    .map(parseArtifactRow)
}

/** Earliest durable deadline, including interrupted uploads and failed deletes. */
export function nextArtifactCleanup(db: LocalDb, now: number): number | undefined {
  const times = ARTIFACT_STATES.map((state) => {
    const row = selectArtifactCleanupBounds.runSync(db.sql, { state })
    if (row.expiresAt === null || row.createdAt === null) return undefined
    if (state === 'deleting') return now
    return state === 'uploading'
      ? Math.min(row.expiresAt, row.createdAt + ARTIFACT_UPLOAD_GRACE_MS)
      : row.expiresAt
  }).filter((at) => at !== undefined)
  return times.length ? Math.min(...times) : undefined
}

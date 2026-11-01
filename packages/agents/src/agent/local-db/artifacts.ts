/** Object-owned artifact metadata and recoverable R2 operation states.
 * @see docs/extensions.md — A: artifacts
 * @module
 */
import { and, asc, eq, gt, lte, min, or } from 'drizzle-orm'
import { artifacts } from '../../../drizzle/durable-object/schema.ts'
import type { ArtifactMetadata } from '../../extensions.ts'
import type { LocalDb } from './local.ts'

/** Internal reservation, including the key that must never be returned as public metadata. */
export type ArtifactRow = typeof artifacts.$inferSelect
/** Interrupted uploads are collected after this grace period. */
export const ARTIFACT_UPLOAD_GRACE_MS = 60_000

/** Reserve before starting R2 IO. */
export function reserveArtifact(db: LocalDb, row: ArtifactRow): void {
  db.insert(artifacts).values(row).run()
}

/** A local ID lookup is the ownership check, not an R2 key supplied by a caller. */
export function artifactRow(db: LocalDb, id: string): ArtifactRow | undefined {
  return db.select().from(artifacts).where(eq(artifacts.id, id)).get()
}

/** Publish only a reservation that has not been withdrawn. */
export function readyArtifact(db: LocalDb, id: string): void {
  db.update(artifacts)
    .set({ state: 'ready' })
    .where(and(eq(artifacts.id, id), eq(artifacts.state, 'uploading')))
    .run()
}

/** Hide metadata before attempting deletion; the retained row is the retry record. */
export function deletingArtifact(db: LocalDb, id: string): void {
  db.update(artifacts).set({ state: 'deleting' }).where(eq(artifacts.id, id)).run()
}

/** Forget only after R2 deletion succeeds. */
export function forgetArtifact(db: LocalDb, id: string): void {
  db.delete(artifacts).where(eq(artifacts.id, id)).run()
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
  return db
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.state, 'ready'),
        gt(artifacts.expiresAt, now),
        page.cursor ? gt(artifacts.id, page.cursor) : undefined,
      ),
    )
    .orderBy(asc(artifacts.id))
    .limit(page.limit)
    .all()
    .map(artifactMetadata)
}

/** Bound each cleanup pass, leaving the remaining rows for another wake. */
export function artifactCleanupRows(db: LocalDb, now: number): ArtifactRow[] {
  return db
    .select()
    .from(artifacts)
    .where(
      or(
        eq(artifacts.state, 'deleting'),
        lte(artifacts.expiresAt, now),
        and(
          eq(artifacts.state, 'uploading'),
          lte(artifacts.createdAt, now - ARTIFACT_UPLOAD_GRACE_MS),
        ),
      ),
    )
    .limit(100)
    .all()
}

/** Earliest durable deadline, including interrupted uploads and failed deletes. */
export function nextArtifactCleanup(db: LocalDb, now: number): number | undefined {
  const states = ['ready', 'uploading', 'deleting'] as const
  const times = states
    .map((state) => {
      const row = db
        .select({ expiresAt: min(artifacts.expiresAt), createdAt: min(artifacts.createdAt) })
        .from(artifacts)
        .where(eq(artifacts.state, state))
        .get()
      if (!row || row.expiresAt === null || row.createdAt === null) return undefined
      if (state === 'deleting') return now
      return state === 'uploading'
        ? Math.min(row.expiresAt, row.createdAt + ARTIFACT_UPLOAD_GRACE_MS)
        : row.expiresAt
    })
    .filter((at) => at !== undefined)
  return times.length ? Math.min(...times) : undefined
}

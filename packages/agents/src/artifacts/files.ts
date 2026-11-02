/** Arbitrary bytes in R2, with durable reservations and retryable deletion.
 * Callers serialize operations per owner, including cleanup, around asynchronous R2 IO.
 * @see docs/extensions.md — A: artifacts
 * @module
 */
import type { ArtifactMetadata, ArtifactUpload } from '../extensions.ts'
import { EXTENSION_RETENTION_MS, MAX_ARTIFACT_BYTES } from '../extensions.ts'
import { uuidv7 } from '../lib/uuid.ts'
import {
  ArtifactUploadSchema,
  ExtensionIdSchema,
  ExtensionPageSchema,
  parseInput,
} from '../validation.ts'
import type { LocalDb } from '../agent/local-db/local.ts'
import {
  artifactCleanupRows,
  artifactMetadata,
  artifactRow,
  deletingArtifact,
  forgetArtifact,
  listArtifacts,
  nextArtifactCleanup,
  readyArtifact,
  reserveArtifact,
} from '../agent/local-db/artifacts.ts'

/** Persist the next cleanup wake before starting an operation with external effects. */
export type ArtifactWake = (at: number | undefined) => Promise<void>

function prefix(owner: string): string {
  return `artifacts/${encodeURIComponent(owner)}/`
}

/** Recover the next deadline after a stop without scanning the archive bucket. */
export function rearmArtifacts(db: LocalDb, wake: ArtifactWake, now = Date.now()): Promise<void> {
  return wake(nextArtifactCleanup(db, now))
}

/** Reserve, upload and publish; an interrupted operation remains hidden and collectible. */
export async function uploadArtifact(
  db: LocalDb,
  bucket: R2Bucket,
  owner: string,
  upload: ArtifactUpload,
  wake: ArtifactWake,
): Promise<ArtifactMetadata> {
  const input = parseInput(ArtifactUploadSchema, upload)
  const now = Date.now()
  const id = uuidv7()
  // Arm first: a stop between reservation and R2 must still leave a retry wake.
  await wake(now)
  const row = {
    id,
    filename: input.filename,
    mediaType: input.mediaType,
    size: input.bytes.byteLength,
    storageKey: `${prefix(owner)}${id}`,
    state: 'uploading',
    sourceTask: null,
    createdAt: now,
    expiresAt: now + EXTENSION_RETENTION_MS,
  } as const
  reserveArtifact(db, row)
  await bucket.put(row.storageKey, input.bytes, {
    httpMetadata: { contentType: 'application/octet-stream' },
  })
  readyArtifact(db, id)
  await rearmArtifacts(db, wake)
  return artifactMetadata(row)
}

/** List metadata, never bytes or internal keys; a cursor grants no additional authority. */
export function readArtifacts(db: LocalDb, page: { cursor?: string; limit?: number } = {}) {
  return listArtifacts(db, parseInput(ExtensionPageSchema, page), Date.now())
}

/** Read only an owner's ready, unexpired bytes; media types are never executed or interpreted. */
export async function downloadArtifact(db: LocalDb, bucket: R2Bucket, owner: string, id: string) {
  const row = artifactRow(db, parseInput(ExtensionIdSchema, id))
  if (!row || row.state !== 'ready' || row.expiresAt <= Date.now())
    throw new Error('artifact_unavailable')
  if (!row.storageKey.startsWith(prefix(owner))) throw new Error('artifact_unavailable')
  const object = await bucket.get(row.storageKey)
  if (!object || object.size !== row.size || object.size > MAX_ARTIFACT_BYTES)
    throw new Error('artifact_unavailable')
  const bytes = new Uint8Array(await object.arrayBuffer())
  if (bytes.byteLength !== row.size) throw new Error('artifact_unavailable')
  return { ...artifactMetadata(row), bytes }
}

/** Retryable deletion: absent local IDs are no-ops; local rows with foreign storage keys reject. */
export async function deleteArtifact(
  db: LocalDb,
  bucket: R2Bucket,
  owner: string,
  id: string,
  wake: ArtifactWake,
): Promise<void> {
  const row = artifactRow(db, parseInput(ExtensionIdSchema, id))
  if (!row) return
  if (!row.storageKey.startsWith(prefix(owner))) throw new Error('artifact_unavailable')
  await wake(Date.now())
  deletingArtifact(db, id)
  await bucket.delete(row.storageKey)
  forgetArtifact(db, id)
  await rearmArtifacts(db, wake)
}

/** Retry orphan uploads, expired artifacts and failed deletes using only local retry records. */
export async function cleanupArtifacts(
  db: LocalDb,
  bucket: R2Bucket,
  owner: string,
  wake: ArtifactWake,
  now = Date.now(),
): Promise<void> {
  for (const row of artifactCleanupRows(db, now)) {
    if (!row.storageKey.startsWith(prefix(owner))) throw new Error('artifact_unavailable')
    deletingArtifact(db, row.id)
    await bucket.delete(row.storageKey)
    forgetArtifact(db, row.id)
  }
  await rearmArtifacts(db, wake, now)
}

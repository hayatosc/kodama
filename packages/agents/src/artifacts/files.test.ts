/** Binary ownership, retention and recoverable R2 transitions against real object SQLite. @module */
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { artifacts } from '../../drizzle/durable-object/schema.ts'
import { openLocalDb } from '../agent/local-db/local.ts'
import { setAlarm } from '../agent/runtime/alarms.ts'
import { artifactRow, ARTIFACT_UPLOAD_GRACE_MS } from '../agent/local-db/artifacts.ts'
import { EXTENSION_RETENTION_MS, MAX_ARTIFACT_BYTES } from '../extensions.ts'
import { newAgentId } from '../testing/management.ts'
import { rejectionInObject } from '../testing/rpc.ts'
import {
  cleanupArtifacts,
  deleteArtifact,
  downloadArtifact,
  readArtifacts,
  uploadArtifact,
} from './files.ts'

const wake = async (_at: number | undefined) => undefined
const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
)
const zip = new Uint8Array([80, 75, 5, 6, ...Array.from({ length: 18 }, () => 0)])
afterEach(() => vi.restoreAllMocks())

it('round trips PNG and ZIP bytes through owner RPC, eviction, pagination and deletion', async () => {
  const owner = await newAgentId()
  const other = await newAgentId()
  const first = await exports.default.uploadArtifact(owner, {
    filename: 'pixel.png',
    mediaType: 'image/png',
    bytes: png,
  })
  const second = await exports.default.uploadArtifact(owner, {
    filename: 'empty.zip',
    mediaType: 'application/zip',
    bytes: zip,
  })
  expect(first.expiresAt - first.createdAt).toBe(EXTENSION_RETENTION_MS)
  expect(Object.keys(first).sort()).toEqual([
    'artifactId',
    'createdAt',
    'expiresAt',
    'filename',
    'mediaType',
    'size',
  ])
  await evictDurableObject(env.AGENTS.getByName(owner))
  expect(await exports.default.listArtifacts(owner, { limit: 1 })).toEqual([first])
  expect(await exports.default.listArtifacts(owner, { cursor: first.artifactId })).toEqual([second])
  expect((await exports.default.downloadArtifact(owner, first.artifactId)).bytes).toEqual(png)
  expect((await exports.default.downloadArtifact(owner, second.artifactId)).bytes).toEqual(zip)
  expect(await exports.default.listArtifacts(other)).toEqual([])
  expect(
    await rejectionInObject(env.AGENTS.getByName(other), (agent) =>
      agent.downloadArtifact(first.artifactId),
    ),
  ).toContain('artifact_unavailable')
  await exports.default.deleteArtifact(other, first.artifactId)
  expect((await exports.default.downloadArtifact(owner, first.artifactId)).bytes).toEqual(png)
  await exports.default.deleteArtifact(owner, first.artifactId)
  await exports.default.deleteArtifact(owner, first.artifactId)
  expect(await exports.default.listArtifacts(owner)).toEqual([second])
  expect(await env.ARCHIVE.get(`artifacts/${owner}/${first.artifactId}`)).toBeNull()
})

it('accepts arbitrary formats and the exact byte boundary, refusing oversized uploads before R2', async () => {
  const owner = await newAgentId()
  const accepted = await exports.default.uploadArtifact(owner, {
    filename: 'opaque.custom',
    mediaType: 'application/x-unknown',
    bytes: new Uint8Array(MAX_ARTIFACT_BYTES),
  })
  expect(accepted.size).toBe(MAX_ARTIFACT_BYTES)
  expect(
    await rejectionInObject(env.AGENTS.getByName(owner), (agent) =>
      agent.uploadArtifact({
        filename: 'large.bin',
        mediaType: 'application/octet-stream',
        bytes: new Uint8Array(MAX_ARTIFACT_BYTES + 1),
      }),
    ),
  ).toContain('TypeError')
  expect(await exports.default.listArtifacts(owner)).toEqual([accepted])
})

it('collects a hidden reservation after R2 committed but the upload response was lost', async () => {
  const owner = await newAgentId()
  const stub = env.AGENTS.getByName(owner)
  let id = ''
  await runInDurableObject(stub, async (_, state) => {
    const db = await openLocalDb(state.storage)
    const put = env.ARCHIVE.put.bind(env.ARCHIVE)
    const failure = vi.spyOn(env.ARCHIVE, 'put').mockImplementation(async (...args) => {
      await put(...args)
      throw new Error('lost_upload_response')
    })
    await expect(
      uploadArtifact(
        db,
        env.ARCHIVE,
        owner,
        { filename: 'orphan.zip', mediaType: 'application/zip', bytes: zip },
        wake,
      ),
    ).rejects.toThrow('lost_upload_response')
    failure.mockRestore()
    const row = db.select().from(artifacts).get()
    if (!row) throw new Error('Missing reservation')
    id = row.id
    expect(row.state).toBe('uploading')
    expect(readArtifacts(db)).toEqual([])
    expect(await env.ARCHIVE.get(row.storageKey)).not.toBeNull()
    await expect(downloadArtifact(db, env.ARCHIVE, owner, id)).rejects.toThrow(
      'artifact_unavailable',
    )
  })
  await evictDurableObject(stub)
  await runInDurableObject(stub, async (_, state) => {
    const db = await openLocalDb(state.storage)
    await cleanupArtifacts(db, env.ARCHIVE, owner, wake, Date.now() + ARTIFACT_UPLOAD_GRACE_MS + 1)
    expect(artifactRow(db, id)).toBeUndefined()
    expect(await env.ARCHIVE.get(`artifacts/${owner}/${id}`)).toBeNull()
  })
})

it('hides a failed deletion and retries it after eviction without touching archived objects', async () => {
  const owner = await newAgentId()
  const stub = env.AGENTS.getByName(owner)
  const file = await exports.default.uploadArtifact(owner, {
    filename: 'delete.png',
    mediaType: 'image/png',
    bytes: png,
  })
  await env.ARCHIVE.put('archive/sentinel', zip)
  await runInDurableObject(stub, async (_, state) => {
    const db = await openLocalDb(state.storage)
    const failure = vi.spyOn(env.ARCHIVE, 'delete').mockRejectedValue(new Error('r2_unavailable'))
    await expect(deleteArtifact(db, env.ARCHIVE, owner, file.artifactId, wake)).rejects.toThrow(
      'r2_unavailable',
    )
    failure.mockRestore()
    expect(artifactRow(db, file.artifactId)?.state).toBe('deleting')
    expect(readArtifacts(db)).toEqual([])
  })
  await evictDurableObject(stub)
  await runInDurableObject(stub, async (_, state) => {
    const db = await openLocalDb(state.storage)
    await cleanupArtifacts(db, env.ARCHIVE, owner, wake)
    expect(artifactRow(db, file.artifactId)).toBeUndefined()
  })
  expect(await env.ARCHIVE.get(`artifacts/${owner}/${file.artifactId}`)).toBeNull()
  expect(await env.ARCHIVE.get('archive/sentinel')).not.toBeNull()
})

it('collects expired bytes through the shared purpose-based object alarm', async () => {
  const owner = await newAgentId()
  const file = await exports.default.uploadArtifact(owner, {
    filename: 'expires.png',
    mediaType: 'image/png',
    bytes: png,
  })
  const stub = env.AGENTS.getByName(owner)
  await runInDurableObject(stub, async (_, state) => {
    const db = await openLocalDb(state.storage)
    db.update(artifacts)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(artifacts.id, file.artifactId))
      .run()
    await setAlarm(state.storage, 'artifacts', Date.now() - 1)
  })
  await runDurableObjectAlarm(stub)
  expect(await exports.default.listArtifacts(owner)).toEqual([])
  expect(await env.ARCHIVE.get(`artifacts/${owner}/${file.artifactId}`)).toBeNull()
})

it('hides expired artifacts before cleanup and refuses even a local row with a foreign key', async () => {
  const owner = await newAgentId()
  const file = await exports.default.uploadArtifact(owner, {
    filename: 'expires.zip',
    mediaType: 'application/zip',
    bytes: zip,
  })
  await runInDurableObject(env.AGENTS.getByName(owner), async (_, state) => {
    const db = await openLocalDb(state.storage)
    db.update(artifacts)
      .set({ storageKey: `artifacts/another/${file.artifactId}` })
      .where(eq(artifacts.id, file.artifactId))
      .run()
    await expect(downloadArtifact(db, env.ARCHIVE, owner, file.artifactId)).rejects.toThrow(
      'artifact_unavailable',
    )
    await expect(deleteArtifact(db, env.ARCHIVE, owner, file.artifactId, wake)).rejects.toThrow(
      'artifact_unavailable',
    )
    db.update(artifacts)
      .set({ storageKey: `artifacts/${owner}/${file.artifactId}`, expiresAt: Date.now() - 1 })
      .where(eq(artifacts.id, file.artifactId))
      .run()
    expect(readArtifacts(db)).toEqual([])
    await expect(downloadArtifact(db, env.ARCHIVE, owner, file.artifactId)).rejects.toThrow(
      'artifact_unavailable',
    )
    await cleanupArtifacts(db, env.ARCHIVE, owner, wake)
    expect(artifactRow(db, file.artifactId)).toBeUndefined()
  })
  expect(await env.ARCHIVE.get(`artifacts/${owner}/${file.artifactId}`)).toBeNull()
})

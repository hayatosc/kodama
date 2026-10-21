/**
 * Writing skills: overwriting a directory in place as one operation that a stop can finish
 * (docs/memory.md, Storage).
 */
import { and, eq } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import * as v from 'valibot'
import type { MemoryDb } from '../store/db.ts'
import { memoryLedger } from '../../../drizzle/d1/schema/records.ts'
import { skills, skillWrites } from '../../../drizzle/d1/schema/skills.ts'
import type { Scope } from '../../../drizzle/d1/schema/records.ts'
import {
  appliedResult,
  bumpScope,
  claimRevision,
  errorText,
  insertOp,
} from '../store/statements.ts'
import type { OperationContext, OperationResult } from '../store/statements.ts'
import { changesSchema, contentSha256, currentFiles, sha256Hex, storeBlob } from './blobs.ts'
import type { FileChange } from './blobs.ts'
import {
  blobKey,
  isSkillFilePath,
  isSkillName,
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_FILES,
  parseSkillMd,
  skillDir,
} from './paths.ts'

type SkillWriteRow = typeof skillWrites.$inferSelect
type Statement = BatchItem<'sqlite'>

const writeMetaSchema = v.object({
  jobId: v.string(),
  runId: v.string(),
  actor: v.string(),
  description: v.string(),
  status: v.picklist(['proposed', 'active', 'stale', 'archived']),
  evidence: v.string(),
  basedOn: v.nullable(v.string()),
  contentSha256: v.string(),
})

export interface SkillWriteRequest {
  scope: Scope
  name: string
  /** New content per path; null removes the file. Paths not named stay as they are. */
  files: Readonly<Record<string, string | null>>
  /** The revision the writer read; undefined creates the skill. */
  baseRevision: number | undefined
  status: 'proposed' | 'active'
  evidence: string
  basedOn?: string
}

export type WriteResult = OperationResult & { replayed: boolean }

/**
 * Overwrite a skill in place as one operation: blobs first, then a `pending` skill_writes row,
 * then the directory, then one batch for the row, ledger, scope revision, and memory_ops. A stop
 * at any point is finished by `finishPendingSkillWrites`.
 */
export async function writeSkill(
  db: MemoryDb,
  bucket: R2Bucket,
  ctx: OperationContext,
  request: SkillWriteRequest,
): Promise<WriteResult> {
  const earlier = await appliedResult(db, ctx.opId)
  if (earlier !== undefined) return { ...earlier, replayed: true }
  const started = await db.select().from(skillWrites).where(eq(skillWrites.opId, ctx.opId)).get()
  if (started !== undefined) return finishSkillWrite(db, bucket, started, ctx.now)
  if (!isSkillName(request.name)) throw new TypeError(`Invalid skill name: ${request.name}`)

  const current = await db
    .select()
    .from(skills)
    .where(and(eq(skills.scope, request.scope), eq(skills.name, request.name)))
    .get()
  if (request.baseRevision === undefined && current !== undefined) {
    return { status: 'conflict', reason: 'exists', replayed: false }
  }
  if (request.baseRevision !== undefined && current?.revision !== request.baseRevision) {
    return { status: 'conflict', reason: 'target_changed', replayed: false }
  }

  const dir = skillDir(request.scope, request.name)
  const existing =
    current === undefined ? new Map<string, string>() : await currentFiles(bucket, dir)
  const final = new Map(existing)
  const changes: FileChange[] = []
  const uploads = new Map<string, string>()
  for (const [path, content] of Object.entries(request.files)) {
    if (!isSkillFilePath(path)) throw new TypeError(`Invalid skill file path: ${path}`)
    const before = existing.get(path) ?? null
    if (content === null) {
      if (before === null) continue
      changes.push({ path, before, after: null })
      final.delete(path)
      continue
    }
    if (new TextEncoder().encode(content).byteLength > MAX_SKILL_FILE_BYTES) {
      throw new TypeError(`${path} is larger than ${MAX_SKILL_FILE_BYTES} bytes`)
    }
    const after = await sha256Hex(content)
    if (after === before) continue
    changes.push({ path, before, after })
    uploads.set(after, content)
    final.set(path, after)
  }
  if (final.size > MAX_SKILL_FILES)
    throw new TypeError(`A skill has at most ${MAX_SKILL_FILES} files`)

  const skillMd =
    request.files['SKILL.md'] ?? (await (await bucket.get(`${dir}SKILL.md`))?.text()) ?? undefined
  const front = skillMd === undefined || skillMd === null ? undefined : parseSkillMd(skillMd)
  if (front === undefined)
    throw new TypeError('SKILL.md needs frontmatter with name and description')
  if (front.name !== request.name)
    throw new TypeError('The SKILL.md name must match the skill name')
  if (front.description.length === 0 || front.description.length > 1024) {
    throw new TypeError('The description must have 1–1024 characters')
  }

  for (const [sha, content] of uploads) await storeBlob(bucket, sha, content)
  for (const change of changes) {
    if (change.before === null) continue
    const old = await bucket.get(dir + change.path)
    if (old !== null) await storeBlob(bucket, change.before, await old.arrayBuffer())
  }
  const meta: v.InferOutput<typeof writeMetaSchema> = {
    jobId: ctx.jobId,
    runId: ctx.runId,
    actor: ctx.actor,
    description: front.description,
    status: request.status,
    evidence: request.evidence,
    basedOn: request.basedOn ?? null,
    contentSha256: await contentSha256(final),
  }
  const row = {
    opId: ctx.opId,
    scope: request.scope,
    name: request.name,
    baseRevision: current?.revision ?? null,
    filesJson: JSON.stringify(changes),
    skillJson: JSON.stringify(meta),
    status: 'pending' as const,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  }
  await db.insert(skillWrites).values(row).onConflictDoNothing()
  return finishSkillWrite(db, bucket, row, ctx.now)
}

/** Copy the after files into the directory, `SKILL.md` last, then commit the row in one batch. */
async function finishSkillWrite(
  db: MemoryDb,
  bucket: R2Bucket,
  row: SkillWriteRow,
  now: number,
): Promise<WriteResult> {
  const changes = v.parse(changesSchema, JSON.parse(row.filesJson))
  const meta = v.parse(writeMetaSchema, JSON.parse(row.skillJson))
  const dir = skillDir(row.scope, row.name)
  const ordered = [
    ...changes.filter((change) => change.path !== 'SKILL.md'),
    ...changes.filter((change) => change.path === 'SKILL.md'),
  ]
  for (const change of ordered) {
    if (change.after === null) {
      await bucket.delete(dir + change.path)
      continue
    }
    const blob = await bucket.get(blobKey(change.after))
    if (blob === null) throw new Error(`Skill blob ${change.after} is missing`)
    await bucket.put(dir + change.path, await blob.arrayBuffer())
  }

  const ctx: OperationContext = {
    opId: row.opId,
    jobId: meta.jobId,
    runId: meta.runId,
    actor: meta.actor,
    now,
  }
  const key = `${row.scope}/${row.name}`
  const result: OperationResult = { status: 'applied', recordId: key }
  const fields = {
    description: meta.description,
    status: meta.status,
    contentSha256: meta.contentSha256,
    evidenceJson: JSON.stringify(meta.evidence),
    basedOn: meta.basedOn,
    updatedAt: now,
  }
  const upsert: Statement[] =
    row.baseRevision === null
      ? [
          db.insert(skills).values({
            scope: row.scope,
            name: row.name,
            r2Key: dir,
            revision: 1,
            createdAt: now,
            ...fields,
          }),
        ]
      : [
          db
            .update(skills)
            .set({ ...fields, revision: row.baseRevision + 1 })
            .where(
              and(
                eq(skills.scope, row.scope),
                eq(skills.name, row.name),
                eq(skills.revision, row.baseRevision),
              ),
            ),
          claimRevision(db, ctx, 'skill', key, row.baseRevision + 1),
        ]
  const done = db
    .update(skillWrites)
    .set({ status: 'done', updatedAt: now })
    .where(eq(skillWrites.opId, row.opId))
  try {
    await db.batch([
      insertOp(db, ctx, 'skill_write', result),
      ...upsert,
      skillLedger(db, ctx, 'write', key, changes),
      bumpScope(db, ctx, row.scope),
      done,
    ])
  } catch (error) {
    const applied = await appliedResult(db, row.opId)
    if (applied !== undefined) return { ...applied, replayed: true }
    if (!/constraint/i.test(errorText(error))) throw error
    // Only the memory agent writes skills, one job at a time, so this means a bug, not a race.
    await db.batch([
      done,
      skillLedger(db, ctx, 'conflict', key, { reason: 'changed_during_write' }),
    ])
    return { status: 'conflict', reason: 'changed_during_write', replayed: false }
  }
  return { ...result, replayed: false }
}

export function skillLedger(
  db: MemoryDb,
  ctx: OperationContext,
  action: string,
  key: string,
  detail: unknown,
) {
  return db.insert(memoryLedger).values({
    at: ctx.now,
    runId: ctx.runId,
    opId: ctx.opId,
    actor: ctx.actor,
    action,
    target: 'skill',
    targetId: key,
    detailJson: JSON.stringify(detail),
  })
}

/** Finish every write a stop left `pending`; the memory agent runs this on start and before jobs. */
export async function finishPendingSkillWrites(
  db: MemoryDb,
  bucket: R2Bucket,
  now: number,
): Promise<number> {
  const pending = await db
    .select()
    .from(skillWrites)
    .where(eq(skillWrites.status, 'pending'))
    .orderBy(skillWrites.createdAt)
    .limit(20)
  for (const row of pending) await finishSkillWrite(db, bucket, row, now)
  return pending.length
}

/** Skill status changes and rollback, each one operation (docs/design/long-term-memory.md, Lifecycle). */
import { and, eq } from 'drizzle-orm'
import * as v from 'valibot'
import type { MemoryDb } from '../store/db.ts'
import { memoryLedger } from '../store/schema/records.ts'
import { skills } from '../store/schema/skills.ts'
import type { Scope } from '../store/schema/records.ts'
import {
  appliedResult,
  bumpScope,
  claimRevision,
  errorText,
  insertOp,
} from '../store/statements.ts'
import type { OperationContext, OperationResult } from '../store/statements.ts'
import { changesSchema } from './blobs.ts'
import { blobKey, splitKey } from './paths.ts'
import type { SkillStatus } from './paths.ts'
import { skillLedger, writeSkill } from './write.ts'
import type { WriteResult } from './write.ts'

/** Move a skill to another status, guarded by the revision the caller read. */
export async function setSkillStatus(
  db: MemoryDb,
  ctx: OperationContext,
  target: {
    scope: Scope
    name: string
    revision: number
    status: SkillStatus
    absorbedInto?: string
  },
): Promise<WriteResult> {
  const earlier = await appliedResult(db, ctx.opId)
  if (earlier !== undefined) return { ...earlier, replayed: true }
  const key = `${target.scope}/${target.name}`
  if (
    target.absorbedInto !== undefined &&
    !(target.status === 'archived' && target.scope.startsWith('agent:'))
  ) {
    throw new TypeError('Only an archived agent skill is absorbed into a shared one')
  }
  const current = await db
    .select({ revision: skills.revision })
    .from(skills)
    .where(and(eq(skills.scope, target.scope), eq(skills.name, target.name)))
    .get()
  if (current?.revision !== target.revision) {
    return { status: 'conflict', reason: 'target_changed', replayed: false }
  }
  const result: OperationResult = { status: 'applied', recordId: key }
  try {
    await db.batch([
      insertOp(db, ctx, 'skill_status', result),
      claimRevision(db, ctx, 'skill', key, target.revision + 1),
      db
        .update(skills)
        .set({
          status: target.status,
          absorbedInto: target.absorbedInto ?? null,
          revision: target.revision + 1,
          // `updated_at` dates the content, so curation counts from it; only a restore resets it.
          ...(target.status === 'active' ? { updatedAt: ctx.now } : {}),
        })
        .where(
          and(
            eq(skills.scope, target.scope),
            eq(skills.name, target.name),
            eq(skills.revision, target.revision),
          ),
        ),
      skillLedger(db, ctx, target.status, key, { absorbedInto: target.absorbedInto ?? null }),
      bumpScope(db, ctx, target.scope),
    ])
  } catch (error) {
    if (!/constraint/i.test(errorText(error))) throw error
    const applied = await appliedResult(db, ctx.opId)
    if (applied !== undefined) return { ...applied, replayed: true }
    return { status: 'conflict', reason: 'target_changed', replayed: false }
  }
  return { ...result, replayed: false }
}

/** Write a ledger row's before files back, as a new write against the current revision. */
export async function rollbackSkill(
  db: MemoryDb,
  bucket: R2Bucket,
  ctx: OperationContext,
  ledgerSeq: number,
): Promise<WriteResult> {
  const entry = await db.select().from(memoryLedger).where(eq(memoryLedger.seq, ledgerSeq)).get()
  if (entry?.target !== 'skill' || entry.action !== 'write' || entry.detailJson === null) {
    throw new TypeError(`Ledger row ${ledgerSeq} is not a skill write`)
  }
  const [scope, name] = splitKey(entry.targetId)
  const current = await db
    .select()
    .from(skills)
    .where(and(eq(skills.scope, scope), eq(skills.name, name)))
    .get()
  if (current === undefined) return { status: 'conflict', reason: 'missing_skill', replayed: false }
  const files: Record<string, string | null> = {}
  for (const change of v.parse(changesSchema, JSON.parse(entry.detailJson))) {
    if (change.before === null) {
      files[change.path] = null
      continue
    }
    const blob = await bucket.get(blobKey(change.before))
    if (blob === null) throw new Error(`Skill blob ${change.before} is missing`)
    files[change.path] = await blob.text()
  }
  return writeSkill(db, bucket, ctx, {
    scope,
    name,
    files,
    baseRevision: current.revision,
    status: 'active',
    evidence: `rollback of ledger row ${ledgerSeq}`,
    ...(current.basedOn === null ? {} : { basedOn: current.basedOn }),
  })
}

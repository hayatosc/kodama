/** Curating unused skills and deleting unreferenced blobs (docs/design/long-term-memory.md, Lifecycle). */
import { and, eq, inArray } from 'drizzle-orm'
import * as v from 'valibot'
import type { MemoryDb } from '../store/db.ts'
import { memoryLedger } from '../store/schema/records.ts'
import { skills, skillUsage, skillWrites } from '../store/schema/skills.ts'
import { blobKey } from './paths.ts'
import type { SkillStatus } from './paths.ts'
import { changesSchema } from './blobs.ts'
import { setSkillStatus } from './status.ts'

const DAY_MS = 24 * 60 * 60 * 1000
/** Days without use before a skill becomes stale, then archived. */
export const SKILL_CURATION_DAYS = { agent: [14, 30], shared: [30, 60] } as const
/** Blobs no retained ledger row or pending write needs are deleted after this long. */
export const SKILL_BLOB_GRACE_MS = DAY_MS

/**
 * Mark skills stale or archived after days without use (agent skills by their agent, shared
 * skills by anyone), and active again once used. Pinned skills are left alone.
 */
export async function curateSkills(db: MemoryDb, runId: string, now: number): Promise<number> {
  const rows = await db
    .select()
    .from(skills)
    .where(and(inArray(skills.status, ['active', 'stale']), eq(skills.pinned, false)))
  let changed = 0
  for (const skill of rows) {
    const agentId = skill.scope.startsWith('agent:')
      ? skill.scope.slice('agent:'.length)
      : undefined
    const usage = await db
      .select({ lastUsedAt: skillUsage.lastUsedAt })
      .from(skillUsage)
      .where(
        and(
          eq(skillUsage.scope, skill.scope),
          eq(skillUsage.name, skill.name),
          agentId === undefined ? undefined : eq(skillUsage.agentId, agentId),
        ),
      )
    const lastUse = Math.max(skill.updatedAt, ...usage.map((u) => u.lastUsedAt))
    const [staleDays, archiveDays] = SKILL_CURATION_DAYS[agentId === undefined ? 'shared' : 'agent']
    const idle = now - lastUse
    const status: SkillStatus =
      idle >= archiveDays * DAY_MS ? 'archived' : idle >= staleDays * DAY_MS ? 'stale' : 'active'
    if (status === skill.status) continue
    const result = await setSkillStatus(
      db,
      {
        opId: `curate:${skill.scope}/${skill.name}@${skill.revision}`,
        jobId: runId,
        runId,
        actor: 'consolidation',
        now,
      },
      { scope: skill.scope, name: skill.name, revision: skill.revision, status },
    )
    if (result.status === 'applied') changed++
  }
  return changed
}

/**
 * Delete blobs older than the grace period that no retained ledger row or pending write names.
 * Ledger rows outlive the rollback window by design, so a blob lives as long as its rollback can.
 */
export async function forgetSkillBlobs(
  db: MemoryDb,
  bucket: R2Bucket,
  now: number,
): Promise<number> {
  const referenced = new Set<string>()
  const ledger = await db
    .select({ detailJson: memoryLedger.detailJson })
    .from(memoryLedger)
    .where(and(eq(memoryLedger.target, 'skill'), eq(memoryLedger.action, 'write')))
  const pending = await db
    .select({ filesJson: skillWrites.filesJson })
    .from(skillWrites)
    .where(eq(skillWrites.status, 'pending'))
  for (const json of [
    ...ledger.map((row) => row.detailJson),
    ...pending.map((row) => row.filesJson),
  ]) {
    if (json === null) continue
    const parsed = v.safeParse(changesSchema, JSON.parse(json))
    if (!parsed.success) continue
    for (const change of parsed.output) {
      if (change.before !== null) referenced.add(change.before)
      if (change.after !== null) referenced.add(change.after)
    }
  }
  const page = await bucket.list({ prefix: blobKey(''), limit: 1000 })
  const stale = page.objects.filter(
    (object) =>
      !referenced.has(object.key.slice(blobKey('').length)) &&
      object.uploaded.getTime() < now - SKILL_BLOB_GRACE_MS,
  )
  if (stale.length > 0) await bucket.delete(stale.map((object) => object.key))
  return stale.length
}

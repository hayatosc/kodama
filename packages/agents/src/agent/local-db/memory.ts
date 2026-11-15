/**
 * Object-local persistence for memory: extraction read progress, turn quotas, and prompt copies.
 *
 * @module
 */
import { eq } from 'drizzle-orm'
import { alwaysLoaded, rememberTurns } from '../../../drizzle/durable-object/schema.ts'
import type { LocalDb } from './local.ts'

/** Durable high-water mark of pages read by the current extraction job. */
export const EXTRACTION_READ_KEY = 'kodama:extraction-read'

/** Read progress only for the requested job; another job's progress is not evidence. */
export async function extractionProgress(storage: DurableObjectStorage, jobId: string) {
  const progress = await storage.get<{ jobId: string; through: number }>(EXTRACTION_READ_KEY)
  return progress?.jobId === jobId ? progress.through : undefined
}

/** Advance the job's read range monotonically, including concurrent page reads. */
export function advanceExtractionProgress(
  storage: DurableObjectStorage,
  jobId: string,
  fallback: number,
  through: number,
): Promise<void> {
  return storage.transaction(async (txn) => {
    const current = await txn.get<{ jobId: string; through: number }>(EXTRACTION_READ_KEY)
    await txn.put(EXTRACTION_READ_KEY, {
      jobId,
      through: Math.max(current?.jobId === jobId ? current.through : fallback, through),
    })
  })
}

/** Consume a turn's quota synchronously; nothing can interleave between the read and write. */
export function claimRememberTurn(local: LocalDb, entryId: number, limit: number): boolean {
  const turn = local.select().from(rememberTurns).where(eq(rememberTurns.entryId, entryId)).get()
  if ((turn?.count ?? 0) >= limit) return false
  const count = (turn?.count ?? 0) + 1
  local
    .insert(rememberTurns)
    .values({ entryId, count })
    .onConflictDoUpdate({ target: rememberTurns.entryId, set: { count } })
    .run()
  return true
}

/** The most recent cached prompt copy, if it has been built. */
export function storedMemoryCopy(local: LocalDb) {
  return local.select().from(alwaysLoaded).where(eq(alwaysLoaded.id, 1)).get()
}

/** Replace the prompt, skills, tasks, revisions, and check time together. */
export function saveMemoryCopy(local: LocalDb, row: typeof alwaysLoaded.$inferInsert): void {
  local
    .insert(alwaysLoaded)
    .values(row)
    .onConflictDoUpdate({ target: alwaysLoaded.id, set: row })
    .run()
}

/** Update the cached active task index immediately when the agent writes a task checkpoint. */
export function saveLocalTasks(local: LocalDb, tasksJson: string): void {
  const existing = storedMemoryCopy(local)
  if (existing) {
    local.update(alwaysLoaded).set({ tasksJson }).where(eq(alwaysLoaded.id, 1)).run()
    return
  }
  local
    .insert(alwaysLoaded)
    .values({
      id: 1,
      text: '',
      revisionsJson: '{}',
      skillsJson: '[]',
      tasksJson,
      checkedAt: 0,
    })
    .run()
}

/** Mark a revision check without changing the rendered copy. */
export function markMemoryChecked(local: LocalDb, now: number): void {
  local.update(alwaysLoaded).set({ checkedAt: now }).where(eq(alwaysLoaded.id, 1)).run()
}

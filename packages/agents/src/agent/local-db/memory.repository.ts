/**
 * Object-local persistence for memory: extraction read progress, turn quotas, and prompt copies.
 *
 * @module
 */
import type { LocalDb } from './local.ts'
import { queries } from './queries/index.ts'

/** Cached always-loaded prompt copy stored per agent Durable Object. */
export interface AlwaysLoadedCopy {
  id: number
  text: string
  revisionsJson: string
  skillsJson: string
  tasksJson: string
  checkedAt: number
}

/** Input payload for replacing the cached always-loaded prompt copy. */
export interface AlwaysLoadedCopyInput {
  id?: number
  text: string
  revisionsJson: string
  skillsJson?: string
  tasksJson?: string
  checkedAt: number
}

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
  const turn = queries.getRememberTurn.runSync(local.sql, { entryId })
  if ((turn?.count ?? 0) >= limit) return false
  queries.insertRememberTurnUpsert.runSync(local.sql, {
    entryId,
    count: (turn?.count ?? 0) + 1,
  })
  return true
}

/** The most recent cached prompt copy, if it has been built. */
export function storedMemoryCopy(local: LocalDb): AlwaysLoadedCopy | undefined {
  return queries.getAlwaysLoaded.runSync(local.sql) ?? undefined
}

/** Replace the prompt, skills, tasks, revisions, and check time together. */
export function saveMemoryCopy(local: LocalDb, row: AlwaysLoadedCopyInput): void {
  queries.insertAlwaysLoadedUpsert.runSync(local.sql, {
    id: row.id ?? 1,
    text: row.text,
    revisionsJson: row.revisionsJson,
    skillsJson: row.skillsJson ?? '[]',
    tasksJson: row.tasksJson ?? '[]',
    checkedAt: row.checkedAt,
  })
}

/** Update the cached active task index immediately when the agent writes a task checkpoint. */
export function saveLocalTasks(local: LocalDb, tasksJson: string): void {
  queries.insertLocalTasksUpsert.runSync(local.sql, { tasksJson })
}

/** Mark a revision check without changing the rendered copy. */
export function markMemoryChecked(local: LocalDb, now: number): void {
  queries.updateMarkMemoryChecked.runSync(local.sql, { checkedAt: now })
}

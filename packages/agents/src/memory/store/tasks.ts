/**
 * Durable task progress checkpoints in D1, owned directly by working agents (`task_write`/`task_read`)
 * and curated during daily consolidation.
 *
 * @see docs/memory.md — Task progress
 *
 * @module
 */
import { parseEnum, prepareQuery } from '../../lib/reylo.ts'
import {
  checkedTaskProgress,
  TASK_ARCHIVE_DAYS,
  TASK_LIST_LIMIT,
  TASK_PROGRESS_STATUSES,
} from '../tasks.ts'
import type { TaskProgressStatus, TaskProgressWrite, VisibleTask } from '../tasks.ts'
import { agentScope } from './db.ts'
import type { MemoryDb } from './db.ts'
import { applyPlan } from './records.ts'
import archiveTaskProgress from './sql/archive-task-progress.sql'
import insertTaskProgress from './sql/insert-task-progress.sql'
import listTaskProgressActive from './sql/list-task-progress-active.sql'
import listTaskProgressAll from './sql/list-task-progress-all.sql'
import selectCompletedTasksBefore from './sql/select-completed-tasks-before.sql'
import selectTaskProgress from './sql/select-task-progress.sql'
import selectVisibleTasks from './sql/select-visible-tasks.sql'
import updateTaskProgress from './sql/update-task-progress.sql'
import { bumpScope, claimRevision, conflict, insertOp, recordLedger } from './statements.ts'
import type { OperationContext, OperationResult, Plan, Statements } from './statements.ts'

/** A task checkpoint row. */
export interface TaskProgress {
  agentId: string
  slug: string
  title: string
  status: TaskProgressStatus
  summary: string
  body: string
  revision: number
  createdAt: number
  updatedAt: number
}

function parseTaskProgress(row: {
  agentId: string
  slug: string
  title: string
  status: string
  summary: string
  body: string
  revision: number
  createdAt: number
  updatedAt: number
}): TaskProgress {
  return {
    ...row,
    status: parseEnum(TASK_PROGRESS_STATUSES, row.status, 'task progress status'),
  }
}

const CURATE_BATCH = 200
const DAY_MS = 24 * 60 * 60 * 1000

function taskKey(agentId: string, slug: string): string {
  return `${agentId}/${slug}`
}

/** Read a single task checkpoint by agent ID and slug. */
export async function readTaskProgress(
  db: MemoryDb,
  agentId: string,
  slug: string,
): Promise<TaskProgress | undefined> {
  const row = await selectTaskProgress.run(db, { agentId, slug })
  return row === null ? undefined : parseTaskProgress(row)
}

/** List task checkpoints for an agent, most recently updated first. */
export async function listTaskProgress(
  db: MemoryDb,
  agentId: string,
  options: { includeArchived?: boolean; limit?: number } = {},
): Promise<TaskProgress[]> {
  const limit = options.limit ?? 50
  const rows = options.includeArchived
    ? await listTaskProgressAll.run(db, { agentId, limit })
    : await listTaskProgressActive.run(db, { agentId, limit })
  return rows.map(parseTaskProgress)
}

/**
 * Active (`in_progress` or `blocked`) task checkpoints for the always-loaded prompt index.
 * Picks the most recently updated `TASK_LIST_LIMIT` tasks, then orders deterministically by `slug`
 * so updates to unrelated timestamps preserve KV prompt cache prefixes.
 */
export async function visibleTasks(db: MemoryDb, agentId: string): Promise<VisibleTask[]> {
  const rows = await selectVisibleTasks.run(db, { agentId, limit: TASK_LIST_LIMIT })
  const tasks: VisibleTask[] = []
  for (const row of rows) {
    if (row.status === 'in_progress' || row.status === 'blocked') {
      tasks.push({ slug: row.slug, title: row.title, status: row.status, summary: row.summary })
    }
  }
  return tasks.sort((a, b) => a.slug.localeCompare(b.slug))
}

/**
 * Create or update a task checkpoint atomically in D1.
 *
 * @throws {@link TypeError} When the slug, title, summary, or body violates its bounds.
 */
export async function writeTaskProgress(
  db: MemoryDb,
  context: OperationContext,
  input: TaskProgressWrite,
): Promise<OperationResult & { replayed: boolean }> {
  const write = checkedTaskProgress(input)
  const key = taskKey(write.agentId, write.slug)
  return applyPlan(db, context, async (): Promise<Plan> => {
    const current = await readTaskProgress(db, write.agentId, write.slug)
    if (write.revision !== undefined && (current?.revision ?? undefined) !== write.revision) {
      return conflict(
        db,
        context,
        key,
        current === undefined ? 'no_task' : 'target_changed',
        'task',
      )
    }
    const nextRevision = (current?.revision ?? 0) + 1
    const result: OperationResult = { status: 'applied', recordId: key }
    const change =
      current === undefined
        ? prepareQuery(db, insertTaskProgress, {
            agentId: write.agentId,
            slug: write.slug,
            title: write.title,
            status: write.status,
            summary: write.summary,
            body: write.body,
            createdAt: context.now,
            updatedAt: context.now,
          })
        : prepareQuery(db, updateTaskProgress, {
            agentId: write.agentId,
            slug: write.slug,
            title: write.title,
            status: write.status,
            summary: write.summary,
            body: write.body,
            updatedAt: context.now,
            nextRevision,
            revision: current.revision,
          })
    const statements: Statements = [
      insertOp(db, context, 'task_write', result),
      change,
      claimRevision(db, context, 'task', key, nextRevision),
      recordLedger(
        db,
        context,
        'task_write',
        key,
        { status: write.status, title: write.title },
        'task',
      ),
      bumpScope(db, context, agentScope(write.agentId)),
    ]
    return { result, statements }
  })
}

/** Archive completed task checkpoints older than {@link TASK_ARCHIVE_DAYS}. */
export async function curateTasks(db: MemoryDb, runId: string, now: number): Promise<number> {
  const before = now - TASK_ARCHIVE_DAYS * DAY_MS
  const rows = (await selectCompletedTasksBefore.run(db, { before, limit: CURATE_BATCH })).map(
    parseTaskProgress,
  )
  for (const row of rows) {
    const key = taskKey(row.agentId, row.slug)
    const context: OperationContext = {
      opId: `curate-task:${key}@${row.revision}`,
      jobId: runId,
      runId,
      actor: 'consolidation',
      now,
    }
    await applyPlan(db, context, async (): Promise<Plan> => {
      const current = await readTaskProgress(db, row.agentId, row.slug)
      if (current === undefined || current.revision !== row.revision) {
        return conflict(db, context, key, 'target_changed', 'task')
      }
      const nextRevision = current.revision + 1
      const result: OperationResult = { status: 'applied', recordId: key }
      const statements: Statements = [
        insertOp(db, context, 'task_archived', result),
        prepareQuery(db, archiveTaskProgress, {
          agentId: row.agentId,
          slug: row.slug,
          nextRevision,
          revision: row.revision,
          updatedAt: now,
        }),
        claimRevision(db, context, 'task', key, nextRevision),
        recordLedger(db, context, 'task_archived', key, {}, 'task'),
        bumpScope(db, context, agentScope(row.agentId)),
      ]
      return { result, statements }
    })
  }
  return rows.length
}

/**
 * Data-access repository for durable task progress checkpoints in memory D1.
 *
 * @see docs/memory.md — Task progress
 *
 * @module
 */
import { parseEnum, prepareQuery } from '../../lib/reylo.ts'
import { TASK_PROGRESS_STATUSES } from '../tasks.ts'
import type { TaskProgressStatus } from '../tasks.ts'
import type { MemoryDb } from './db.ts'
import { queries } from './queries/index.ts'

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

/** Read a single task checkpoint by agent ID and slug. */
export async function readTaskProgress(
  db: MemoryDb,
  agentId: string,
  slug: string,
): Promise<TaskProgress | undefined> {
  const row = await queries.getTaskProgress.run(db, { agentId, slug })
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
    ? await queries.listTaskProgressAll.run(db, { agentId, limit })
    : await queries.listTaskProgressActive.run(db, { agentId, limit })
  return rows.map(parseTaskProgress)
}

/** Fetch visible task progress rows up to `limit` for always-loaded prompt construction. */
export async function listVisibleTaskRows(db: MemoryDb, agentId: string, limit: number) {
  return queries.listVisibleTasks.run(db, { agentId, limit })
}

/** Prepare a statement inserting a new task checkpoint row. */
export function insertTaskProgressStatement(
  db: MemoryDb,
  params: {
    agentId: string
    slug: string
    title: string
    status: TaskProgressStatus
    summary: string
    body: string
    createdAt: number
    updatedAt: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertTaskProgress, params)
}

/** Prepare a revision-guarded statement updating a task checkpoint row. */
export function updateTaskProgressStatement(
  db: MemoryDb,
  params: {
    agentId: string
    slug: string
    title: string
    status: TaskProgressStatus
    summary: string
    body: string
    updatedAt: number
    nextRevision: number
    revision: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateTaskProgress, params)
}

/** Prepare a revision-guarded statement archiving a completed task checkpoint. */
export function archiveTaskProgressStatement(
  db: MemoryDb,
  params: {
    agentId: string
    slug: string
    nextRevision: number
    revision: number
    updatedAt: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateArchiveTaskProgress, params)
}

/** List completed tasks updated before `before`, bounded by `limit`. */
export async function listCompletedTasksBefore(
  db: MemoryDb,
  before: number,
  limit: number,
): Promise<TaskProgress[]> {
  return (await queries.listCompletedTasksBefore.run(db, { before, limit })).map(parseTaskProgress)
}

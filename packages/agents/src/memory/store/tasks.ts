/**
 * Durable task progress checkpoints in D1, owned directly by working agents (`task_write`/`task_read`)
 * and curated during daily consolidation.
 *
 * @see docs/memory.md — Task progress
 *
 * @module
 */
import { and, desc, eq, inArray, lt, ne } from 'drizzle-orm'
import { taskProgress } from '../../../drizzle/memory/schema.ts'
import type { MemoryDb } from './db.ts'
import { agentScope } from './db.ts'
import { applyPlan } from './records.ts'
import { bumpScope, claimRevision, conflict, insertOp, recordLedger } from './statements.ts'
import type { OperationContext, OperationResult, Plan, Statements } from './statements.ts'
import { checkedTaskProgress, TASK_ARCHIVE_DAYS, TASK_LIST_LIMIT } from '../tasks.ts'
import type { TaskProgressWrite, VisibleTask } from '../tasks.ts'

/** A task checkpoint row. */
export type TaskProgress = typeof taskProgress.$inferSelect

const CURATE_BATCH = 200
const DAY_MS = 24 * 60 * 60 * 1000

function taskKey(agentId: string, slug: string): string {
  return `${agentId}/${slug}`
}

/** Read a single task checkpoint by agent ID and slug. */
export function readTaskProgress(db: MemoryDb, agentId: string, slug: string) {
  return db
    .select()
    .from(taskProgress)
    .where(and(eq(taskProgress.agentId, agentId), eq(taskProgress.slug, slug)))
    .get()
}

/** List task checkpoints for an agent, most recently updated first. */
export function listTaskProgress(
  db: MemoryDb,
  agentId: string,
  options: { includeArchived?: boolean; limit?: number } = {},
): Promise<TaskProgress[]> {
  const limit = options.limit ?? 50
  return db
    .select()
    .from(taskProgress)
    .where(
      options.includeArchived
        ? eq(taskProgress.agentId, agentId)
        : and(eq(taskProgress.agentId, agentId), ne(taskProgress.status, 'archived')),
    )
    .orderBy(desc(taskProgress.updatedAt))
    .limit(limit)
}

/**
 * Active (`in_progress` or `blocked`) task checkpoints for the always-loaded prompt index.
 * Picks the most recently updated `TASK_LIST_LIMIT` tasks, then orders deterministically by `slug`
 * so updates to unrelated timestamps preserve KV prompt cache prefixes.
 */
export async function visibleTasks(db: MemoryDb, agentId: string): Promise<VisibleTask[]> {
  const rows = await db
    .select({
      slug: taskProgress.slug,
      title: taskProgress.title,
      status: taskProgress.status,
      summary: taskProgress.summary,
    })
    .from(taskProgress)
    .where(
      and(
        eq(taskProgress.agentId, agentId),
        inArray(taskProgress.status, ['in_progress', 'blocked']),
      ),
    )
    .orderBy(desc(taskProgress.updatedAt))
    .limit(TASK_LIST_LIMIT)
  return rows
    .filter((row): row is VisibleTask => row.status === 'in_progress' || row.status === 'blocked')
    .sort((a, b) => a.slug.localeCompare(b.slug))
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
      return conflict(db, context, key, current === undefined ? 'no_task' : 'target_changed')
    }
    const nextRevision = (current?.revision ?? 0) + 1
    const result: OperationResult = { status: 'applied', recordId: key }
    const fields = {
      title: write.title,
      status: write.status,
      summary: write.summary,
      body: write.body,
      updatedAt: context.now,
    }
    const change =
      current === undefined
        ? db.insert(taskProgress).values({
            agentId: write.agentId,
            slug: write.slug,
            ...fields,
            createdAt: context.now,
          })
        : db
            .update(taskProgress)
            .set({ ...fields, revision: nextRevision })
            .where(
              and(
                eq(taskProgress.agentId, write.agentId),
                eq(taskProgress.slug, write.slug),
                eq(taskProgress.revision, current.revision),
              ),
            )
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
  const rows = await db
    .select()
    .from(taskProgress)
    .where(and(eq(taskProgress.status, 'completed'), lt(taskProgress.updatedAt, before)))
    .limit(CURATE_BATCH)
  for (const row of rows) {
    const key = taskKey(row.agentId, row.slug)
    await applyPlan(
      db,
      {
        opId: `curate-task:${key}@${row.revision}`,
        jobId: runId,
        runId,
        actor: 'consolidation',
        now,
      },
      async (): Promise<Plan> => {
        const current = await readTaskProgress(db, row.agentId, row.slug)
        if (current === undefined || current.revision !== row.revision) {
          return conflict(
            db,
            {
              opId: `curate-task:${key}@${row.revision}`,
              jobId: runId,
              runId,
              actor: 'consolidation',
              now,
            },
            key,
            'target_changed',
          )
        }
        const nextRevision = current.revision + 1
        const result: OperationResult = { status: 'applied', recordId: key }
        const statements: Statements = [
          insertOp(
            db,
            {
              opId: `curate-task:${key}@${row.revision}`,
              jobId: runId,
              runId,
              actor: 'consolidation',
              now,
            },
            'task_archived',
            result,
          ),
          db
            .update(taskProgress)
            .set({ status: 'archived', revision: nextRevision, updatedAt: now })
            .where(
              and(
                eq(taskProgress.agentId, row.agentId),
                eq(taskProgress.slug, row.slug),
                eq(taskProgress.revision, row.revision),
              ),
            ),
          claimRevision(
            db,
            {
              opId: `curate-task:${key}@${row.revision}`,
              jobId: runId,
              runId,
              actor: 'consolidation',
              now,
            },
            'task',
            key,
            nextRevision,
          ),
          recordLedger(
            db,
            {
              opId: `curate-task:${key}@${row.revision}`,
              jobId: runId,
              runId,
              actor: 'consolidation',
              now,
            },
            'task_archived',
            key,
            {},
            'task',
          ),
          bumpScope(
            db,
            {
              opId: `curate-task:${key}@${row.revision}`,
              jobId: runId,
              runId,
              actor: 'consolidation',
              now,
            },
            agentScope(row.agentId),
          ),
        ]
        return { result, statements }
      },
    )
  }
  return rows.length
}

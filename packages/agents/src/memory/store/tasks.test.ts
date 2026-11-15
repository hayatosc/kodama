/**
 * Task progress checkpoints support optimistic updates, deterministic index sorting, and
 * consolidation archival after completion.
 *
 * @module
 */
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vite-plus/test'
import { memoryLedger } from '../../../drizzle/memory/schema.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import { context, db } from '../../testing/memory.ts'
import { TASK_ARCHIVE_DAYS, TASK_LIST_LIMIT } from '../tasks.ts'
import {
  curateTasks,
  listTaskProgress,
  readTaskProgress,
  visibleTasks,
  writeTaskProgress,
} from './tasks.ts'

const DAY = 24 * 60 * 60 * 1000

describe('task progress store', () => {
  it('creates, updates with CAS revisions, replays idempotently, and validates inputs', async () => {
    const agentId = uuidv7()
    const op = context(1_000)
    const first = await writeTaskProgress(db, op, {
      agentId,
      slug: 'deploy-v2',
      title: 'Deploy v2 rollout',
      status: 'in_progress',
      summary: 'Canary at 10%',
      body: 'Step 1 done. Step 2: check metrics.',
    })
    expect(first).toEqual({ status: 'applied', recordId: `${agentId}/deploy-v2`, replayed: false })

    const replay = await writeTaskProgress(db, op, {
      agentId,
      slug: 'deploy-v2',
      title: 'Ignored',
      status: 'completed',
      summary: 'Ignored',
      body: 'Ignored',
    })
    expect(replay.replayed).toBe(true)

    const staleOp = context(2_000)
    const stale = await writeTaskProgress(db, staleOp, {
      agentId,
      slug: 'deploy-v2',
      title: 'Deploy v2 rollout',
      status: 'blocked',
      summary: 'Waiting on approval',
      body: 'Stale revision check',
      revision: 9,
    })
    expect(stale.status).toBe('conflict')
    expect(
      await db.select().from(memoryLedger).where(eq(memoryLedger.opId, staleOp.opId)),
    ).toMatchObject([{ action: 'conflict', target: 'task', targetId: `${agentId}/deploy-v2` }])

    const updated = await writeTaskProgress(db, context(3_000), {
      agentId,
      slug: 'deploy-v2',
      title: 'Deploy v2 rollout',
      status: 'blocked',
      summary: 'Waiting on approval',
      body: 'Need operator sign-off.',
      revision: 1,
    })
    expect(updated.status).toBe('applied')
    expect(await readTaskProgress(db, agentId, 'deploy-v2')).toMatchObject({
      status: 'blocked',
      revision: 2,
      summary: 'Waiting on approval',
    })

    await expect(
      writeTaskProgress(db, context(4_000), {
        agentId,
        slug: 'Bad Slug',
        title: 'Bad',
        status: 'in_progress',
        summary: 'Bad',
        body: 'Bad',
      }),
    ).rejects.toThrow('Invalid task slug')
  })

  it('orders active visibleTasks deterministically by slug and excludes completed/archived tasks', async () => {
    const agentId = uuidv7()
    for (let index = 0; index <= TASK_LIST_LIMIT; index++) {
      await writeTaskProgress(db, context(1_000 + index), {
        agentId,
        slug: `task-${String(index).padStart(2, '0')}`,
        title: `Task ${index}`,
        status: index % 2 === 0 ? 'in_progress' : 'blocked',
        summary: `Summary ${index}`,
        body: 'Body',
      })
    }
    await writeTaskProgress(db, context(2_000), {
      agentId,
      slug: 'done-task',
      title: 'Done',
      status: 'completed',
      summary: 'Finished',
      body: 'Done',
    })

    const visible = await visibleTasks(db, agentId)
    expect(visible).toHaveLength(TASK_LIST_LIMIT)
    expect(visible.map((t) => t.slug)).not.toContain('task-00')
    expect(visible.map((t) => t.slug)).not.toContain('done-task')
    expect(visible.map((t) => t.slug)).toEqual(
      visible.map((t) => t.slug).sort((a, b) => a.localeCompare(b)),
    )
  })

  it('archives completed tasks older than 30 days while keeping recent or active ones', async () => {
    const agentId = uuidv7()
    const now = Date.now()
    await writeTaskProgress(db, context(now - (TASK_ARCHIVE_DAYS + 2) * DAY), {
      agentId,
      slug: 'old-done',
      title: 'Old Done',
      status: 'completed',
      summary: 'Old',
      body: 'Old',
    })
    await writeTaskProgress(db, context(now - 5 * DAY), {
      agentId,
      slug: 'recent-done',
      title: 'Recent Done',
      status: 'completed',
      summary: 'Recent',
      body: 'Recent',
    })
    await writeTaskProgress(db, context(now - (TASK_ARCHIVE_DAYS + 5) * DAY), {
      agentId,
      slug: 'old-active',
      title: 'Still Going',
      status: 'in_progress',
      summary: 'Active',
      body: 'Active',
    })

    await curateTasks(db, 'curate-tasks', now)
    expect((await readTaskProgress(db, agentId, 'old-done'))?.status).toBe('archived')
    expect((await readTaskProgress(db, agentId, 'recent-done'))?.status).toBe('completed')
    expect((await readTaskProgress(db, agentId, 'old-active'))?.status).toBe('in_progress')
    expect((await listTaskProgress(db, agentId)).map((row) => row.slug)).not.toContain('old-done')
  })
})

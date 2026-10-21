/** One attempt of a job the memory agent's model does, in a fresh context (Jobs). */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { Harness, Submission, SubmissionDraft } from '@earendil-works/pi-durable'
import { eq } from 'drizzle-orm'
import * as v from 'valibot'
import type { MemoryDb } from '../store/db.ts'
import { memoryOps } from '../../../drizzle/d1/schema.ts'
import type { JobOutcome, MemoryJob } from '../jobs.ts'
import { jobPrompt } from './prompts.ts'
import type { JobQueue, JobRow } from './queue.ts'

const context = BACKGROUND_CONTEXT

export interface ModelJobDeps {
  harness: Harness
  admit: (draft: SubmissionDraft) => Promise<Submission>
  queue: JobQueue
  db: MemoryDb
}

const resultStatusSchema = v.object({ status: v.string() })

/** A job's outcome from the operations it applied. */
function outcomeOf(results: readonly string[]): JobOutcome {
  const statuses = results.flatMap((json) => {
    const parsed = v.safeParse(resultStatusSchema, JSON.parse(json))
    return parsed.success ? [parsed.output.status] : []
  })
  return statuses.includes('applied') ? 'persisted' : 'declined'
}

/**
 * Each attempt is its own Pi input: the conversation is reset while idle, so the job starts
 * without the previous job's context. A resumed attempt waits for the submission it made.
 */
export async function runModelJob(
  deps: ModelJobDeps,
  row: JobRow,
  job: MemoryJob,
): Promise<JobOutcome | 'retry'> {
  const { harness } = deps
  const requestId = `${row.jobId}-${row.attempts}`
  const root = await harness.root(context)
  const existing = await harness.commit(
    (tx) => tx.submissionByRequest(ROOT_CONVERSATION_ID, requestId),
    context,
  )
  let submission: Submission | undefined =
    existing === undefined ? undefined : await harness.submission(existing.id, context)
  if (submission === undefined) {
    await root.waitForIdle(context)
    // Placed at once while idle, so the job starts without the previous job's context.
    await root.reset(undefined, context)
    submission = await deps.admit({
      type: 'input',
      requestId,
      content: jobPrompt(job),
      whenBusy: 'followUp',
    })
    await deps.queue.recordSubmission(row.jobId, submission.id)
  }
  const settled = await submission.wait(context)
  if (settled.status !== 'done') return 'retry'
  const ops = await deps.db
    .select({ resultJson: memoryOps.resultJson })
    .from(memoryOps)
    .where(eq(memoryOps.jobId, row.jobId))
  return outcomeOf(ops.map((op) => op.resultJson))
}

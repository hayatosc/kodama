/**
 * Job-scoped entry reads, including durable extraction read evidence.
 *
 * @module
 */
import { advanceExtractionProgress } from '../storage/memory.ts'
import type { MemoryJobDeps } from './job-context.ts'
import { extractionReadThrough } from './job-operations.ts'

/** Read a contiguous extraction page and persist how far the job has actually read. */
export async function readExtractionEntries(deps: MemoryJobDeps, after?: number, limit?: number) {
  const running = await deps.runningJob()
  if (running?.job.kind !== 'extract') throw new Error('read_entries needs an extract job')
  const { job } = running
  const through = await extractionReadThrough(deps, running)
  if (after !== undefined && after > through) {
    throw new Error(`Start within the job's read range through ${through}`)
  }
  const page = await deps.env.AGENTS.getByName(job.sourceAgentId).readEntries({
    after: Math.max(after ?? job.afterEntry, job.afterEntry),
    limit: limit ?? 50,
  })
  await advanceExtractionProgress(deps.storage, running.jobId, through, page.through)
  return {
    ...page,
    entries: page.entries.filter(
      (entry) => job.eligibleThrough === undefined || entry.id <= job.eligibleThrough,
    ),
  }
}

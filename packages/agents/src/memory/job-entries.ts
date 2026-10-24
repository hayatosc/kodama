/**
 * Job-scoped entry reads and archive summaries, including durable extraction read evidence.
 *
 * @module
 */
import { advanceExtractionProgress } from '../storage/memory.ts'
import { readArchivedText } from './archive/reader.ts'
import { writeSummary } from './archive/segment.ts'
import type { MemoryJobDeps } from './job-context.ts'
import { extractionReadThrough } from './job-operations.ts'
import { memoryDb } from './store/db.ts'
import { archivedSegment } from './store/archive.ts'

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
  return page
}

async function jobArchive(deps: MemoryJobDeps) {
  const running = await deps.runningJob()
  if (running?.job.kind !== 'record_archive')
    throw new Error('This tool needs a record_archive job')
  const segment = await archivedSegment(memoryDb(deps.env.MEMORY_DB), running.job.segmentId)
  if (segment === undefined) throw new Error(`Archived segment ${running.job.segmentId} is missing`)
  return segment
}

/** Read only the segment assigned to the running archive job. */
export async function readJobArchive(deps: MemoryJobDeps, after?: number, limit?: number) {
  const segment = await jobArchive(deps)
  const page = await readArchivedText(deps.env.ARCHIVE, segment.r2Prefix, after ?? 0, limit ?? 50)
  return { page, lastEntry: segment.lastEntry }
}

/** Store a trimmed summary before recording completion of the archive job. */
export async function writeJobArchiveSummary(deps: MemoryJobDeps, summary: string): Promise<void> {
  const segment = await jobArchive(deps)
  await writeSummary(deps.env.ARCHIVE, segment.r2Prefix, summary.trim())
}

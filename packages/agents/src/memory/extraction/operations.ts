/**
 * Apply a memory job's operation after checking its read evidence and write permissions.
 *
 * @module
 */
import { extractionProgress } from '../../agent/local-db/memory.ts'
import { jobOperationContext, requireMemoryJob } from './context.ts'
import type { MemoryJobDeps, RunningJob } from './context.ts'
import type { MemoryJob } from '../jobs.ts'
import { memoryDb } from '../store/db.ts'
import { applyOperation } from '../store/records.ts'
import type { Operation } from '../store/records.ts'
import { writeShared } from '../shared.ts'
import type { SharedWrite } from '../shared.ts'

/** Read evidence survives eviction, but cannot leak from a different job. */
export async function extractionReadThrough(
  deps: MemoryJobDeps,
  running: RunningJob,
): Promise<number> {
  return (
    (await extractionProgress(deps.storage, running.jobId)) ??
    (running.job.kind === 'extract' ? running.job.afterEntry : 0)
  )
}

/** Check consolidation permission before applying a shared write with source checks. */
export async function executeSharedWrite(deps: MemoryJobDeps, callId: string, input: SharedWrite) {
  const running = await deps.runningJob()
  if (running?.job.kind !== 'consolidate') throw new Error('shared_write needs a consolidate job')
  return writeShared(
    memoryDb(deps.env.MEMORY_DB),
    await jobOperationContext(running, callId, deps.now?.() ?? Date.now()),
    input,
    running.job.scope,
  )
}

/** Resolve the only agent whose skills the running consolidation job may read or change. */
export async function skillJobContext(deps: MemoryJobDeps, callId = '') {
  const running = await deps.runningJob()
  if (running?.job.kind !== 'consolidate' || !running.job.scope.startsWith('agent:')) {
    throw new Error('Skills change only in a consolidate job of an agent scope')
  }
  return {
    agentId: running.job.scope.slice('agent:'.length),
    context: await jobOperationContext(running, callId, deps.now?.() ?? Date.now()),
  }
}

/**
 * Enforce job permissions, then record the operation once.
 * The caller supplies a stable call ID, not a tool execution API.
 */
export async function executeJobOperation(
  deps: MemoryJobDeps,
  callId: string,
  operation: (job: MemoryJob, now: number) => Operation,
) {
  const running = await requireMemoryJob(deps)
  const now = deps.now?.() ?? Date.now()
  const op = operation(running.job, now)
  const { job } = running
  if (job.kind === 'extract') {
    const through = await extractionReadThrough(deps, running)
    const end =
      op.type === 'checkpoint'
        ? op.lastEntryId
        : op.type === 'write' || op.type === 'supersede'
          ? op.record.sourceEntries?.to
          : op.type === 'invalidate'
            ? op.evidence.sourceEntries?.to
            : undefined
    if (
      op.type !== 'checkpoint' &&
      job.eligibleThrough !== undefined &&
      end !== undefined &&
      end > job.eligibleThrough
    )
      throw new Error('untrusted_context')
    if (end !== undefined && end > through) {
      throw new Error(`Entry ${end} exceeds the job's read range through ${through}`)
    }
  }
  if (job.kind === 'consolidate' && job.scope.startsWith('shared:') && op.type !== 'decline') {
    throw new Error('Shared records change only through shared_write, which checks their sources')
  }
  const context = await jobOperationContext(running, callId, now)
  if (job.kind === 'extract')
    return deps.env.AGENTS.getByName(job.sourceAgentId).applyExtractionOperation(context, op)
  return applyOperation(memoryDb(deps.env.MEMORY_DB), context, op)
}

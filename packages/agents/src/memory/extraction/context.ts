/**
 * The running memory job and the capabilities needed to process it, independent of tool APIs.
 *
 * @module
 */
import type { AgentEnv } from '../../env.ts'
import { sha256Hex } from '../../lib/hash.ts'
import type { MemoryJob } from '../jobs.ts'
import type { OperationContext } from '../store/statements.ts'

/** The job the memory agent is running, and its ID. */
export interface RunningJob {
  jobId: string
  job: MemoryJob
}

/** Capabilities used by memory job operations. */
export interface MemoryJobDeps {
  env: AgentEnv
  storage: DurableObjectStorage
  /** Writes are refused outside a running job. */
  runningJob: () => Promise<RunningJob | undefined>
  now?: () => number
}

/** Require a running job before reading or changing its memory. */
export async function requireMemoryJob(deps: MemoryJobDeps): Promise<RunningJob> {
  const running = await deps.runningJob()
  if (running === undefined) throw new Error('No memory job is running')
  return running
}

/** One replay-safe operation per job and caller-supplied call ID. */
export async function jobOperationContext(
  running: RunningJob,
  callId: string,
  now: number,
): Promise<OperationContext> {
  return {
    opId: await sha256Hex(`${running.jobId}:${callId}`),
    jobId: running.jobId,
    runId: running.jobId,
    actor: 'memory-agent',
    now,
  }
}

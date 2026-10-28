/**
 * The `MemoryAgent` Durable Object: an `Agent` that keeps the long-term memory of the others.
 *
 * @see docs/memory.md — Memory agent
 *
 * @module
 */
import type { AgentChange, Harness, HarnessOptions } from '@earendil-works/pi-durable'
import type { AlarmPurpose } from '../../runtime/alarms.ts'
import { setAlarm } from '../../runtime/alarms.ts'
import { Agent } from '../../agent/agent.ts'
import { coalescingRunner } from '../../lib/serial.ts'
import type { JobStatus } from '../../memory/jobs.ts'
import type { EntryPage } from '../../memory/transcript.ts'
import type {
  AgentConfig,
  AgentSettings,
  SendMessageRequest,
  SendMessageResponse,
} from '../../protocol.ts'
import { appliedSettings } from '../../runtime/config-apply.ts'
import { toolGuardExtension } from '../../runtime/restrictions.ts'
import { memoryAgentChange, memoryAgentConfig, memoryHarnessOptions } from './config.ts'
import { jobStatus, runningJob } from '../../storage/memory-jobs.ts'
import { consolidate, drainJobs, enqueueJob, HEARTBEAT_MS, stopOverdueJob } from './runner.ts'
import type { MemoryAgentContext } from './runner.ts'

/**
 * The only writer of memory records and skills. It runs one job at a time from its own queue
 * instead of taking chat input.
 *
 * @remarks
 * It lives in the `AGENTS` namespace under `MEMORY_AGENT_NAME`, which `src/agent-object.ts` maps to
 * this class; that name is not a valid public agent ID, so `AgentService` cannot reach it. Everything else an `Agent` serves, such as `subscribe`, `snapshot`, `getConfig`,
 * and `cancel`, works as usual, so its work can be watched like any agent's. It keeps no memory
 * of its own, and its pruned history is deleted without an archive.
 */
export class MemoryAgent extends Agent {
  /** The job drain, one at a time. */
  readonly #jobs = coalescingRunner(() => drainJobs(this.#context()), 'Memory job runner failed')

  /** What the job functions need from this object. */
  #context(): MemoryAgentContext {
    return {
      env: this.env,
      storage: this.ctx.storage,
      harness: () => this.harness(),
      local: () => this.local(),
      admit: (draft) => this.admit(draft),
      prune: () => this.prune(),
    }
  }

  /** Only the memory agent's tools, which act on the running job. */
  protected override harnessOptions(): HarnessOptions {
    const refusal = this.refusal()
    return memoryHarnessOptions(
      this.env,
      async () => runningJob(await this.local()),
      this.ctx.storage,
      {
        // Its versions' toolPolicy applies to its own tools, like a working agent's.
        extension: toolGuardExtension(refusal, () => appliedSettings(this.ctx.storage)),
        refusal,
      },
      this.credentialStore(),
    )
  }

  /** The memory model and prompt, with no tools selected and no shared spaces. */
  protected override defaultConfig(): AgentConfig {
    return memoryAgentConfig(this.env)
  }

  /** Start the drain. */
  protected override async prepare(_harness: Harness): Promise<void> {
    // Not awaited: the drain waits for the harness, which is still opening here.
    this.#jobs.start()
  }

  /** Its versions set the model, instructions, and thinking level, and select no tools. */
  protected override configChange(settings: AgentSettings): AgentChange {
    return memoryAgentChange(settings)
  }

  /** It keeps no always-loaded memory of its own. */
  protected override async rebuildMemory(_settings: AgentSettings): Promise<void> {}

  /** Nothing to do: it extracts nothing, and the drain prunes between jobs. */
  protected override async onIdle(): Promise<void> {}

  /**
   * Resume the drain; while a job runs, keep waking so it resumes after an eviction, and stop an
   * attempt that has run past its time limit.
   */
  protected override async onAlarm(purpose: AlarmPurpose): Promise<void> {
    if (purpose === 'jobs' && this.#jobs.running()) {
      await setAlarm(this.ctx.storage, 'jobs', Date.now() + HEARTBEAT_MS)
      await stopOverdueJob(this.#context(), Date.now())
    }
    // Pruning closes the harness, so the drain runs it between jobs.
    this.#jobs.start()
  }

  /** Its history is job scratch work, so pruning deletes it without an archive. */
  protected override archivesPrunedEntries(): boolean {
    return false
  }

  /**
   * @throws Always: input that bypassed the queue would break "one job at a time".
   */
  override sendMessage(_request: SendMessageRequest): Promise<number> {
    return Promise.reject(new Error('The memory agent takes no chat input; use enqueue'))
  }

  /**
   * @throws Always, like {@link MemoryAgent.sendMessage}.
   */
  override send(_request: SendMessageRequest): Promise<ReadableStream<Uint8Array>> {
    return Promise.reject(new Error('The memory agent takes no chat input; use enqueue'))
  }

  /**
   * @throws Always: the memory agent messages no other agent.
   */
  override sendTo(_agentId: string, _request: SendMessageRequest): Promise<SendMessageResponse> {
    return Promise.reject(new Error('The memory agent does not message other agents'))
  }

  /**
   * @throws Always: it keeps no memory to extract, so its own entries are never read.
   */
  override readEntries(_request: { after: number; limit: number }): Promise<EntryPage> {
    return Promise.reject(new Error('The memory agent has no entries to extract'))
  }

  /**
   * @throws Always: it keeps no always-loaded memory to refresh.
   */
  override memoryChanged(): Promise<void> {
    return Promise.reject(new Error('The memory agent keeps no memory of its own'))
  }

  /**
   * Queue a memory job and start the drain.
   *
   * @returns The job's status; delivering the same job again returns the existing one.
   * @throws {@link TypeError} When `job` is not a valid memory job.
   */
  override async enqueue(job: unknown): Promise<JobStatus> {
    const status = await enqueueJob(this.#context(), job)
    this.#jobs.start()
    return status
  }

  /** A memory job's status, if the job is known. */
  override async jobStatus(jobId: string): Promise<JobStatus | undefined> {
    return jobStatus(await this.local(), jobId)
  }

  /**
   * The daily consolidation, called by the scheduled handler.
   *
   * @returns How many scopes got a `consolidate` job.
   */
  override consolidate(now: number): Promise<{ scopes: number }> {
    return consolidate(this.#context(), now, (job) => this.enqueue(job))
  }
}

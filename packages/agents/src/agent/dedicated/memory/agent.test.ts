/**
 * The memory agent is a `MemoryAgent` in the `AGENTS` namespace that takes input only through its
 * job queue and refuses the calls of a working agent.
 *
 * @module
 */
import { uuidv7 } from '../../../lib/uuid.ts'
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { memoryJobs } from '../../../../drizzle/durable-object/schema.ts'
import { setAlarm } from '../../runtime/alarms.ts'
import { openLocalDb } from '../../local-db/local.ts'
import { JOB_TIME_LIMIT_MS } from './runner.ts'
import { env, exports } from 'cloudflare:workers'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Agent } from '../../agent.ts'
import { AgentObject } from '../../../agent-object.ts'
import { memoryAgent } from '../../../testing/memory.ts'
import { rejectionInObject } from '../../../testing/rpc.ts'
import { MEMORY_AGENT_NAME } from '../../../memory/jobs.ts'
import { MemoryAgent } from './agent.ts'
import { seedOnce } from '../../../testing/management.ts'

// The memory agent needs the seeded installation and its credentials.
beforeAll(seedOnce)

afterEach(() => vi.restoreAllMocks())

describe('the memory agent', () => {
  it('preserves dedicated hooks when development RPC dispatches from the exported prototype', async () => {
    await runInDurableObject(memoryAgent(), async (instance) => {
      // Vite resolves RPC methods on the exported constructor, not the returned subclass.
      const rpc = AgentObject.prototype
      await expect(rpc.enqueue.call(instance, { kind: 'unknown' })).rejects.toThrow('Invalid type')
      expect(await rpc.jobStatus.call(instance, 'unknown-job')).toBeUndefined()
      const message = { requestId: 'dev-direct', content: 'Do not admit this input' }
      await expect(rpc.sendMessage.call(instance, message)).rejects.toThrow('use enqueue')
      await expect(rpc.send.call(instance, message)).rejects.toThrow('use enqueue')
      await expect(rpc.sendTo.call(instance, uuidv7(), message)).rejects.toThrow(
        'does not message other agents',
      )
      await expect(rpc.readEntries.call(instance, { after: 0, limit: 5 })).rejects.toThrow(
        'no entries to extract',
      )
      await expect(rpc.memoryChanged.call(instance)).rejects.toThrow('no memory of its own')
    })
  })

  it('cancel stops the running job, which is queued again like a failed attempt', async () => {
    const started = Promise.withResolvers<void>()
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          started.resolve()
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          })
        }),
    )
    const { jobId } = await memoryAgent().enqueue({
      kind: 'remember',
      sourceAgentId: uuidv7(),
      content: 'A job that is cancelled',
      sourceEntries: { from: 1, to: 1 },
    })
    await started.promise
    expect(await memoryAgent().jobStatus(jobId)).toMatchObject({ status: 'running', attempts: 1 })

    await memoryAgent().cancel()

    await expect
      .poll(() => memoryAgent().jobStatus(jobId), { timeout: 10_000 })
      .toMatchObject({ status: 'queued', attempts: 1 })
  })

  it('stops an attempt that runs past its time limit and retries the job', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          })
        }),
    )
    const { jobId } = await memoryAgent().enqueue({
      kind: 'remember',
      sourceAgentId: uuidv7(),
      content: 'A job whose provider never answers',
      sourceEntries: { from: 1, to: 1 },
    })
    await expect
      .poll(() => memoryAgent().jobStatus(jobId))
      .toMatchObject({ status: 'running', attempts: 1 })
    const heartbeat = async (startedAt?: number) => {
      await runInDurableObject(memoryAgent(), async (_instance, state) => {
        if (startedAt !== undefined) {
          const local = await openLocalDb(state.storage)
          local.update(memoryJobs).set({ startedAt }).where(eq(memoryJobs.jobId, jobId)).run()
        }
        await setAlarm(state.storage, 'jobs', Date.now())
      })
      await runDurableObjectAlarm(memoryAgent())
    }

    // Within its limit, a heartbeat leaves the attempt running.
    await heartbeat()
    expect(await memoryAgent().jobStatus(jobId)).toMatchObject({ status: 'running', attempts: 1 })

    await heartbeat(Date.now() - JOB_TIME_LIMIT_MS - 1)
    await expect
      .poll(() => memoryAgent().jobStatus(jobId), { timeout: 10_000 })
      .toMatchObject({ status: 'queued', attempts: 1 })
  })

  it('takes input only through its job queue', async () => {
    expect(
      await rejectionInObject(memoryAgent(), (agent) =>
        agent.sendMessage({ requestId: 'direct', content: 'Remember this' }),
      ),
    ).toMatch(/enqueue/)
    expect(
      await rejectionInObject(memoryAgent(), (agent) => agent.enqueue({ kind: 'unknown' })),
    ).toMatch(/Invalid type/)
  })

  it('rejects the calls that only make sense on a working agent', async () => {
    expect(
      await rejectionInObject(memoryAgent(), (agent) =>
        agent.sendTo(uuidv7(), { requestId: 'contact', content: 'Hello' }),
      ),
    ).toContain('does not message other agents')
    expect(
      await rejectionInObject(memoryAgent(), (agent) => agent.readEntries({ after: 0, limit: 5 })),
    ).toMatch(/no entries/)
    expect(await rejectionInObject(memoryAgent(), (agent) => agent.memoryChanged())).toMatch(
      /no memory of its own/,
    )
  })

  it('uses the default model when MEMORY_MODEL_* are not set', async () => {
    using config = await memoryAgent().getConfig()
    expect(config.model).toEqual({
      provider: env.DEFAULT_MODEL_PROVIDER,
      modelId: env.DEFAULT_MODEL_ID,
    })
  })

  it('is a MemoryAgent in the AGENTS namespace that public RPC cannot address', async () => {
    const rejection = (promise: Promise<unknown>) =>
      promise.then(
        () => '',
        (error: unknown) => String(error),
      )
    expect(await rejection(Promise.resolve(exports.default.snapshot(MEMORY_AGENT_NAME)))).toMatch(
      /agentId/,
    )
    const kinds = (instance: unknown) => [
      instance instanceof Agent,
      instance instanceof MemoryAgent,
    ]
    const working = env.AGENTS.getByName(uuidv7())
    expect(await runInDurableObject(memoryAgent(), kinds)).toEqual([true, true])
    expect(await runInDurableObject(working, kinds)).toEqual([true, false])
    expect(
      await rejectionInObject(working, (agent) =>
        agent.enqueue({ kind: 'extract', sourceAgentId: 'a', afterEntry: 0 }),
      ),
    ).toMatch(/Only the memory agent/)
  })
})

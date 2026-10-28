/**
 * The memory agent is a `MemoryAgent` in the `AGENTS` namespace that takes input only through its
 * job queue and refuses the calls of a working agent.
 *
 * @module
 */
import { uuidv7 } from '../../lib/uuid.ts'
import { runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Agent } from '../../agent/agent.ts'
import { memoryAgent } from '../../helper/memory.ts'
import { rejectionInObject } from '../../helper/rpc.ts'
import { MEMORY_AGENT_NAME } from '../../memory/jobs.ts'
import { MemoryAgent } from './agent.ts'

afterEach(() => vi.restoreAllMocks())

describe('the memory agent', () => {
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
      origin: 'agent_judgment',
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

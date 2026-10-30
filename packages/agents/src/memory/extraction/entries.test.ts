/** Frozen queued-job evidence excludes text without losing scan/checkpoint progress. @module */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { newAgentId } from '../../testing/management.ts'
import { useMockModel, waitForAnswer } from '../../testing/rpc.ts'
import type { MemoryJobDeps } from './context.ts'
import { readExtractionEntries } from './entries.ts'
import { executeJobOperation, extractionReadThrough } from './operations.ts'

useMockModel()

it('keeps a queued frozen bound below scan progress and refuses excluded evidence while checkpointing it', async () => {
  const sourceAgentId = await newAgentId()
  const source = env.AGENTS.getByName(sourceAgentId)
  const running = {
    jobId: 'frozen-job',
    job: { kind: 'extract', sourceAgentId, afterEntry: 0, eligibleThrough: 0 },
  } as const
  await source.sendMessage({
    requestId: 'later',
    content: 'Later evidence must not enter the queued job',
  })
  await waitForAnswer(sourceAgentId, 'later')
  const unfiltered = await source.readEntries({ after: 0, limit: 50 })
  expect(unfiltered.entries.length).toBeGreaterThan(0)
  await runInDurableObject(env.AGENTS.getByName(await newAgentId()), async (_agent, state) => {
    const deps: MemoryJobDeps = {
      env: { ...env, CLI_TOKEN: '' },
      storage: state.storage,
      runningJob: async () => running,
    }
    const page = await readExtractionEntries(deps)
    expect(page.entries).toEqual([])
    expect(page.through).toBe(unfiltered.through)
    expect(page.through).toBeGreaterThan(0)
    expect(await extractionReadThrough(deps, running)).toBe(page.through)
    await expect(
      executeJobOperation(deps, 'forbidden', () => ({
        type: 'write',
        record: {
          scope: `agent:${sourceAgentId}`,
          kind: 'fact',
          content: 'Excluded evidence',
          origin: 'extraction',
          sourceAgentId,
          sourceEntries: { from: page.through, to: page.through },
          observedAt: Date.now(),
        },
      })),
    ).rejects.toThrow('untrusted_context')
    expect(
      await executeJobOperation(deps, 'checkpoint', () => ({
        type: 'checkpoint',
        agentId: sourceAgentId,
        lastEntryId: page.through,
      })),
    ).toMatchObject({ status: 'applied' })
    expect((await readExtractionEntries(deps, page.through)).entries).toEqual([])
  })
})

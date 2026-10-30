/** Learning remains usable after web or peer input; read evidence still bounds writes. @module */
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import { markContact } from '../../agent/local-db/external-data.ts'
import { openLocalDb } from '../../agent/local-db/local.ts'
import { context, record, renderedAlwaysLoaded } from '../../testing/memory.ts'
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { newAgentId } from '../../testing/management.ts'
import { useMockModel, waitForAnswer } from '../../testing/rpc.ts'
import type { MemoryJobDeps } from './context.ts'
import { readExtractionEntries } from './entries.ts'
import { executeJobOperation, extractionReadThrough } from './operations.ts'

useMockModel()

it('learns reusable instructions despite historical contact and keeps configured policy unchanged', async () => {
  const sourceAgentId = await newAgentId()
  const source = env.AGENTS.getByName(sourceAgentId)
  using before = await source.getConfig()
  await runInDurableObject(source, async (_agent, state) => {
    markContact(await openLocalDb(state.storage), String(ROOT_CONVERSATION_ID), 'peer', 0)
  })
  await source.sendMessage({ requestId: 'owner', content: 'Use Retry-After when retrying a 429' })
  await waitForAnswer(sourceAgentId, 'owner')
  await runInDurableObject(env.AGENTS.getByName(await newAgentId()), async (_agent, state) => {
    const running = {
      jobId: `${sourceAgentId}-learning`,
      job: { kind: 'extract', sourceAgentId, afterEntry: 0 },
    } as const
    const deps: MemoryJobDeps = {
      env: { ...env, CLI_TOKEN: '' },
      storage: state.storage,
      runningJob: async () => running,
    }
    const page = await readExtractionEntries(deps, 0, 100)
    const entry = page.entries[0]
    if (!entry) throw new Error('Missing evidence')
    const candidate = {
      scope: `agent:${sourceAgentId}` as const,
      kind: 'instruction' as const,
      content: 'Use Retry-After when retrying a 429',
      origin: 'extraction' as const,
      sourceAgentId,
      sourceEntries: { from: entry.id, to: entry.id },
      observedAt: Date.now(),
    }
    const result = await executeJobOperation(deps, 'write', () => ({
      type: 'write',
      record: candidate,
    }))
    if (result.status !== 'applied') throw new Error('Write failed')
    expect(await record(result.recordId)).toMatchObject({
      kind: 'instruction',
      sourceEntryFrom: candidate.sourceEntries.from,
      sourceEntryTo: candidate.sourceEntries.to,
    })
    expect(await renderedAlwaysLoaded(sourceAgentId, [])).toContain(candidate.content)
    expect(
      await executeJobOperation(deps, 'update', () => ({
        type: 'supersede',
        oldId: result.recordId,
        oldRevision: 1,
        record: {
          ...candidate,
          content: 'Respect Retry-After and cap retries',
          sourceEntries: { from: entry.id, to: page.through },
        },
      })),
    ).toMatchObject({ status: 'applied' })
    expect(await extractionReadThrough(deps, running)).toBe(page.through)
    await expect(
      executeJobOperation(deps, 'unread', () => ({
        type: 'write',
        record: { ...candidate, sourceEntries: { from: page.through + 1, to: page.through + 1 } },
      })),
    ).rejects.toThrow("exceeds the job's read range")
  })
  using after = await source.getConfig()
  expect(after.tools).toEqual(before.tools)
  expect(after.systemPrompt).toEqual(before.systemPrompt)
})

it('preserves the kind of remembered knowledge after historical contact', async () => {
  const sourceAgentId = await newAgentId()
  const source = env.AGENTS.getByName(sourceAgentId)
  await runInDurableObject(source, async (_agent, state) => {
    markContact(await openLocalDb(state.storage), String(ROOT_CONVERSATION_ID), 'peer', 0)
  })
  const job = {
    kind: 'remember',
    sourceAgentId,
    sourceEntries: { from: 1, to: 1 },
    content: 'Use Retry-After',
  } as const
  const result = await source.applyExtractionOperation(
    context(),
    {
      type: 'write',
      record: {
        scope: `agent:${sourceAgentId}`,
        sourceAgentId,
        sourceEntries: job.sourceEntries,
        kind: 'instruction',
        content: job.content,
        origin: 'remember',
        observedAt: Date.now(),
      },
    },
    job,
  )
  if (result.status !== 'applied') throw new Error('Write failed')
  expect(await record(result.recordId)).toMatchObject({ kind: 'instruction' })
})
